import { app, dialog } from "electron";
import { constants, promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { TextDecoder } from "node:util";
import readXlsxFile from "read-excel-file/node";
import { classifyContent, redactSensitiveContent } from "../shared/classifier";
import { parseCsv, tableRowsToMarkdown, tableRowsToRecords } from "../shared/table";
import type {
  AppSettings,
  ArchiveRecordsInput,
  Classification,
  ConfirmImportInput,
  CreatePasteInput,
  ImportPreview,
  ImportPreviewItem,
  ImportResult,
  PasteRecord,
  SecuritySettings,
  UpdatePasteInput,
  VaultState,
  VaultSummary
} from "../shared/types";
import { decryptVaultFile, encryptVaultState, type VaultFile } from "./vaultCrypto";

const INITIAL_STATE: VaultState = {
  version: 1,
  records: [],
  settings: {
    model: {
      enabled: false,
      provider: "openai-compatible",
      baseUrl: "",
      apiKey: "",
      model: ""
    },
    security: {
      idleTimeoutMinutes: 0,
      clipboardClearSeconds: 30
    }
  }
};

const IMPORT_PREVIEW_TTL_MS = 30 * 60 * 1000;
const IMPORT_CONTENT_PREVIEW_LENGTH = 360;

interface ImportRecordCandidate {
  sourcePath: string;
  sourceLabel: string;
  title: string;
  content: string;
  tags: string[];
}

interface ImportPreviewCandidate {
  id: string;
  sourcePath: string;
  sourceLabel: string;
  title: string;
  content: string;
  manualTags: string[];
  contentHash: string;
  classification: Classification;
}

interface ImportPreviewBatch {
  items: ImportPreviewCandidate[];
  totalCandidates: number;
  skipped: number;
  errors: string[];
  createdAt: number;
}

export class VaultService {
  private state: VaultState | null = null;
  private password: string | null = null;
  private cachedSecurity: SecuritySettings | null = null;
  private readonly importPreviewBatches = new Map<string, ImportPreviewBatch>();
  private readonly vaultPath: string;

  constructor(vaultPath = path.join(app.getPath("userData"), "pastevault.vault")) {
    this.vaultPath = vaultPath;
  }

  async summary(): Promise<VaultSummary> {
    return {
      exists: await exists(this.vaultPath),
      path: this.vaultPath
    };
  }

  async create(password: string): Promise<PasteRecord[]> {
    assertPassword(password);
    if (await exists(this.vaultPath)) {
      throw new Error("Vault already exists.");
    }

    this.state = structuredClone(INITIAL_STATE);
    this.password = password;
    this.cachedSecurity = this.state.settings!.security;
    await this.persist();
    return this.state.records;
  }

  async unlock(password: string): Promise<PasteRecord[]> {
    assertPassword(password);
    const raw = await fs.readFile(this.vaultPath, "utf8");
    const vaultFile = JSON.parse(raw) as VaultFile;
    const decrypted = decryptVaultFile(vaultFile, password);
    this.state = withDefaultSettings(JSON.parse(decrypted) as VaultState);
    this.password = password;
    this.cachedSecurity = this.state.settings!.security;
    return this.state.records;
  }

  lock(): void {
    this.state = null;
    this.password = null;
  }

  isLocked(): boolean {
    return this.state === null;
  }

  getSecuritySettings(): SecuritySettings {
    if (this.state) return this.state.settings?.security ?? INITIAL_STATE.settings!.security;
    return this.cachedSecurity ?? INITIAL_STATE.settings!.security;
  }

  async changePassword(oldPassword: string, newPassword: string): Promise<void> {
    assertPassword(oldPassword);
    assertPassword(newPassword);
    this.requireState();
    if (!await exists(this.vaultPath)) throw new Error("Vault file is missing.");
    const raw = await fs.readFile(this.vaultPath, "utf8");
    const vaultFile = JSON.parse(raw) as VaultFile;
    decryptVaultFile(vaultFile, oldPassword);
    this.password = newPassword;
    await this.persist();
  }

  list(): PasteRecord[] {
    return [...this.requireState().records].sort(byUpdatedDesc);
  }

  async createRecord(input: CreatePasteInput): Promise<PasteRecord> {
    const state = this.requireState();
    const record = this.buildRecord(input);
    state.records.unshift(record);
    await this.persist();
    return record;
  }

  async updateRecord(input: UpdatePasteInput): Promise<PasteRecord> {
    const state = this.requireState();
    const record = state.records.find((candidate) => candidate.id === input.id);
    if (!record) throw new Error("Record not found.");

    if (typeof input.content === "string") {
      const content = input.content.trim();
      if (!content) throw new Error("Content is required.");
      const classification = classifyContent(content);
      record.content = content;
      record.autoTags = classification.autoTags;
      record.sensitivity = classification.sensitivity;
      record.contentKind = classification.contentKind;
      record.contentHash = sha256(content);
      if (!input.title) record.title = classification.title;
    }

    if (typeof input.title === "string") record.title = normalizeTitle(input.title);
    if (input.manualTags) record.manualTags = input.manualTags;
    record.updatedAt = new Date().toISOString();

    await this.persist();
    return record;
  }

  async deleteRecord(id: string): Promise<void> {
    const state = this.requireState();
    const nextRecords = state.records.filter((record) => record.id !== id);
    if (nextRecords.length === state.records.length) throw new Error("Record not found.");
    state.records = nextRecords;
    await this.persist();
  }

  async deleteRecords(ids: string[]): Promise<PasteRecord[]> {
    const state = this.requireState();
    const targetIds = new Set(ids);
    if (targetIds.size === 0) return this.list();

    const before = state.records.length;
    state.records = state.records.filter((record) => !targetIds.has(record.id));
    if (state.records.length === before) throw new Error("No selected records were found.");

    await this.persist();
    return this.list();
  }

  async archiveRecords(input: ArchiveRecordsInput): Promise<PasteRecord[]> {
    const state = this.requireState();
    const ids = new Set(input.ids);
    if (ids.size === 0) return this.list();

    const now = new Date().toISOString();
    const archiveName = normalizeArchiveName(input.archiveName) || `Archive ${now.slice(0, 10)}`;
    let changed = false;

    for (const record of state.records) {
      if (!ids.has(record.id)) continue;
      if (input.archived) {
        record.archivedAt = now;
        record.archiveName = archiveName;
      } else {
        delete record.archivedAt;
        delete record.archiveName;
      }
      record.updatedAt = now;
      changed = true;
    }

    if (changed) await this.persist();
    return this.list();
  }

  async importTextFolder(): Promise<ImportResult> {
    const preview = await this.previewImportTextFolder();
    if (!preview.batchId) {
      return { imported: 0, skipped: preview.skipped, errors: preview.errors };
    }
    return this.confirmImport({
      batchId: preview.batchId,
      itemIds: preview.items.map((item) => item.id)
    });
  }

  async previewImportTextFolder(): Promise<ImportPreview> {
    const selection = await dialog.showOpenDialog({
      title: "Import text and table files",
      properties: ["openFile", "openDirectory", "multiSelections"],
      filters: [
        { name: "Supported files", extensions: ["txt", "md", "csv", "xlsx", "xls"] },
        { name: "All files", extensions: ["*"] }
      ]
    });
    if (selection.canceled || selection.filePaths.length === 0) {
      return emptyImportPreview();
    }

    return this.previewImportPaths(selection.filePaths);
  }

  async scanDesktop(): Promise<ImportPreview> {
    const desktop = path.join(app.getPath("home"), "Desktop");
    if (!await exists(desktop)) {
      return emptyImportPreview();
    }
    const files = await collectSupportedFiles([desktop]);
    const textFiles = files.filter((file) => {
      const ext = path.extname(file).toLowerCase();
      return ext === ".txt" || ext === ".md";
    });
    if (textFiles.length === 0) return emptyImportPreview();
    return this.previewImportPaths(textFiles);
  }

  async importPaths(inputPaths: string[]): Promise<ImportResult> {
    const preview = await this.previewImportPaths(inputPaths);
    if (!preview.batchId) {
      return { imported: 0, skipped: preview.skipped, errors: preview.errors };
    }
    return this.confirmImport({
      batchId: preview.batchId,
      itemIds: preview.items.map((item) => item.id)
    });
  }

  async previewImportPaths(inputPaths: string[]): Promise<ImportPreview> {
    const state = this.requireState();
    this.cleanupImportPreviewBatches();

    const files = await collectSupportedFiles(inputPaths);
    const seenHashes = new Set(state.records.map((record) => record.contentHash));
    const batch: ImportPreviewBatch = {
      items: [],
      totalCandidates: 0,
      skipped: 0,
      errors: [],
      createdAt: Date.now()
    };

    for (const file of files) {
      try {
        const candidates = await this.readImportCandidates(file);
        for (const candidate of candidates) {
          batch.totalCandidates += 1;

          const content = candidate.content.trim();
          if (!content) {
            batch.skipped += 1;
            continue;
          }

          const contentHash = sha256(content);
          if (seenHashes.has(contentHash)) {
            batch.skipped += 1;
            continue;
          }

          const classification = classifyContent(content);
          batch.items.push({
            id: crypto.randomUUID(),
            sourcePath: candidate.sourcePath,
            sourceLabel: candidate.sourceLabel,
            title: normalizeTitle(candidate.title || classification.title),
            content,
            manualTags: uniqueTags(candidate.tags),
            contentHash,
            classification
          });
          seenHashes.add(contentHash);
        }
      } catch (error) {
        batch.errors.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const batchId = this.rememberImportPreviewBatch(batch);
    return toImportPreview(batchId, batch);
  }

  async confirmImport(input: ConfirmImportInput): Promise<ImportResult> {
    const state = this.requireState();
    const batch = this.importPreviewBatches.get(input.batchId);
    if (!batch) throw new Error("Import preview expired. Scan the files again.");

    this.importPreviewBatches.delete(input.batchId);

    const selectedIds = new Set(input.itemIds);
    const selectedItems = batch.items.filter((item) => selectedIds.has(item.id));
    const knownHashes = new Set(state.records.map((record) => record.contentHash));
    const result: ImportResult = {
      imported: 0,
      skipped: batch.skipped + (batch.items.length - selectedItems.length),
      errors: [...batch.errors]
    };

    for (const item of selectedItems) {
      if (knownHashes.has(item.contentHash)) {
        result.skipped += 1;
        continue;
      }

      const record = this.buildRecord({
        content: item.content,
        title: item.title,
        manualTags: item.manualTags
      });
      state.records.unshift(record);
      knownHashes.add(record.contentHash);
      result.imported += 1;
    }

    if (result.imported > 0) await this.persist();
    return result;
  }

  getSettings(): AppSettings {
    return this.requireState().settings ?? INITIAL_STATE.settings!;
  }

  async saveSettings(settings: AppSettings): Promise<AppSettings> {
    const state = this.requireState();
    state.settings = normalizeSettings(settings);
    this.cachedSecurity = state.settings.security;
    await this.persist();
    return state.settings;
  }

  async exportVault(): Promise<string | null> {
    const state = this.requireState();
    const selection = await dialog.showSaveDialog({
      title: "Export decrypted PasteVault JSON",
      defaultPath: `pastevault-export-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }]
    });
    if (selection.canceled || !selection.filePath) return null;

    await fs.writeFile(selection.filePath, JSON.stringify(state, null, 2), "utf8");
    return selection.filePath;
  }

  private requireState(): VaultState {
    if (!this.state) throw new Error("Vault is locked.");
    return this.state;
  }

  private buildRecord(input: CreatePasteInput): PasteRecord {
    const content = input.content.trim();
    if (!content) throw new Error("Content is required.");

    const classification = classifyContent(content);
    const now = new Date().toISOString();
    return {
      id: crypto.randomUUID(),
      title: normalizeTitle(input.title || classification.title),
      content,
      autoTags: classification.autoTags,
      manualTags: uniqueTags(input.manualTags ?? []),
      sensitivity: classification.sensitivity,
      contentKind: classification.contentKind,
      createdAt: now,
      updatedAt: now,
      contentHash: sha256(content)
    };
  }

  private async readImportCandidates(file: string): Promise<ImportRecordCandidate[]> {
    const extension = path.extname(file).toLowerCase();
    const sourceLabel = path.basename(file);

    if (extension === ".txt" || extension === ".md") {
      const content = (await readTextFile(file)).trim();
      return [
        {
          sourcePath: file,
          sourceLabel,
          title: path.basename(file, path.extname(file)),
          content,
          tags: [extension.slice(1), "imported"]
        }
      ];
    }

    if (extension === ".csv") {
      const text = await readTextFile(file);
      const parsed = parseCsv(text);
      return tableRowsToRecords(parsed.rows, sourceLabel, ["csv", "imported", "table"]).map((candidate) => ({
        ...candidate,
        sourcePath: file,
        sourceLabel
      }));
    }

    if (extension === ".xlsx") {
      const sheets = await readXlsxFile(file);
      return sheets.map((sheet) => {
        const sheetLabel = `${path.basename(file)} / ${sheet.sheet}`;
        const stringRows = sheet.data.map((row) => row.map((cell) => (cell == null ? "" : String(cell))));
        const markdownTable = tableRowsToMarkdown(stringRows);
        return {
          sourcePath: file,
          sourceLabel: sheetLabel,
          title: sheetLabel,
          content: markdownTable ? `# ${sheetLabel}\n\n${markdownTable}` : "",
          tags: ["xlsx", "imported", "table", normalizeTag(sheet.sheet)]
        };
      });
    }

    if (extension === ".xls") {
      throw new Error("Legacy .xls is not supported yet. Save it as .xlsx or .csv and import again.");
    }

    return [];
  }

  private rememberImportPreviewBatch(batch: ImportPreviewBatch): string | null {
    if (batch.items.length === 0) return null;
    const batchId = crypto.randomUUID();
    this.importPreviewBatches.set(batchId, batch);
    return batchId;
  }

  private cleanupImportPreviewBatches(): void {
    const expiresBefore = Date.now() - IMPORT_PREVIEW_TTL_MS;
    for (const [batchId, batch] of this.importPreviewBatches) {
      if (batch.createdAt < expiresBefore) this.importPreviewBatches.delete(batchId);
    }
  }

  private async persist(): Promise<void> {
    if (!this.state || !this.password) throw new Error("Vault is locked.");
    const dir = path.dirname(this.vaultPath);
    await fs.mkdir(dir, { recursive: true });
    const encrypted = encryptVaultState(this.state, this.password);
    const payload = JSON.stringify(encrypted, null, 2);
    const tmpPath = `${this.vaultPath}.tmp-${process.pid}-${Date.now()}`;
    await fs.writeFile(tmpPath, payload, "utf8");
    await this.backupCurrentVault();
    await fs.rename(tmpPath, this.vaultPath);
  }

  private async backupCurrentVault(): Promise<void> {
    try {
      if (await exists(this.vaultPath)) {
        await fs.copyFile(this.vaultPath, `${this.vaultPath}.bak`);
      }
    } catch {
      // backup failure must not block the save
    }
  }
}

async function collectSupportedFiles(inputPaths: string[]): Promise<string[]> {
  const files: string[] = [];
  for (const inputPath of inputPaths) {
    const stats = await fs.stat(inputPath);
    if (stats.isDirectory()) {
      files.push(...(await collectSupportedFiles(await childPaths(inputPath))));
    } else if (stats.isFile() && isSupportedImportFile(inputPath)) {
      files.push(inputPath);
    }
  }
  return files;
}

async function childPaths(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  return entries.map((entry) => path.join(root, entry.name));
}

function isSupportedImportFile(file: string): boolean {
  return [".txt", ".md", ".csv", ".xlsx", ".xls"].includes(path.extname(file).toLowerCase());
}

async function readTextFile(file: string): Promise<string> {
  const buffer = await fs.readFile(file);
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(buffer.subarray(2));
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(buffer.subarray(2));
  }
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return new TextDecoder("utf-8").decode(buffer.subarray(3));
  }

  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  if (!utf8.includes("\uFFFD")) return utf8;

  for (const encoding of ["gb18030", "big5", "windows-1252"]) {
    try {
      const decoded = new TextDecoder(encoding, { fatal: false }).decode(buffer);
      if (!decoded.includes("\uFFFD")) return decoded;
    } catch {
      continue;
    }
  }

  return utf8;
}

