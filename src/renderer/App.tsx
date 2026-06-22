import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  CheckSquare,
  Copy,
  Download,
  Eye,
  EyeOff,
  FileInput,
  FileText,
  KeyRound,
  LockKeyhole,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings,
  Save,
  Search,
  Square,
  Tags,
  Trash2,
  UnlockKeyhole,
  X
} from "lucide-react";
import { DragEvent, FormEvent, useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { classifyContent, parseManualTags, redactSensitiveContent } from "../shared/classifier";
import {
  extractSecretsFromRecords,
  maskSecret,
  type ExtractedApiKey,
  type ExtractedPassword
} from "../shared/extractors";
import { collectTags, searchRecords } from "../shared/search";
import type { AppSettings, Classification, ImportPreview, PasteRecord, SearchFilters, VaultSummary } from "../shared/types";

type Screen = "loading" | "unavailable" | "create" | "unlock" | "ready";
type KindFilter = "all" | "url" | "account" | "secret" | "resume" | "job" | "api-doc" | "note" | "archived";

const kindLabels: Record<KindFilter, string> = {
  all: "All",
  url: "Links",
  account: "Accounts",
  secret: "Sensitive",
  resume: "Resumes",
  job: "Jobs",
  "api-doc": "API docs",
  note: "Notes",
  archived: "Archived"
};

const kindOrder: KindFilter[] = ["all", "url", "account", "secret", "resume", "job", "api-doc", "note", "archived"];

interface Command {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
  disabled?: boolean;
}

const emptyFilters: SearchFilters = {
  query: "",
  tag: "all",
  sensitivity: "all"
};

const emptyDraft = {
  content: "",
  title: "",
  manualTags: ""
};

const defaultSettings: AppSettings = {
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
};

export function App() {
  const api = window.pasteVault;
  const [screen, setScreen] = useState<Screen>("loading");
  const [summary, setSummary] = useState<VaultSummary | null>(null);
  const [password, setPassword] = useState("");
  const [records, setRecords] = useState<PasteRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filters, setFilters] = useState<SearchFilters>(emptyFilters);
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [showCapture, setShowCapture] = useState(false);
  const [showSecrets, setShowSecrets] = useState(false);
  const [revealedSecretIds, setRevealedSecretIds] = useState<Set<string>>(new Set());
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [selectedImportIds, setSelectedImportIds] = useState<Set<string>>(new Set());
  const [resultsCollapsed, setResultsCollapsed] = useState(false);
  const [selectedResultIds, setSelectedResultIds] = useState<Set<string>>(new Set());
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [resultPaneWidth, setResultPaneWidth] = useState(380);
  const [draft, setDraft] = useState(emptyDraft);
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState(emptyDraft);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [clipboardHistory, setClipboardHistory] = useState<string[]>([]);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const summaryRef = useRef<VaultSummary | null>(null);
  summaryRef.current = summary;

  useEffect(() => {
    if (!api) {
      setScreen("unavailable");
      return;
    }

    api
      .getVaultSummary()
      .then((nextSummary) => {
        setSummary(nextSummary);
        setScreen(nextSummary.exists ? "unlock" : "create");
      })
      .catch((err) => {
        setError(readError(err));
        setScreen("unavailable");
      });
  }, [api]);

  useEffect(() => {
    if (!api) return;
    const offCapture = api.onClipboardCapture((text) => {
      setDraft({ content: text, title: "", manualTags: "" });
      setShowCapture(true);
    });
    const offHistory = api.onClipboardHistoryUpdated(setClipboardHistory);
    const offAutoLock = api.onAutoLocked(() => {
      setRecords([]);
      setSelectedId(null);
      setSelectedResultIds(new Set());
      setShowSecrets(false);
      setRevealedSecretIds(new Set());
      setImportPreview(null);
      setSelectedImportIds(new Set());
      setClipboardHistory([]);
      setScreen(summaryRef.current?.exists === false ? "create" : "unlock");
    });
    return () => {
      offCapture();
      offHistory();
      offAutoLock();
    };
  }, [api]);

  const visibleRecords = useMemo(() => {
    if (kindFilter === "all") return records.filter((r) => !r.archivedAt);
    if (kindFilter === "archived") return records.filter((r) => r.archivedAt);
    return records.filter((r) => !r.archivedAt && r.contentKind === kindFilter);
  }, [kindFilter, records]);

  const kindCounts = useMemo(() => {
    const counts = new Map<KindFilter, number>();
    for (const r of records) {
      if (r.archivedAt) {
        counts.set("archived", (counts.get("archived") ?? 0) + 1);
      } else {
        counts.set(r.contentKind as KindFilter, (counts.get(r.contentKind as KindFilter) ?? 0) + 1);
        counts.set("all", (counts.get("all") ?? 0) + 1);
      }
    }
    return counts;
  }, [records]);

  const selected = useMemo(
    () => visibleRecords.find((record) => record.id === selectedId) ?? visibleRecords[0] ?? null,
    [selectedId, visibleRecords]
  );
  const extractedSecrets = useMemo(() => extractSecretsFromRecords(records), [records]);

  useEffect(() => {
    if (selected && selected.id !== selectedId) setSelectedId(selected.id);
    if (!selected) setSelectedId(null);
  }, [selected, selectedId]);

  useEffect(() => {
    setRevealed(false);
    setEditing(false);
  }, [selected?.id]);

  const classification = useMemo<Classification | null>(() => {
    return draft.content.trim() ? classifyContent(draft.content) : null;
  }, [draft.content]);

  const results = useMemo(() => searchRecords(visibleRecords, filters), [visibleRecords, filters]);
  const tags = useMemo(() => collectTags(visibleRecords), [visibleRecords]);
  const visibleResultIds = useMemo(() => results.map(({ record }) => record.id), [results]);
  const allVisibleResultsSelected =
    visibleResultIds.length > 0 && visibleResultIds.every((id) => selectedResultIds.has(id));

  function moveSelection(delta: number) {
    if (results.length === 0) return;
    const currentIndex = results.findIndex((r) => r.record.id === selected?.id);
    const nextIndex = Math.max(0, Math.min(results.length - 1, (currentIndex < 0 ? 0 : currentIndex) + delta));
    setSelectedId(results[nextIndex].record.id);
  }

  useEffect(() => {
    setSelectedResultIds((current) => {
      const knownIds = new Set(records.map((record) => record.id));
      return new Set(Array.from(current).filter((id) => knownIds.has(id)));
    });
  }, [records]);

  async function handlePasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!api) return;
    setBusy(true);
    setError(null);
    try {
      const nextRecords = screen === "create" ? await api.createVault(password) : await api.unlockVault(password);
      const nextSettings = await api.getSettings();
      setRecords(nextRecords);
      setSettings(nextSettings);
      setSelectedId(nextRecords[0]?.id ?? null);
      setPassword("");
      setScreen("ready");
    } catch (err) {
      setError(readError(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateRecord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!api || !draft.content.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api.createRecord({
        content: draft.content,
        title: draft.title,
        manualTags: parseManualTags(draft.manualTags)
      });
      setKindFilter("all");
      setRecords([created, ...records]);
      setSelectedId(created.id);
      setDraft(emptyDraft);
      setShowCapture(false);
      setNotice("Saved.");
    } catch (err) {
      setError(readError(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleImport() {
    if (!api) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const preview = await api.previewImportTextFolder();
      openImportPreview(preview);
    } catch (err) {
      setError(readError(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleScanDesktop() {
    if (!api) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const preview = await api.scanDesktop();
      if (!preview.batchId || preview.items.length === 0) {
        setNotice(
          preview.totalCandidates === 0
            ? "No txt/md files found on Desktop."
            : `No new files to import. Skipped ${preview.skipped}.`
        );
      } else {
        openImportPreview(preview);
      }
    } catch (err) {
      setError(readError(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleExport() {
    if (!api) return;
    const confirmed = window.confirm("This exports decrypted JSON. Continue?");
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    try {
      const filePath = await api.exportVault();
      if (filePath) setNotice(`Exported to ${filePath}`);
    } catch (err) {
      setError(readError(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleLock() {
    if (!api) return;
    await api.lockVault();
    setRecords([]);
    setSelectedId(null);
    setSelectedResultIds(new Set());
    setShowSecrets(false);
    setRevealedSecretIds(new Set());
    setImportPreview(null);
    setSelectedImportIds(new Set());
    setScreen(summary?.exists === false ? "create" : "unlock");
  }

  async function handleDelete(record: PasteRecord) {
    if (!api) return;
    const confirmed = window.confirm(`Delete "${record.title}"?`);
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteRecord(record.id);
      const nextRecords = records.filter((item) => item.id !== record.id);
      setRecords(nextRecords);
      setSelectedResultIds((current) => {
        const next = new Set(current);
        next.delete(record.id);
        return next;
      });
      setSelectedId(nextRecords[0]?.id ?? null);
    } catch (err) {
      setError(readError(err));
    } finally {
      setBusy(false);
    }
  }

  function toggleResultSelection(id: string) {
    setSelectedResultIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function setVisibleResultsSelected(selected: boolean) {
    setSelectedResultIds((current) => {
      const next = new Set(current);
      for (const id of visibleResultIds) {
        if (selected) {
          next.add(id);
        } else {
          next.delete(id);
        }
      }
      return next;
    });
  }

  async function handleDeleteSelectedResults() {
    if (!api || selectedResultIds.size === 0) return;
    const count = selectedResultIds.size;
    const confirmed = window.confirm(`Delete ${count} selected item${count === 1 ? "" : "s"}?`);
    if (!confirmed) return;

    setBusy(true);
    setError(null);
    try {
      const nextRecords = await api.deleteRecords(Array.from(selectedResultIds));
      setRecords(nextRecords);
      setSelectedResultIds(new Set());
      setSelectedId(nextRecords[0]?.id ?? null);
      setNotice(`Deleted ${count} item${count === 1 ? "" : "s"}.`);
    } catch (err) {
      setError(readError(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleArchiveSelectedResults(archived: boolean) {
    if (!api || selectedResultIds.size === 0) return;
    const count = selectedResultIds.size;
    const archiveName = archived
      ? window.prompt("Archive name", `Archive ${new Date().toISOString().slice(0, 10)}`)
      : "";
    if (archived && archiveName === null) return;

    setBusy(true);
    setError(null);
    try {
      const nextRecords = await api.archiveRecords({
        ids: Array.from(selectedResultIds),
        archived,
        archiveName: archiveName ?? undefined
      });
      setRecords(nextRecords);
      setSelectedResultIds(new Set());
      setSelectedId(nextRecords.find((record) => (kindFilter === "archived" ? record.archivedAt : !record.archivedAt))?.id ?? null);
      setNotice(
        archived
          ? `Archived ${count} item${count === 1 ? "" : "s"}.`
          : `Restored ${count} item${count === 1 ? "" : "s"}.`
      );
    } catch (err) {
      setError(readError(err));
    } finally {
      setBusy(false);
    }
  }

  function handlePaneDividerPointerDown(event: PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = resultPaneWidth;

    const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
      const nextWidth = Math.min(640, Math.max(260, startWidth + moveEvent.clientX - startX));
      setResultPaneWidth(nextWidth);
    };
    const handlePointerUp = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
  }

  function startEditing(record: PasteRecord) {
    setEditDraft({
      title: record.title,
      content: record.content,
      manualTags: record.manualTags.join(", ")
    });
    setEditing(true);
  }

  async function handleUpdateRecord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!api || !selected) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api.updateRecord({
        id: selected.id,
        title: editDraft.title,
        content: editDraft.content,
        manualTags: parseManualTags(editDraft.manualTags)
      });
      setRecords(records.map((record) => (record.id === updated.id ? updated : record)));
      setEditing(false);
      setNotice("Updated.");
    } catch (err) {
      setError(readError(err));
    } finally {
      setBusy(false);
    }
  }

  async function copyRecord(record: PasteRecord, displayContent: string) {
    const fullSensitive = record.sensitivity === "high" && displayContent !== record.content;
    if (fullSensitive && !window.confirm("Copy full sensitive content?")) return;
    await navigator.clipboard.writeText(fullSensitive ? record.content : displayContent);
    scheduleClipboardClear();
    setNotice("Copied.");
  }

  async function copySecret(value: string) {
    if (!window.confirm("Copy sensitive value?")) return;
    await navigator.clipboard.writeText(value);
    scheduleClipboardClear();
    setNotice("Copied.");
  }

  function scheduleClipboardClear() {
    const seconds = settings.security.clipboardClearSeconds;
    if (api && seconds > 0) void api.scheduleClipboardClear(seconds);
  }

  function toggleSecretReveal(id: string) {
    setRevealedSecretIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function openSecretSource(recordId: string) {
    setKindFilter("all");
    setSelectedId(recordId);
    setShowSecrets(false);
  }

  async function handleDroppedFiles(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setDragging(false);
    if (!api) return;

    const paths = Array.from(event.dataTransfer.files)
      .map((file) => api.getPathForFile(file))
      .filter(Boolean);

    if (!paths.length) {
      setError("No readable files were dropped.");
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const preview = await api.previewImportPaths(paths);
      openImportPreview(preview);
    } catch (err) {
      setError(readError(err));
    } finally {
      setBusy(false);
    }
  }

  function openImportPreview(preview: ImportPreview) {
    setImportPreview(null);
    setSelectedImportIds(new Set());

    if (!preview.batchId || preview.items.length === 0) {
      setNotice(`No new records found. Skipped ${preview.skipped}.`);
      if (preview.errors.length) setError(preview.errors.slice(0, 5).join("\n"));
      return;
    }

    setImportPreview(preview);
    setSelectedImportIds(new Set(preview.items.map((item) => item.id)));
    if (preview.errors.length) setError(preview.errors.slice(0, 5).join("\n"));
  }

  function toggleImportItem(id: string) {
    const nextIds = new Set(selectedImportIds);
    if (nextIds.has(id)) {
      nextIds.delete(id);
    } else {
      nextIds.add(id);
    }
    setSelectedImportIds(nextIds);
  }

  function setAllImportItems(selected: boolean) {
    setSelectedImportIds(selected && importPreview ? new Set(importPreview.items.map((item) => item.id)) : new Set());
  }

  function closeImportPreview() {
    setImportPreview(null);
    setSelectedImportIds(new Set());
  }

  async function handleConfirmImport() {
    if (!api || !importPreview?.batchId) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.confirmImport({
        batchId: importPreview.batchId,
        itemIds: Array.from(selectedImportIds)
      });
      const nextRecords = await api.listRecords();
      setRecords(nextRecords);
      setSelectedId(nextRecords[0]?.id ?? null);
      closeImportPreview();
      setNotice(`Imported ${result.imported}, skipped ${result.skipped}.`);
      if (result.errors.length) setError(result.errors.slice(0, 5).join("\n"));
    } catch (err) {
      setError(readError(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveSettings(nextSettings: AppSettings) {
    if (!api) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await api.saveSettings(nextSettings);
      setSettings(saved);
      setShowSettings(false);
      setNotice("BYOK settings saved in the encrypted vault.");
    } catch (err) {
      setError(readError(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleChangePassword(oldPassword: string, newPassword: string) {
    if (!api) return;
    setBusy(true);
    setError(null);
    try {
      await api.changeVaultPassword(oldPassword, newPassword);
      setNotice("Master password changed.");
    } catch (err) {
      setError(readError(err));
      throw err;
    } finally {
      setBusy(false);
    }
  }

  const commands: Command[] = [
    { id: "new", label: "New paste", run: () => setShowCapture(true), disabled: busy },
    { id: "import", label: "Import files", run: handleImport, disabled: busy },
    { id: "settings", label: "BYOK settings", run: () => setShowSettings(true), disabled: busy },
    { id: "secrets", label: "View extracted snippets", run: () => setShowSecrets(true), disabled: busy },
    { id: "export", label: "Export vault", run: handleExport, disabled: busy || records.length === 0 },
    { id: "lock", label: "Lock vault", run: handleLock },
    { id: "active", label: "Show active records", run: () => setKindFilter("all") },
    { id: "archived", label: "Show archived records", run: () => setKindFilter("archived") },
    { id: "notes", label: "Show notes", run: () => setKindFilter("note") },
    { id: "search", label: "Focus search", hint: "/", run: () => searchInputRef.current?.focus() },
    { id: "clear-search", label: "Clear search and filters", run: () => setFilters(emptyFilters) }
  ];

  useEffect(() => {
    if (screen !== "ready") return;
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const inField =
        target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;
      if ((event.ctrlKey || event.metaKey) && (event.key === "k" || event.key === "K")) {
        event.preventDefault();
        setShowCommandPalette(true);
        return;
      }
      if (showCommandPalette || showCapture || showSettings || showSecrets || importPreview) return;
      if (inField) {
        if (event.key === "Escape" && filters.query) {
          setFilters(emptyFilters);
        }
        return;
      }
      if (event.key === "/") {
        event.preventDefault();
        searchInputRef.current?.focus();
      } else if (event.key === "j" || event.key === "ArrowDown") {
        event.preventDefault();
        moveSelection(1);
      } else if (event.key === "k" || event.key === "ArrowUp") {
        event.preventDefault();
        moveSelection(-1);
      } else if (event.key === "y" && selected) {
        event.preventDefault();
        const display =
          selected.sensitivity === "high" && !revealed
            ? redactSensitiveContent(selected.content)
            : selected.content;
        void copyRecord(selected, display);
      } else if (event.key === "e" && selected) {
        event.preventDefault();
        startEditing(selected);
      } else if (event.key === "d" && selected) {
        event.preventDefault();
        void handleDelete(selected);
      } else if (event.key === "Escape" && filters.query) {
        setFilters(emptyFilters);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    screen,
    showCommandPalette,
    showCapture,
    showSettings,
    showSecrets,
    importPreview,
    filters.query,
    selected,
    revealed,
    results,
    busy,
    records.length
  ]);

  if (screen === "loading") {
    return <ShellMessage title="Loading PasteVault" />;
  }

  if (screen === "unavailable") {
    return (
      <ShellMessage
        title="Desktop API unavailable"
        detail="Run this inside Electron with npm run dev:desktop. The browser-only Vite preview cannot access the encrypted local vault."
      />
    );
  }

  if (screen === "create" || screen === "unlock") {
    return (
      <main className="auth-shell">
        <section className="auth-panel">
          <div className="brand-mark">
            {screen === "create" ? <KeyRound size={28} /> : <LockKeyhole size={28} />}
          </div>
          <h1>{screen === "create" ? "Create PasteVault" : "Unlock PasteVault"}</h1>
          <p className="muted">
            {screen === "create"
              ? "Set a master password for the local encrypted vault."
              : "Enter the master password for your local vault."}
          </p>
          <form className="auth-form" onSubmit={handlePasswordSubmit}>
            <label>
              Master password
              <input
                autoFocus
                type="password"
                minLength={8}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="At least 8 characters"
              />
            </label>
            <button className="primary-button" type="submit" disabled={busy || password.length < 8}>
              {screen === "create" ? <Save size={18} /> : <UnlockKeyhole size={18} />}
              {screen === "create" ? "Create vault" : "Unlock"}
            </button>
          </form>
          {summary?.path ? <p className="path-text">{summary.path}</p> : null}
          <Status error={error} notice={notice} />
        </section>
      </main>
    );
  }

  return (
    <main
      className={`app-shell ${dragging ? "dragging" : ""}`}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDragging(false);
      }}
      onDrop={handleDroppedFiles}
    >
      <header className="topbar">
        <div className="topbar-title">
          <LockKeyhole size={22} />
          <div>
            <h1>PasteVault</h1>
            <span>{records.length} saved items</span>
          </div>
        </div>
        <div className="topbar-filters">
          <label className="search-box">
            <Search size={16} />
            <input
              ref={searchInputRef}
              value={filters.query}
              onChange={(event) => setFilters({ ...filters, query: event.target.value })}
              placeholder="Search full text, URL, tag..."
            />
          </label>
          <select value={filters.tag} onChange={(event) => setFilters({ ...filters, tag: event.target.value })}>
            <option value="all">All tags</option>
            {tags.map((tag) => (
              <option value={tag} key={tag}>
                {tag}
              </option>
            ))}
          </select>
          <select
            value={filters.sensitivity}
            onChange={(event) =>
              setFilters({ ...filters, sensitivity: event.target.value as SearchFilters["sensitivity"] })
            }
          >
            <option value="all">All sensitivity</option>
            <option value="none">None</option>
            <option value="low">Low</option>
            <option value="high">High</option>
          </select>
        </div>
        <div className="topbar-actions">
          <button type="button" onClick={() => setShowCapture(true)} disabled={busy}>
            <Plus size={17} />
            New
          </button>
          <button type="button" onClick={handleScanDesktop} disabled={busy}>
            <FileInput size={17} />
            Scan Desktop
          </button>
          <button type="button" onClick={handleImport} disabled={busy}>
            <FileInput size={17} />
            Import
          </button>
          <button type="button" onClick={() => setShowSettings(true)} disabled={busy}>
            <Settings size={17} />
            BYOK
          </button>
          <button type="button" onClick={() => setShowSecrets(true)} disabled={busy}>
            <KeyRound size={17} />
            Extracted
          </button>
          <button type="button" onClick={handleExport} disabled={busy || records.length === 0}>
            <Download size={17} />
            Export
          </button>
          <button type="button" onClick={handleLock}>
            <LockKeyhole size={17} />
            Lock
          </button>
        </div>
      </header>

      <section
        className={`workspace ${resultsCollapsed ? "results-collapsed" : ""}`}
        style={
          resultsCollapsed
            ? undefined
            : {
                gridTemplateColumns: `${resultPaneWidth}px 6px minmax(420px, 1fr)`
              }
        }
      >
        <section className={`result-panel ${resultsCollapsed ? "collapsed" : ""}`}>
          {resultsCollapsed ? (
            <button className="collapse-toggle" type="button" onClick={() => setResultsCollapsed(false)}>
              <PanelLeftOpen size={18} />
            </button>
          ) : (
            <>
              <div className="kind-tabs">
                {kindOrder.map((kind) => {
                  const count = kindCounts.get(kind) ?? 0;
                  if (kind !== "all" && count === 0) return null;
                  return (
                    <button
                      key={kind}
                      type="button"
                      className={kindFilter === kind ? "active" : ""}
                      onClick={() => setKindFilter(kind)}
                    >
                      {kindLabels[kind]}
                      <span className="kind-count">{count}</span>
                    </button>
                  );
                })}
              </div>
              <div className="section-title result-title">
                <div className="result-title-label">
                  <FileText size={18} />
                  <h2>Results</h2>
                  <span>{results.length}</span>
                </div>
                <div className="result-tools">
                  <button
                    type="button"
                    onClick={() => setVisibleResultsSelected(!allVisibleResultsSelected)}
                    disabled={busy || results.length === 0}
                  >
                    {allVisibleResultsSelected ? <CheckSquare size={16} /> : <Square size={16} />}
                    All
                  </button>
                  <button
                    type="button"
                    onClick={() => handleArchiveSelectedResults(kindFilter !== "archived")}
                    disabled={busy || selectedResultIds.size === 0}
                  >
                    {kindFilter === "archived" ? <ArchiveRestore size={16} /> : <Archive size={16} />}
                    {kindFilter === "archived" ? "Restore" : "Archive"}
                  </button>
                  <button
                    className="danger-button"
                    type="button"
                    onClick={handleDeleteSelectedResults}
                    disabled={busy || selectedResultIds.size === 0}
                  >
                    <Trash2 size={16} />
                    Delete
                  </button>
                  <button type="button" onClick={() => setResultsCollapsed(true)}>
                    <PanelLeftClose size={16} />
                  </button>
                </div>
              </div>
              <div className="result-list">
                {results.map(({ record, snippet }) => (
                  <div className={`result-item ${record.id === selected?.id ? "active" : ""}`} key={record.id}>
                    <label className="result-select" aria-label={`Select ${record.title}`}>
                      <input
                        type="checkbox"
                        checked={selectedResultIds.has(record.id)}
                        onChange={() => toggleResultSelection(record.id)}
                      />
                    </label>
                    <button className="result-card-button" type="button" onClick={() => setSelectedId(record.id)}>
                      <div className="result-row">
                        <strong>{record.title}</strong>
                        <SensitivityBadge value={record.sensitivity} />
                      </div>
                      <p>{snippet || record.content.slice(0, 120)}</p>
                      <div className="tag-row">
                        {[...record.autoTags, ...record.manualTags].slice(0, 5).map((tag) => (
                          <span key={tag}>{tag}</span>
                        ))}
                      </div>
                      <time>{formatDate(record.updatedAt)}</time>
                    </button>
                  </div>
                ))}
                {results.length === 0 ? <div className="empty-state">No matching items.</div> : null}
              </div>
            </>
          )}
        </section>

        {resultsCollapsed ? null : (
          <div
            className="pane-divider"
            onPointerDown={handlePaneDividerPointerDown}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize results"
          />
        )}

        <section className="detail-panel">
          {selected ? (
            <RecordDetail
              record={selected}
              editing={editing}
              editDraft={editDraft}
              setEditDraft={setEditDraft}
              revealed={revealed}
              setRevealed={setRevealed}
              busy={busy}
              onEdit={() => startEditing(selected)}
              onCancel={() => setEditing(false)}
              onSave={handleUpdateRecord}
              onDelete={() => handleDelete(selected)}
              onCopy={copyRecord}
            />
          ) : (
            <div className="empty-state detail-empty">Save or import a paste to inspect it here.</div>
          )}
        </section>
      </section>

      {dragging ? (
        <div className="drop-overlay">
          <FileInput size={34} />
          <strong>Drop TXT, MD, CSV, XLSX files or folders</strong>
        </div>
      ) : null}

      {showCapture ? (
        <CaptureDialog
          draft={draft}
          classification={classification}
          busy={busy}
          clipboardHistory={clipboardHistory}
          onDraftChange={setDraft}
          onSave={handleCreateRecord}
          onClose={() => setShowCapture(false)}
        />
      ) : null}

      {showSettings ? (
        <SettingsDialog
          settings={settings}
          busy={busy}
          onSave={handleSaveSettings}
          onChangePassword={handleChangePassword}
          onClose={() => setShowSettings(false)}
        />
      ) : null}

      {showSecrets ? (
        <SecretsDialog
          secrets={extractedSecrets}
          revealedIds={revealedSecretIds}
          onToggleReveal={toggleSecretReveal}
          onCopy={copySecret}
          onOpenSource={openSecretSource}
          onClose={() => setShowSecrets(false)}
        />
      ) : null}

      {importPreview ? (
        <ImportPreviewDialog
          preview={importPreview}
          selectedIds={selectedImportIds}
          busy={busy}
          onToggle={toggleImportItem}
          onSelectAll={setAllImportItems}
          onCancel={closeImportPreview}
          onConfirm={handleConfirmImport}
        />
      ) : null}

      {showCommandPalette ? (
        <CommandPalette commands={commands} onClose={() => setShowCommandPalette(false)} />
      ) : null}

      <Status error={error} notice={notice} onDismiss={() => {
        setError(null);
        setNotice(null);
      }} />
    </main>
  );
}

interface SecretGroup<T> {
  id: string;
  title: string;
  subtitle: string;
  items: T[];
}

function groupApiKeys(items: ExtractedApiKey[]): Array<SecretGroup<ExtractedApiKey>> {
  const groups = new Map<string, SecretGroup<ExtractedApiKey>>();
  for (const item of items) {
    const title = [item.provider, item.model]
      .filter((value) => value && value !== "Review needed")
      .join(" / ") || "Review needed";
    const subtitle = item.tool ? `Tool: ${item.tool}` : `Source: ${item.sourceTitle}`;
    const key = `${title}|${subtitle}|${item.sourceRecordId}`;
    const group = groups.get(key) ?? { id: key, title, subtitle, items: [] };
    group.items.push(item);
    groups.set(key, group);
  }
  return Array.from(groups.values());
}

function groupPasswords(items: ExtractedPassword[]): Array<SecretGroup<ExtractedPassword>> {
  const groups = new Map<string, SecretGroup<ExtractedPassword>>();
  for (const item of items) {
    const title = item.site || "Review needed";
    const subtitle = item.tool ? `Tool: ${item.tool}` : `Source: ${item.sourceTitle}`;
    const key = `${title}|${subtitle}|${item.sourceRecordId}`;
    const group = groups.get(key) ?? { id: key, title, subtitle, items: [] };
    group.items.push(item);
    groups.set(key, group);
  }
  return Array.from(groups.values());
}

function SecretsDialog({
  secrets,
  revealedIds,
  onToggleReveal,
  onCopy,
  onOpenSource,
  onClose
}: {
  secrets: ReturnType<typeof extractSecretsFromRecords>;
  revealedIds: Set<string>;
  onToggleReveal: (id: string) => void;
  onCopy: (value: string) => void;
  onOpenSource: (recordId: string) => void;
  onClose: () => void;
}) {
  const total = secrets.apiKeys.length + secrets.passwords.length;
  const apiGroups = useMemo(() => groupApiKeys(secrets.apiKeys), [secrets.apiKeys]);
  const passwordGroups = useMemo(() => groupPasswords(secrets.passwords), [secrets.passwords]);

  return (
    <div className="modal-backdrop">
      <section className="secrets-dialog">
        <div className="detail-heading">
          <div>
            <div className="detail-meta">
              <KeyRound size={16} />
              <span>Local extraction</span>
            </div>
            <h2>Extracted sensitive snippets</h2>
          </div>
          <button type="button" onClick={onClose}>
            <X size={17} />
            Close
          </button>
        </div>

        {total === 0 ? (
          <div className="empty-state">No sensitive snippets detected in local records.</div>
        ) : (
          <div className="secrets-grid">
            <section>
              <div className="section-title result-title">
                <h3>API key snippets</h3>
                <span>
                  {apiGroups.length} groups / {secrets.apiKeys.length} keys
                </span>
              </div>
              <div className="secret-list">
                {apiGroups.map((group) => (
                  <div className="secret-item" key={group.id}>
                    <div className="secret-group-heading">
                      <div>
                        <strong>{group.title}</strong>
                        <span>{group.subtitle}</span>
                      </div>
                      <span>{group.items.length} keys</span>
                    </div>
                    {group.items.map((item) => (
                      <div className="secret-subitem" key={item.id}>
                        <div>
                          <strong>{item.label}</strong>
                          <code>{revealedIds.has(item.id) ? item.value : maskSecret(item.value)}</code>
                        </div>
                        <dl>
                          <div>
                            <dt>Model</dt>
                            <dd>{item.model}</dd>
                          </div>
                          <div>
                            <dt>Source</dt>
                            <dd>{item.sourceTitle}</dd>
                          </div>
                        </dl>
                        <div className="secret-actions">
                          <button type="button" onClick={() => onToggleReveal(item.id)}>
                            {revealedIds.has(item.id) ? <EyeOff size={16} /> : <Eye size={16} />}
                            {revealedIds.has(item.id) ? "Hide" : "Reveal"}
                          </button>
                          <button type="button" onClick={() => onCopy(item.value)}>
                            <Copy size={16} />
                            Copy
                          </button>
                          <button type="button" onClick={() => onOpenSource(item.sourceRecordId)}>
                            <FileText size={16} />
                            Source
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </section>

            <section>
              <div className="section-title result-title">
                <h3>Login snippets</h3>
                <span>
                  {passwordGroups.length} groups / {secrets.passwords.length} items
                </span>
              </div>
              <div className="secret-list">
                {passwordGroups.map((group) => (
                  <div className="secret-item" key={group.id}>
                    <div className="secret-group-heading">
                      <div>
                        <strong>{group.title}</strong>
                        <span>{group.subtitle}</span>
                      </div>
                      <span>{group.items.length} items</span>
                    </div>
                    {group.items.map((item) => (
                      <div className="secret-subitem" key={item.id}>
                        <div>
                          <strong>{item.username}</strong>
                          <code>{revealedIds.has(item.id) ? item.password : maskSecret(item.password)}</code>
                        </div>
                        <dl>
                          <div>
                            <dt>URL</dt>
                            <dd>{item.url || "Optional"}</dd>
                          </div>
                          <div>
                            <dt>Source</dt>
                            <dd>{item.sourceTitle}</dd>
                          </div>
                        </dl>
                        <div className="secret-actions">
                          <button type="button" onClick={() => onToggleReveal(item.id)}>
                            {revealedIds.has(item.id) ? <EyeOff size={16} /> : <Eye size={16} />}
                            {revealedIds.has(item.id) ? "Hide" : "Reveal"}
                          </button>
                          <button type="button" onClick={() => onCopy(item.password)}>
                            <Copy size={16} />
                            Copy
                          </button>
                          <button type="button" onClick={() => onOpenSource(item.sourceRecordId)}>
                            <FileText size={16} />
                            Source
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}
      </section>
    </div>
  );
}

function CaptureDialog({
  draft,
  classification,
  busy,
  clipboardHistory,
  onDraftChange,
  onSave,
  onClose
}: {
  draft: typeof emptyDraft;
  classification: Classification | null;
  busy: boolean;
  clipboardHistory: string[];
  onDraftChange: (draft: typeof emptyDraft) => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop">
      <form className="capture-dialog" onSubmit={onSave}>
        <div className="detail-heading">
          <div>
            <div className="detail-meta">
              <Plus size={16} />
              <span>New paste</span>
            </div>
            <h2>Capture content</h2>
          </div>
          <button type="button" onClick={onClose} disabled={busy}>
            <X size={17} />
            Close
          </button>
        </div>
        <textarea
          value={draft.content}
          onChange={(event) => onDraftChange({ ...draft, content: event.target.value })}
          placeholder="Paste anything here..."
          spellCheck={false}
          autoFocus
        />
        <input
          value={draft.title}
          onChange={(event) => onDraftChange({ ...draft, title: event.target.value })}
          placeholder={classification?.title ?? "Optional title"}
        />
        <input
          value={draft.manualTags}
          onChange={(event) => onDraftChange({ ...draft, manualTags: event.target.value })}
          placeholder="Manual tags, separated by comma"
        />
        {clipboardHistory.length > 0 ? (
          <div className="clipboard-history">
            <div className="detail-meta">
              <FileText size={14} />
              <span>Recent clipboard</span>
            </div>
            <div className="clipboard-history-list">
              {clipboardHistory.map((text, index) => (
                <button
                  type="button"
                  key={`${index}-${text.slice(0, 8)}`}
                  className="clipboard-history-item"
                  onClick={() => onDraftChange({ ...draft, content: text })}
                >
                  {text.replace(/\s+/g, " ").slice(0, 80) || "(empty)"}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {classification ? <ClassificationPreview classification={classification} /> : null}
        <div className="dialog-actions">
          <button type="button" onClick={onClose} disabled={busy}>
            <X size={17} />
            Cancel
          </button>
          <button className="primary-button" type="submit" disabled={busy || !draft.content.trim()}>
            <Save size={17} />
            Save paste
          </button>
        </div>
      </form>
    </div>
  );
}

function ImportPreviewDialog({
  preview,
  selectedIds,
  busy,
  onToggle,
  onSelectAll,
  onCancel,
  onConfirm
}: {
  preview: ImportPreview;
  selectedIds: Set<string>;
  busy: boolean;
  onToggle: (id: string) => void;
  onSelectAll: (selected: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const allSelected = selectedIds.size === preview.items.length;
  const sensitiveCount = preview.items.filter((item) => item.sensitivity !== "none").length;

  return (
    <div className="modal-backdrop">
      <section className="import-dialog">
        <div className="detail-heading">
          <div>
            <div className="detail-meta">
              <FileInput size={16} />
              <span>Import preview</span>
            </div>
            <h2>Review import</h2>
          </div>
          <button type="button" onClick={onCancel} disabled={busy}>
            <X size={17} />
            Close
          </button>
        </div>

        <div className="import-summary">
          <div>
            <strong>{preview.importable}</strong>
            <span>Ready</span>
          </div>
          <div>
            <strong>{preview.skipped}</strong>
            <span>Skipped</span>
          </div>
          <div>
            <strong>{sensitiveCount}</strong>
            <span>Sensitive</span>
          </div>
          <div>
            <strong>{preview.errors.length}</strong>
            <span>Errors</span>
          </div>
        </div>

        {preview.errors.length ? (
          <div className="import-errors">
            {preview.errors.slice(0, 4).map((message) => (
              <p key={message}>{message}</p>
            ))}
          </div>
        ) : null}

        <div className="import-toolbar">
          <button type="button" onClick={() => onSelectAll(!allSelected)} disabled={busy}>
            {allSelected ? <CheckSquare size={17} /> : <Square size={17} />}
            {allSelected ? "Clear all" : "Select all"}
          </button>
          <span>
            {selectedIds.size} of {preview.items.length} selected
          </span>
        </div>

        <div className="import-list">
          {preview.items.map((item) => (
            <label className={`import-item ${selectedIds.has(item.id) ? "selected" : ""}`} key={item.id}>
              <input
                type="checkbox"
                checked={selectedIds.has(item.id)}
                onChange={() => onToggle(item.id)}
                disabled={busy}
              />
              <div className="import-item-body">
                <div className="result-row">
                  <strong>{item.title}</strong>
                  <SensitivityBadge value={item.sensitivity} />
                </div>
                <p>{item.contentPreview}</p>
                <div className="detail-meta">
                  <FileText size={14} />
                  <span title={item.sourcePath}>{item.sourceLabel}</span>
                  <span>{item.contentKind}</span>
                  {item.sensitiveMatchCount > 0 ? <span>{item.sensitiveMatchCount} sensitive matches</span> : null}
                </div>
                <div className="tag-row">
                  {[...item.autoTags, ...item.manualTags].slice(0, 8).map((tag) => (
                    <span key={tag}>{tag}</span>
                  ))}
                </div>
              </div>
            </label>
          ))}
        </div>

        <div className="dialog-actions">
          <button type="button" onClick={onCancel} disabled={busy}>
            <X size={17} />
            Cancel
          </button>
          <button className="primary-button" type="button" onClick={onConfirm} disabled={busy || selectedIds.size === 0}>
            <Save size={17} />
            Import selected
          </button>
        </div>
      </section>
    </div>
  );
}

function SettingsDialog({
  settings,
  busy,
  onSave,
  onChangePassword,
  onClose
}: {
  settings: AppSettings;
  busy: boolean;
  onSave: (settings: AppSettings) => void;
  onChangePassword: (oldPassword: string, newPassword: string) => Promise<void>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [pw, setPw] = useState({ old: "", next: "", confirm: "" });
  const pwValid = pw.old.length >= 8 && pw.next.length >= 8 && pw.next === pw.confirm && pw.next !== pw.old;

  async function handlePasswordChange() {
    if (!pwValid) return;
    try {
      await onChangePassword(pw.old, pw.next);
      setPw({ old: "", next: "", confirm: "" });
    } catch {
      // error surfaced by parent
    }
  }

  return (
    <div className="modal-backdrop">
      <form
        className="settings-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          onSave(draft);
        }}
      >
        <div className="detail-heading">
          <div>
            <div className="detail-meta">
              <KeyRound size={16} />
              <span>BYOK</span>
            </div>
            <h2>Model settings</h2>
          </div>
          <button type="button" onClick={onClose}>
            <X size={17} />
            Close
          </button>
        </div>

        <label className="toggle-line">
          <input
            type="checkbox"
            checked={draft.model.enabled}
            onChange={(event) =>
              setDraft({ ...draft, model: { ...draft.model, enabled: event.target.checked } })
            }
          />
          Enable model-assisted classification
        </label>

        <label>
          Provider
          <select
            value={draft.model.provider}
            onChange={(event) =>
              setDraft({
                ...draft,
                model: {
                  ...draft.model,
                  provider: event.target.value as AppSettings["model"]["provider"]
                }
              })
            }
          >
            <option value="openai-compatible">OpenAI-compatible</option>
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
            <option value="custom">Custom</option>
          </select>
        </label>

        <label>
          Base URL
          <input
            value={draft.model.baseUrl}
            onChange={(event) => setDraft({ ...draft, model: { ...draft.model, baseUrl: event.target.value } })}
            placeholder="https://api.openai.com/v1"
          />
        </label>

        <label>
          Model
          <input
            value={draft.model.model}
            onChange={(event) => setDraft({ ...draft, model: { ...draft.model, model: event.target.value } })}
            placeholder="gpt-4.1-mini or another BYOK model"
          />
        </label>

        <label>
          API key
          <input
            type="password"
            value={draft.model.apiKey}
            onChange={(event) => setDraft({ ...draft, model: { ...draft.model, apiKey: event.target.value } })}
            placeholder="Stored only in the encrypted local vault"
          />
        </label>

        <p className="muted">
          Current build stores BYOK settings locally. Rule-based classification remains active until model calls are
          wired into the import pipeline.
        </p>

        <div className="settings-section">
          <div className="detail-meta">
            <LockKeyhole size={16} />
            <span>Security</span>
          </div>
          <label>
            Auto-lock after idle (minutes, 0 = off)
            <input
              type="number"
              min={0}
              max={240}
              value={draft.security.idleTimeoutMinutes}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  security: { ...draft.security, idleTimeoutMinutes: Number(event.target.value) }
                })
              }
            />
          </label>
          <label>
            Clear clipboard after copy (seconds, 0 = off)
            <input
              type="number"
              min={0}
              max={300}
              value={draft.security.clipboardClearSeconds}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  security: { ...draft.security, clipboardClearSeconds: Number(event.target.value) }
                })
              }
            />
          </label>
        </div>

        <div className="settings-section">
          <div className="detail-meta">
            <LockKeyhole size={16} />
            <span>Change master password</span>
          </div>
          <input
            type="password"
            value={pw.old}
            minLength={8}
            onChange={(event) => setPw({ ...pw, old: event.target.value })}
            placeholder="Current password"
          />
          <input
            type="password"
            value={pw.next}
            minLength={8}
            onChange={(event) => setPw({ ...pw, next: event.target.value })}
            placeholder="New password (min 8 characters)"
          />
          <input
            type="password"
            value={pw.confirm}
            minLength={8}
            onChange={(event) => setPw({ ...pw, confirm: event.target.value })}
            placeholder="Confirm new password"
          />
          <button type="button" onClick={handlePasswordChange} disabled={busy || !pwValid}>
            <Save size={17} />
            Change password
          </button>
        </div>

        <button className="primary-button" type="submit" disabled={busy}>
          <Save size={17} />
          Save settings
        </button>
      </form>
    </div>
  );
}

function RecordDetail({
  record,
  editing,
  editDraft,
  setEditDraft,
  revealed,
  setRevealed,
  busy,
  onEdit,
  onCancel,
  onSave,
  onDelete,
  onCopy
}: {
  record: PasteRecord;
  editing: boolean;
  editDraft: typeof emptyDraft;
  setEditDraft: (draft: typeof emptyDraft) => void;
  revealed: boolean;
  setRevealed: (value: boolean) => void;
  busy: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
  onDelete: () => void;
  onCopy: (record: PasteRecord, content: string) => void;
}) {
  const displayContent = record.sensitivity === "high" && !revealed ? redactSensitiveContent(record.content) : record.content;
  const [editorMode, setEditorMode] = useState<"write" | "preview">("write");

  useEffect(() => {
    if (editing) setEditorMode("write");
  }, [editing, record.id]);

  if (editing) {
    return (
      <form className="detail-content edit-form" onSubmit={onSave}>
        <div className="detail-heading">
          <input
            className="title-input"
            value={editDraft.title}
            onChange={(event) => setEditDraft({ ...editDraft, title: event.target.value })}
          />
          <div className="detail-actions">
            <button className="primary-button" type="submit" disabled={busy || !editDraft.content.trim()}>
              <Save size={17} />
              Save Markdown
            </button>
            <button type="button" onClick={onCancel}>
              <X size={17} />
              Cancel
            </button>
          </div>
        </div>
        <div className="editor-tabs">
          <button
            className={editorMode === "write" ? "active" : ""}
            type="button"
            onClick={() => setEditorMode("write")}
          >
            Markdown source
          </button>
          <button
            className={editorMode === "preview" ? "active" : ""}
            type="button"
            onClick={() => setEditorMode("preview")}
          >
            Rendered preview
          </button>
        </div>
        {editorMode === "write" ? (
          <textarea
            value={editDraft.content}
            onChange={(event) => setEditDraft({ ...editDraft, content: event.target.value })}
            spellCheck={false}
          />
        ) : (
          <MarkdownView content={editDraft.content} />
        )}
        <input
          value={editDraft.manualTags}
          onChange={(event) => setEditDraft({ ...editDraft, manualTags: event.target.value })}
          placeholder="Manual tags, separated by comma"
        />
      </form>
    );
  }

  return (
    <div className="detail-content">
      <div className="detail-heading">
        <div>
          <div className="detail-meta">
            <SensitivityBadge value={record.sensitivity} />
            <span>{record.contentKind}</span>
            {record.archivedAt ? <span>{record.archiveName ?? "Archived"}</span> : null}
            <time>{formatDate(record.updatedAt)}</time>
          </div>
          <h2>{record.title}</h2>
        </div>
        <div className="detail-actions">
          {record.sensitivity === "high" ? (
            <button type="button" onClick={() => setRevealed(!revealed)}>
              {revealed ? <EyeOff size={17} /> : <Eye size={17} />}
              {revealed ? "Hide" : "Reveal"}
            </button>
          ) : null}
          <button type="button" onClick={() => onCopy(record, displayContent)}>
            <Copy size={17} />
            Copy
          </button>
          <button type="button" onClick={onEdit}>
            <FileText size={17} />
            Edit Markdown
          </button>
          <button className="danger-button" type="button" onClick={onDelete}>
            <Trash2 size={17} />
            Delete
          </button>
        </div>
      </div>

      <div className="tag-block">
        <Tags size={16} />
        {[...record.autoTags, ...record.manualTags].map((tag) => (
          <span key={tag}>{tag}</span>
        ))}
      </div>
      <MarkdownView content={displayContent} />
    </div>
  );
}

type MarkdownBlock =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "code"; text: string }
  | { kind: "table"; header: string[]; rows: string[][] };

function MarkdownView({ content }: { content: string }) {
  const blocks = useMemo(() => parseMarkdownBlocks(content), [content]);

  return (
    <div className="markdown-view">
      {blocks.map((block, index) => {
        if (block.kind === "heading") {
          const Heading = `h${block.level}` as "h1" | "h2" | "h3";
          return <Heading key={index}>{renderInline(block.text, `h-${index}`)}</Heading>;
        }
        if (block.kind === "list") {
          const List = block.ordered ? "ol" : "ul";
          return (
            <List key={index}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{renderInline(item, `li-${index}-${itemIndex}`)}</li>
              ))}
            </List>
          );
        }
        if (block.kind === "code") {
          return (
            <pre key={index}>
              <code>{block.text}</code>
            </pre>
          );
        }
        if (block.kind === "table") {
          return (
            <div className="markdown-table-wrap" key={index}>
              <table>
                <thead>
                  <tr>
                    {block.header.map((cell, cellIndex) => (
                      <th key={cellIndex}>{renderInlineWithBreaks(cell, `th-${index}-${cellIndex}`)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {block.header.map((_header, cellIndex) => (
                        <td key={cellIndex}>
                          {renderInlineWithBreaks(row[cellIndex] ?? "", `td-${index}-${rowIndex}-${cellIndex}`)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        return <p key={index}>{renderInline(block.text, `p-${index}`)}</p>;
      })}
    </div>
  );
}

function parseMarkdownBlocks(content: string): MarkdownBlock[] {
  const lines = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    if (trimmed.startsWith("```")) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith("```")) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ kind: "code", text: codeLines.join("\n") });
      continue;
    }

    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      blocks.push({
        kind: "heading",
        level: heading[1].length as 1 | 2 | 3,
        text: heading[2]
      });
      index += 1;
      continue;
    }

    if (isMarkdownTableStart(lines, index)) {
      const tableLines: string[] = [];
      while (index < lines.length && isMarkdownTableLine(lines[index])) {
        tableLines.push(lines[index]);
        index += 1;
      }
      const [headerLine, _separatorLine, ...rowLines] = tableLines;
      blocks.push({
        kind: "table",
        header: splitMarkdownRow(headerLine),
        rows: rowLines.map(splitMarkdownRow)
      });
      continue;
    }

    const unordered = trimmed.match(/^[-*]\s+(.+)$/);
    const ordered = trimmed.match(/^\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      const items: string[] = [];
      const isOrdered = Boolean(ordered);
      while (index < lines.length) {
        const itemMatch = lines[index].trim().match(isOrdered ? /^\d+[.)]\s+(.+)$/ : /^[-*]\s+(.+)$/);
        if (!itemMatch) break;
        items.push(itemMatch[1]);
        index += 1;
      }
      blocks.push({ kind: "list", ordered: isOrdered, items });
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length) {
      const paragraphLine = lines[index];
      if (!paragraphLine.trim()) break;
      if (paragraphLines.length > 0 && startsMarkdownBlock(lines, index)) break;
      paragraphLines.push(paragraphLine.trim());
      index += 1;
    }
    blocks.push({ kind: "paragraph", text: paragraphLines.join(" ") });
  }

  return blocks;
}

function startsMarkdownBlock(lines: string[], index: number): boolean {
  const trimmed = lines[index].trim();
  return (
    trimmed.startsWith("```") ||
    /^(#{1,3})\s+/.test(trimmed) ||
    /^[-*]\s+/.test(trimmed) ||
    /^\d+[.)]\s+/.test(trimmed) ||
    isMarkdownTableStart(lines, index)
  );
}

function isMarkdownTableStart(lines: string[], index: number): boolean {
  return isMarkdownTableLine(lines[index]) && index + 1 < lines.length && isMarkdownSeparator(lines[index + 1]);
}

function isMarkdownTableLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith("|") && trimmed.endsWith("|") && trimmed.includes("|");
}

function isMarkdownSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function splitMarkdownRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let cell = "";

  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    const next = trimmed[index + 1];
    if (char === "\\" && next === "|") {
      cell += "|";
      index += 1;
    } else if (char === "|") {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += char;
    }
  }

  cells.push(cell.trim());
  return cells;
}

function renderInlineWithBreaks(text: string, keyPrefix: string): ReactNode[] {
  return text.split(/<br\s*\/?>/gi).flatMap((part, index, parts) => {
    const nodes = renderInline(part, `${keyPrefix}-${index}`);
    return index < parts.length - 1 ? [...nodes, <br key={`${keyPrefix}-br-${index}`} />] : nodes;
  });
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let nodeIndex = 0;

  while ((match = pattern.exec(text))) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${nodeIndex}`;

    if (token.startsWith("`")) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("**")) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else {
      const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      const href = link?.[2] ?? "";
      if (link && /^(https?:\/\/|mailto:)/i.test(href)) {
        nodes.push(
          <a href={href} key={key}>
            {link[1]}
          </a>
        );
      } else {
        nodes.push(token);
      }
    }

    nodeIndex += 1;
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

function ClassificationPreview({ classification }: { classification: Classification }) {
  return (
    <div className={`classification ${classification.sensitivity === "high" ? "warn" : ""}`}>
      <div>
        {classification.sensitivity === "high" ? <AlertTriangle size={16} /> : <Tags size={16} />}
        <strong>{classification.contentKind}</strong>
        <SensitivityBadge value={classification.sensitivity} />
      </div>
      <div className="tag-row">
        {classification.autoTags.slice(0, 8).map((tag) => (
          <span key={tag}>{tag}</span>
        ))}
      </div>
    </div>
  );
}

function SensitivityBadge({ value }: { value: PasteRecord["sensitivity"] }) {
  return <span className={`sensitivity sensitivity-${value}`}>{value}</span>;
}

function Status({ error, notice, onDismiss }: { error: string | null; notice: string | null; onDismiss?: () => void }) {
  if (!error && !notice) return null;
  return (
    <div className={`status ${error ? "error" : "notice"}`}>
      <span>{error ?? notice}</span>
      {onDismiss ? (
        <button type="button" onClick={onDismiss} aria-label="Dismiss">
          <X size={16} />
        </button>
      ) : null}
    </div>
  );
}

function CommandPalette({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const filtered = commands.filter((c) => c.label.toLowerCase().includes(query.toLowerCase().trim()));

  useEffect(() => {
    setActive(0);
  }, [query]);

  function runActive() {
    const command = filtered[active];
    if (command && !command.disabled) {
      command.run();
      onClose();
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="command-palette" onClick={(event) => event.stopPropagation()}>
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActive((a) => Math.min(filtered.length - 1, a + 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (event.key === "Enter") {
              event.preventDefault();
              runActive();
            } else if (event.key === "Escape") {
              event.preventDefault();
              onClose();
            }
          }}
          placeholder="Type a command..."
          spellCheck={false}
        />
        <div className="command-list">
          {filtered.map((command, index) => (
            <button
              key={command.id}
              type="button"
              className={index === active ? "active" : ""}
              disabled={command.disabled}
              onMouseEnter={() => setActive(index)}
              onClick={() => {
                if (!command.disabled) {
                  command.run();
                  onClose();
                }
              }}
            >
              <span>{command.label}</span>
              {command.hint ? <span className="command-hint">{command.hint}</span> : null}
            </button>
          ))}
          {filtered.length === 0 ? <div className="empty-state">No matching commands.</div> : null}
        </div>
      </section>
    </div>
  );
}

function ShellMessage({ title, detail }: { title: string; detail?: string }) {
  return (
    <main className="auth-shell">
      <section className="auth-panel">
        <div className="brand-mark">
          <LockKeyhole size={28} />
        </div>
        <h1>{title}</h1>
        {detail ? <p className="muted">{detail}</p> : null}
      </section>
    </main>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function readError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
