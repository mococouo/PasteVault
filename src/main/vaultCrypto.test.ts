import { describe, expect, it } from "vitest";
import { decryptVaultFile, encryptVaultState } from "./vaultCrypto";
import type { VaultState } from "../shared/types";

describe("vault crypto", () => {
  it("encrypts vault contents without plaintext leakage", () => {
    const state: VaultState = {
      version: 1,
      records: [
        {
          id: "record-1",
          title: "Secret",
          content: "password: swordfish",
          autoTags: ["secret"],
          manualTags: [],
          sensitivity: "high",
          contentKind: "secret",
          createdAt: "2026-06-01T00:00:00.000Z",
          updatedAt: "2026-06-01T00:00:00.000Z",
          contentHash: "hash"
        }
      ]
    };

    const encrypted = encryptVaultState(state, "strong-password");
    const serialized = JSON.stringify(encrypted);

    expect(serialized).not.toContain("swordfish");
    expect(JSON.parse(decryptVaultFile(encrypted, "strong-password"))).toEqual(state);
    expect(() => decryptVaultFile(encrypted, "wrong-password")).toThrow(/Could not unlock/);
  });
});
