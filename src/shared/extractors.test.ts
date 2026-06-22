import { describe, expect, it } from "vitest";
import { extractSecretsFromRecords, maskSecret } from "./extractors";
import type { PasteRecord } from "./types";

describe("extractSecretsFromRecords", () => {
  it("extracts API keys with nearby model context", () => {
    const fakeOpenAiKey = ["sk", "test-fake-00000000000000000000"].join("-");
    const secrets = extractSecretsFromRecords([
      record("api", `Provider: OpenAI\nModel: gpt-4.1-mini\nAPI key: ${fakeOpenAiKey}`)
    ]);

    expect(secrets.apiKeys).toHaveLength(1);
    expect(secrets.apiKeys[0]).toMatchObject({
      provider: "OpenAI",
      model: "gpt-4.1-mini",
      value: fakeOpenAiKey
    });
  });

  it("extracts password records from markdown tables", () => {
    const secrets = extractSecretsFromRecords([
      record(
        "passwords",
        "| website | username | password |\n| --- | --- | --- |\n| example.com | ada | swordfish |\n"
      )
    ]);

    expect(secrets.passwords).toHaveLength(1);
    expect(secrets.passwords[0]).toMatchObject({
      site: "example.com",
      username: "ada",
      password: "swordfish",
      confidence: "high"
    });
  });
});

describe("maskSecret", () => {
  it("keeps only short edges visible", () => {
    const fakeOpenAiKey = ["sk", "test-fake-00000000000000000000"].join("-");
    expect(maskSecret(fakeOpenAiKey)).toMatch(/^sk-t\*+0000$/);
  });
});

function record(id: string, content: string): PasteRecord {
  return {
    id,
    title: id,
    content,
    autoTags: [],
    manualTags: [],
    sensitivity: "high",
    contentKind: "secret",
    createdAt: "2026-06-22T00:00:00.000Z",
    updatedAt: "2026-06-22T00:00:00.000Z",
    contentHash: id
  };
}
