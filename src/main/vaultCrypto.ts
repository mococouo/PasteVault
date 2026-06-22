import crypto from "node:crypto";
import type { VaultState } from "../shared/types";

export interface VaultFile {
  schema: "pastevault-vault";
  version: 1;
  kdf: {
    name: "scrypt";
    salt: string;
    keyLength: 32;
    N: number;
    r: number;
    p: number;
  };
  cipher: {
    name: "aes-256-gcm";
    iv: string;
    tag: string;
  };
  payload: string;
}

const KDF_PARAMS = {
  N: 16384,
  r: 8,
  p: 1,
  keyLength: 32
} as const;

export function encryptVaultState(state: VaultState, password: string): VaultFile {
  assertPassword(password);
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveKey(password, salt);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const payload = Buffer.concat([cipher.update(JSON.stringify(state), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    schema: "pastevault-vault",
    version: 1,
    kdf: {
      name: "scrypt",
      salt: salt.toString("base64"),
      keyLength: KDF_PARAMS.keyLength,
      N: KDF_PARAMS.N,
      r: KDF_PARAMS.r,
      p: KDF_PARAMS.p
    },
    cipher: {
      name: "aes-256-gcm",
      iv: iv.toString("base64"),
      tag: tag.toString("base64")
    },
    payload: payload.toString("base64")
  };
}

export function decryptVaultFile(vaultFile: VaultFile, password: string): string {
  assertPassword(password);
  if (vaultFile.schema !== "pastevault-vault" || vaultFile.version !== 1) {
    throw new Error("Unsupported vault file.");
  }
  const salt = Buffer.from(vaultFile.kdf.salt, "base64");
  const iv = Buffer.from(vaultFile.cipher.iv, "base64");
  const tag = Buffer.from(vaultFile.cipher.tag, "base64");
  const payload = Buffer.from(vaultFile.payload, "base64");
  const key = deriveKey(password, salt);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(payload), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("Could not unlock vault. Check the password.");
  }
}

function deriveKey(password: string, salt: Buffer): Buffer {
  return crypto.scryptSync(password, salt, KDF_PARAMS.keyLength, {
    N: KDF_PARAMS.N,
    r: KDF_PARAMS.r,
    p: KDF_PARAMS.p
  });
}

function assertPassword(password: string): void {
  if (password.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }
}
