import { contextBridge, ipcRenderer, webUtils } from "electron";
import type {
  AppApi,
  AppSettings,
  ArchiveRecordsInput,
  ConfirmImportInput,
  CreatePasteInput,
  UpdatePasteInput
} from "../shared/types";

const api: AppApi = {
  getVaultSummary: () => ipcRenderer.invoke("vault:summary"),
  createVault: (password: string) => ipcRenderer.invoke("vault:create", password),
  unlockVault: (password: string) => ipcRenderer.invoke("vault:unlock", password),
  lockVault: () => ipcRenderer.invoke("vault:lock"),
  changeVaultPassword: (oldPassword: string, newPassword: string) =>
    ipcRenderer.invoke("vault:change-password", oldPassword, newPassword),
  listRecords: () => ipcRenderer.invoke("records:list"),
  createRecord: (input: CreatePasteInput) => ipcRenderer.invoke("records:create", input),
  updateRecord: (input: UpdatePasteInput) => ipcRenderer.invoke("records:update", input),
  deleteRecord: (id: string) => ipcRenderer.invoke("records:delete", id),
  deleteRecords: (ids: string[]) => ipcRenderer.invoke("records:delete-many", ids),
  archiveRecords: (input: ArchiveRecordsInput) => ipcRenderer.invoke("records:archive", input),
  classify: (content: string) => ipcRenderer.invoke("classify", content),
  importTextFolder: () => ipcRenderer.invoke("records:import-folder"),
  importPaths: (paths: string[]) => ipcRenderer.invoke("records:import-paths", paths),
  previewImportTextFolder: () => ipcRenderer.invoke("records:preview-import-folder"),
  previewImportPaths: (paths: string[]) => ipcRenderer.invoke("records:preview-import-paths", paths),
  scanDesktop: () => ipcRenderer.invoke("records:scan-desktop"),
  confirmImport: (input: ConfirmImportInput) => ipcRenderer.invoke("records:confirm-import", input),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  exportVault: () => ipcRenderer.invoke("records:export"),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings: AppSettings) => ipcRenderer.invoke("settings:save", settings),
  getClipboardHistory: () => ipcRenderer.invoke("clipboard:get-history"),
  scheduleClipboardClear: (seconds: number) => ipcRenderer.invoke("clipboard:schedule-clear", seconds),
  showWindow: () => ipcRenderer.invoke("app:show-window"),
  onClipboardCapture: (handler) => {
    const listener = (_event: unknown, text: string) => handler(text);
    ipcRenderer.on("clipboard:capture", listener);
    return () => ipcRenderer.removeListener("clipboard:capture", listener);
  },
  onClipboardHistoryUpdated: (handler) => {
    const listener = (_event: unknown, history: string[]) => handler(history);
    ipcRenderer.on("clipboard:history-updated", listener);
    return () => ipcRenderer.removeListener("clipboard:history-updated", listener);
  },
  onAutoLocked: (handler) => {
    const listener = () => handler();
    ipcRenderer.on("vault:auto-locked", listener);
    return () => ipcRenderer.removeListener("vault:auto-locked", listener);
  }
};

contextBridge.exposeInMainWorld("pasteVault", api);
