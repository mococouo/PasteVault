import type { PasteRecord, SearchFilters, SearchResult } from "./types";

const SNIPPET_RADIUS = 48;

export function searchRecords(records: PasteRecord[], filters: SearchFilters): SearchResult[] {
  const query = filters.query.trim().toLowerCase();
  const tag = filters.tag.trim().toLowerCase();

  return records
    .filter((record) => {
      if (tag && tag !== "all" && !allTags(record).includes(tag)) return false;
      if (filters.sensitivity !== "all" && record.sensitivity !== filters.sensitivity) return false;
      if (!query) return true;
      return searchableText(record).includes(query);
    })
    .map((record) => ({
      record,
      score: scoreRecord(record, query),
      snippet: makeSnippet(record, query)
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return Date.parse(b.record.updatedAt) - Date.parse(a.record.updatedAt);
    });
}

export function collectTags(records: PasteRecord[]): string[] {
  return Array.from(new Set(records.flatMap(allTags))).sort((a, b) => a.localeCompare(b));
}

export function allTags(record: PasteRecord): string[] {
  return Array.from(new Set([...record.autoTags, ...record.manualTags])).sort((a, b) => a.localeCompare(b));
}

function searchableText(record: PasteRecord): string {
  return [record.title, record.content, ...record.autoTags, ...record.manualTags, record.contentKind]
    .join("\n")
    .toLowerCase();
}

function scoreRecord(record: PasteRecord, query: string): number {
  if (!query) return Date.parse(record.updatedAt);
  let score = 0;
  const title = record.title.toLowerCase();
  const tags = allTags(record).join(" ").toLowerCase();
  const content = record.content.toLowerCase();

  if (title.includes(query)) score += 120;
  if (tags.includes(query)) score += 80;
  if (record.contentKind.includes(query)) score += 40;

  const occurrences = content.split(query).length - 1;
  score += Math.min(occurrences, 20) * 8;
  score += Math.max(0, 30 - Math.floor((Date.now() - Date.parse(record.updatedAt)) / 86_400_000));
  return score;
}

function makeSnippet(record: PasteRecord, query: string): string {
  const compact = record.content.replace(/\s+/g, " ").trim();
  if (!compact) return "";
  if (!query) return truncate(compact, SNIPPET_RADIUS * 2);

  const index = compact.toLowerCase().indexOf(query);
  if (index === -1) return truncate(compact, SNIPPET_RADIUS * 2);

  const start = Math.max(0, index - SNIPPET_RADIUS);
  const end = Math.min(compact.length, index + query.length + SNIPPET_RADIUS);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < compact.length ? "..." : "";
  return `${prefix}${compact.slice(start, end)}${suffix}`;
}

function truncate(value: string, length: number): string {
  return value.length <= length ? value : `${value.slice(0, length - 1)}...`;
}