function withDefaultSettings(state: VaultState): VaultState {
  return {
    ...state,
    settings: normalizeSettings(state.settings ?? INITIAL_STATE.settings!)
  };
}

function normalizeSettings(settings: AppSettings): AppSettings {
  return {
    model: {
      enabled: Boolean(settings.model.enabled),
      provider: settings.model.provider || "openai-compatible",
      baseUrl: settings.model.baseUrl.trim(),
      apiKey: settings.model.apiKey.trim(),
      model: settings.model.model.trim()
    },
    security: {
      idleTimeoutMinutes: clampInt(settings.security?.idleTimeoutMinutes, 0, 0, 240),
      clipboardClearSeconds: clampInt(settings.security?.clipboardClearSeconds, 30, 0, 300)
    }
  };
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function assertPassword(password: string): void {
  if (password.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }
}

function normalizeTitle(title: string): string {
  const normalized = title.trim().replace(/\s+/g, " ");
  if (!normalized) return "Untitled paste";
  return normalized.length <= 96 ? normalized : `${normalized.slice(0, 95)}...`;
}

function normalizeArchiveName(name?: string): string {
  const normalized = (name ?? "").trim().replace(/\s+/g, " ");
  if (!normalized) return "";
  return normalized.length <= 80 ? normalized : `${normalized.slice(0, 79)}...`;
}

function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase().replace(/\s+/g, "-");
}

