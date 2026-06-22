import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { VaultService } from "./vault";

vi.mock("electron", () => ({
  app: {
    getPath: () => "unused"
  },
  dialog: {
    showOpenDialog: vi.fn()
  }
}));

describe("vault import preview", () => {
  it("previews import candidates without writing until confirmation", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pastevault-import-preview-"));

    try {
      const vault = new VaultService(path.join(root, "pastevault.vault"));
      const firstPath = path.join(root, "first.txt");
      const secondPath = path.join(root, "second.txt");
      await fs.writeFile(firstPath, "password: swordfish\n", "utf8");
      await fs.writeFile(secondPath, "password: swordfish\n", "utf8");

      await vault.create("strong-password");

      const preview = await vault.previewImportPaths([firstPath, secondPath]);
      expect(preview.totalCandidates).toBe(2);
      expect(preview.importable).toBe(1);
      expect(preview.skipped).toBe(1);
      expect(preview.items[0].sensitivity).toBe("high");
      expect(preview.items[0].contentPreview).not.toContain("swordfish");
      expect(vault.list()).toHaveLength(0);

      expect(preview.batchId).toBeTruthy();
      const result = await vault.confirmImport({
        batchId: preview.batchId!,
        itemIds: [preview.items[0].id]
      });

      expect(result).toMatchObject({ imported: 1, skipped: 1, errors: [] });
      expect(vault.list()).toHaveLength(1);
      expect(vault.list()[0].content).toContain("swordfish");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe("vault persistence", () => {
  it("writes atomically and keeps a .bak of the previous version", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pastevault-persist-"));
    try {
      const vaultPath = path.join(root, "pastevault.vault");
      const vault = new VaultService(vaultPath);
      await vault.create("strong-password");
      await vault.createRecord({ content: "first note" });

      const firstPayload = await fs.readFile(vaultPath, "utf8");
      await vault.createRecord({ content: "second note" });

      const bakPayload = await fs.readFile(`${vaultPath}.bak`, "utf8");
      expect(bakPayload).toBe(firstPayload);
      expect(await fs.readFile(vaultPath, "utf8")).not.toBe(firstPayload);
      expect(await fs.readdir(root).then((entries) => entries.filter((e) => e.endsWith(".tmp-")))).toHaveLength(0);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe("vault changePassword", () => {
  it("re-encrypts with the new password and rejects wrong old password", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "pastevault-change-pw-"));
    try {
      const vaultPath = path.join(root, "pastevault.vault");
      const vault = new VaultService(vaultPath);
      await vault.create("strong-password");
      await vault.createRecord({ content: "secret note" });

      await vault.changePassword("strong-password", "even-stronger-password");

      const locked = new VaultService(vaultPath);
      await expect(locked.unlock("strong-password")).rejects.toThrow(/Could not unlock/);
      const records = await locked.unlock("even-stronger-password");
      expect(records).toHaveLength(1);
      expect(records[0].content).toBe("secret note");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
