export type Sensitivity = "none" | "low" | "high";

export type ContentKind =
  | "url"
  | "account"
  | "secret"
  | "resume"
  | "job"
  | "api-doc"
  | "note";

export interface PasteRecord {
  id: string;
  title: string;
  content: string;
  autoTags: string[];
  manualTags: string[];
  sensitivity: Sensitivity;
  contentKind: ContentKind;
  createdAt: string;
  updatedAt: string;
  contentHash: string;
  archivedAt?: string;
  archiveName?: string;
}

export interface VaultState {
  version: 1;
  records: PasteRecord[];
  settings?: AppSettings;
}

export interface ModelSettings {
  enabled: boolean;
  provider: "openai-compatible" | "openai" | "anthropic" | "custom";
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface SecuritySettings {
  idleTimeoutMinutes: number;
  clipboardClearSeconds: number;
}

export interface AppSettings {
  model: ModelSettings;
  security: SecuritySettings;
}

export interface VaultSummary {
  exists: boolean;
  path: string;
}

export interface Classification {
  title: string;
  autoTags: string[];
  sensitivity: Sensitivity;
  contentKind: ContentKind;
  sensitiveMatches: SensitiveMatch[];
}

export interface SensitiveMatch {
  label: string;
  pattern: string;
  severity: "high" | "low";
  count: number;
}

export interface CreatePasteInput {
  content: string;
  title?: string;
  manualTags?: string[];
}

export interface UpdatePasteInput {
  id: string;
  title?: string;
  content?: string;
  manualTags?: string[];
}

export interface SearchFilters {
  query: string;
  tag: string;
  sensitivity: "all" | Sensitivity;
}

export interface SearchResult {
  record: PasteRecord;
  score: number;
  snippet: string;
}

export interface ImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

export interface ImportPreviewItem {
  id: string;
  sourcePath: string;
  sourceLabel: string;
  title: string;
  contentPreview: string;
  manualTags: string[];
  autoTags: string[];
  sensitivity: Sensitivity;
  contentKind: ContentKind;
  sensitiveMatchCount: number;
  contentHash: string;
}

export interface ImportPreview {
  batchId: string | null;
  totalCandidates: number;
  importable: number;
  skipped: number;
  errors: string[];
  items: ImportPreviewItem[];
}

export interface ConfirmImportInput {
  batchId: string;
  itemIds: string[];
}

export interface ArchiveRecordsInput {
  ids: string[];
  archived: boolean;
  archiveName?: string;
}

export interface AppApi {
  getVaultSummary(): Promise<VaultSummary>;
  createVault(password: string): Promise<PasteRecord[]>;
  unlockVault(password: string): Promise<PasteRecord[]>;
  lockVault(): Promise<void>;
  changeVaultPassword(oldPassword: string, newPassword: string): Promise<void>;
  listRecords(): Promise<PasteRecord[]>;
  createRecord(input: CreatePasteInput): Promise<PasteRecord>;
  updateRecord(input: UpdatePasteInput): Promise<PasteRecord>;
  deleteRecord(id: string): Promise<void>;
  deleteRecords(ids: string[]): Promise<PasteRecord[]>;
  archiveRecords(input: ArchiveRecordsInput): Promise<PasteRecord[]>;
  classify(content: string): Promise<Classification>;
  importTextFolder(): Promise<ImportResult>;
  importPaths(paths: string[]): Promise<ImportResult>;
  previewImportTextFolder(): Promise<ImportPreview>;
  previewImportPaths(paths: string[]): Promise<ImportPreview>;
  scanDesktop(): Promise<ImportPreview>;
  confirmImport(input: ConfirmImportInput): Promise<ImportResult>;
  getPathForFile(file: File): string;
  exportVault(): Promise<string | null>;
  getSettings(): Promise<AppSettings>;
  saveSettings(settings: AppSettings): Promise<AppSettings>;
  getClipboardHistory(): Promise<string[]>;
  scheduleClipboardClear(seconds: number): Promise<void>;
  showWindow(): Promise<void>;
  onClipboardCapture(handler: (text: string) => void): () => void;
  onClipboardHistoryUpdated(handler: (history: string[]) => void): () => void;
  onAutoLocked(handler: () => void): () => void;
}

declare global {
  interface Window {
    pasteVault?: AppApi;
  }
}
