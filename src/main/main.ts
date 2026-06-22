import {
  app,
  BrowserWindow,
  clipboard,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  powerMonitor,
  shell,
  Tray
} from "electron";
import path from "node:path";
import { classifyContent } from "../shared/classifier";
import { VaultService } from "./vault";

const ACCELERATOR_CAPTURE = "CommandOrControl+Shift+V";
const CLIPBOARD_POLL_MS = 2000;
const MAX_CLIPBOARD_HISTORY = 20;
const IDLE_CHECK_MS = 60_000;

const vault = new VaultService();
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

const clipboardHistory: string[] = [];
let lastClipboardText = "";
let clipboardTimer: NodeJS.Timeout | null = null;
let idleTimer: NodeJS.Timeout | null = null;
let clipboardClearTimer: NodeJS.Timeout | null = null;

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: "PasteVault",
    backgroundColor: "#f7f5f0",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  if (tray) {
    mainWindow.on("close", (event) => {
      if (!isQuitting) {
        event.preventDefault();
        mainWindow?.hide();
      }
    });
  }

  const devServer = readDevServerArg();
  if (devServer) {
    await mainWindow.loadURL(devServer);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    await mainWindow.loadFile(path.join(__dirname, "../../dist-renderer/index.html"));
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  createTray();
  registerGlobalShortcut();
  registerIpcHandlers();
  await createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
    else showWindow();
  });
});

app.on("before-quit", () => {
  isQuitting = true;
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  if (!tray && process.platform !== "darwin") app.quit();
});

function registerIpcHandlers(): void {
  ipcMain.handle("vault:summary", () => vault.summary());
  ipcMain.handle("vault:create", async (_event, password: string) => {
    const records = await vault.create(password);
    onVaultUnlocked();
    return records;
  });
  ipcMain.handle("vault:unlock", async (_event, password: string) => {
    const records = await vault.unlock(password);
    onVaultUnlocked();
    return records;
  });
  ipcMain.handle("vault:lock", () => {
    vault.lock();
    onVaultLocked();
  });
  ipcMain.handle("vault:change-password", (_event, oldPassword: string, newPassword: string) =>
    vault.changePassword(oldPassword, newPassword)
  );
  ipcMain.handle("records:list", () => vault.list());
  ipcMain.handle("records:create", (_event, input) => vault.createRecord(input));
  ipcMain.handle("records:update", (_event, input) => vault.updateRecord(input));
  ipcMain.handle("records:delete", (_event, id: string) => vault.deleteRecord(id));
  ipcMain.handle("records:delete-many", (_event, ids: string[]) => vault.deleteRecords(ids));
  ipcMain.handle("records:archive", (_event, input) => vault.archiveRecords(input));
  ipcMain.handle("records:import-folder", () => vault.importTextFolder());
  ipcMain.handle("records:import-paths", (_event, paths: string[]) => vault.importPaths(paths));
  ipcMain.handle("records:preview-import-folder", () => vault.previewImportTextFolder());
  ipcMain.handle("records:preview-import-paths", (_event, paths: string[]) => vault.previewImportPaths(paths));
  ipcMain.handle("records:scan-desktop", () => vault.scanDesktop());
  ipcMain.handle("records:confirm-import", (_event, input) => vault.confirmImport(input));
  ipcMain.handle("records:export", () => vault.exportVault());
  ipcMain.handle("settings:get", () => vault.getSettings());
  ipcMain.handle("settings:save", (_event, settings) => vault.saveSettings(settings));
  ipcMain.handle("classify", (_event, content: string) => classifyContent(content));

  ipcMain.handle("clipboard:get-history", () => clipboardHistory.slice(0, 10));
  ipcMain.handle("clipboard:schedule-clear", (_event, seconds: number) => {
    if (clipboardClearTimer) {
      clearTimeout(clipboardClearTimer);
      clipboardClearTimer = null;
    }
    if (seconds <= 0) return;
    clipboardClearTimer = setTimeout(() => {
      if (clipboard.readText()) {
        clipboard.writeText("");
        lastClipboardText = "";
      }
      clipboardClearTimer = null;
    }, seconds * 1000);
  });
  ipcMain.handle("app:show-window", () => {
    showWindow();
  });
  ipcMain.handle("app:quit", () => {
    isQuitting = true;
    app.quit();
  });
}

function createTray(): void {
  const iconPath = path.join(__dirname, "../../resources/icon.png");
  let icon: Electron.NativeImage;
  try {
    icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) icon = nativeImage.createEmpty();
  } catch {
    icon = nativeImage.createEmpty();
  }
  tray = new Tray(icon);
  tray.setToolTip("PasteVault");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Show PasteVault", click: () => showWindow() },
      { label: "Capture clipboard", click: () => captureClipboard() },
      { type: "separator" },
      {
        label: "Lock vault",
        click: () => {
          vault.lock();
          onVaultLocked();
          mainWindow?.webContents.send("vault:auto-locked");
        }
      },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          isQuitting = true;
          app.quit();
        }
      }
    ])
  );
  tray.on("click", () => showWindow());
}

function registerGlobalShortcut(): void {
  try {
    globalShortcut.register(ACCELERATOR_CAPTURE, () => {
      captureClipboard();
      showWindow();
    });
  } catch {
    // shortcut registration can fail if already registered by another app
  }
}

function captureClipboard(): void {
  const text = clipboard.readText();
  if (!text.trim()) return;
  if (!vault.isLocked() && mainWindow) {
    mainWindow.webContents.send("clipboard:capture", text);
  }
}

function showWindow(): void {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
}

function onVaultUnlocked(): void {
  startIdleMonitor();
  startClipboardMonitor();
}

function onVaultLocked(): void {
  stopIdleMonitor();
  stopClipboardMonitor();
  clipboardHistory.length = 0;
}

function startClipboardMonitor(): void {
  if (clipboardTimer) clearInterval(clipboardTimer);
  lastClipboardText = clipboard.readText();
  clipboardTimer = setInterval(() => {
    const text = clipboard.readText();
    if (text && text !== lastClipboardText) {
      lastClipboardText = text;
      clipboardHistory.unshift(text);
      if (clipboardHistory.length > MAX_CLIPBOARD_HISTORY) clipboardHistory.pop();
      mainWindow?.webContents.send("clipboard:history-updated", clipboardHistory.slice(0, 10));
    }
  }, CLIPBOARD_POLL_MS);
}

function stopClipboardMonitor(): void {
  if (clipboardTimer) {
    clearInterval(clipboardTimer);
    clipboardTimer = null;
  }
}

function startIdleMonitor(): void {
  if (idleTimer) clearInterval(idleTimer);
  idleTimer = setInterval(() => {
    const timeoutMinutes = vault.getSecuritySettings().idleTimeoutMinutes;
    if (timeoutMinutes <= 0) return;
    const idleSeconds = powerMonitor.getSystemIdleTime();
    if (idleSeconds >= timeoutMinutes * 60) {
      vault.lock();
      onVaultLocked();
      mainWindow?.webContents.send("vault:auto-locked");
    }
  }, IDLE_CHECK_MS);
}

function stopIdleMonitor(): void {
  if (idleTimer) {
    clearInterval(idleTimer);
    idleTimer = null;
  }
}

function readDevServerArg(): string | null {
  const arg = process.argv.find((item) => item.startsWith("--dev-server="));
  if (!arg) return null;
  const url = arg.slice("--dev-server=".length);
  return /^https?:\/\/127\.0\.0\.1:\d+/.test(url) ? url : null;
}