function uniqueTags(tags: string[]): string[] {
  return Array.from(new Set(tags.map((tag) => normalizeTag(tag)).filter(Boolean)));
}

function emptyImportPreview(): ImportPreview {
  return {
    batchId: null,
    totalCandidates: 0,
    importable: 0,
    skipped: 0,
    errors: [],
    items: []
  };
}

function toImportPreview(batchId: string | null, batch: ImportPreviewBatch): ImportPreview {
  return {
    batchId,
    totalCandidates: batch.totalCandidates,
    importable: batch.items.length,
    skipped: batch.skipped,
    errors: batch.errors,
    items: batch.items.map(toImportPreviewItem)
  };
}

function toImportPreviewItem(candidate: ImportPreviewCandidate): ImportPreviewItem {
  const previewContent =
    candidate.classification.sensitivity === "high" ? redactSensitiveContent(candidate.content) : candidate.content;
  return {
    id: candidate.id,
    sourcePath: candidate.sourcePath,
    sourceLabel: candidate.sourceLabel,
    title: candidate.title,
    contentPreview: buildContentPreview(previewContent),
    manualTags: candidate.manualTags,
    autoTags: candidate.classification.autoTags,
    sensitivity: candidate.classification.sensitivity,
    contentKind: candidate.classification.contentKind,
    sensitiveMatchCount: candidate.classification.sensitiveMatches.reduce((total, match) => total + match.count, 0),
    contentHash: candidate.contentHash
  };
}

function buildContentPreview(content: string): string {
  const trimmed = content.trim();
  if (trimmed.length <= IMPORT_CONTENT_PREVIEW_LENGTH) return trimmed;
  return `${trimmed.slice(0, IMPORT_CONTENT_PREVIEW_LENGTH - 3)}...`;
}

function sha256(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function byUpdatedDesc(a: PasteRecord, b: PasteRecord): number {
  return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
}
