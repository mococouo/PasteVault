import { describe, expect, it } from "vitest";
import { collectTags, searchRecords } from "./search";
import type { PasteRecord } from "./types";

const baseRecord: PasteRecord = {
  id: "1",
  title: "OpenAI API docs",
  content: "curl https://api.example.com/v1/chat",
  autoTags: ["api-doc", "url"],
  manualTags: ["work"],
  sensitivity: "none",
  contentKind: "api-doc",
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-02T00:00:00.000Z",
  contentHash: "hash"
};

describe("searchRecords", () => {
  it("finds content and filters by tag", () => {
    const results = searchRecords([baseRecord], {
      query: "chat",
      tag: "work",
      sensitivity: "all"
    });

    expect(results).toHaveLength(1);
    expect(results[0].snippet).toContain("chat");
  });

  it("collects unique tags", () => {
    expect(collectTags([baseRecord])).toEqual(["api-doc", "url", "work"]);
  });
});
