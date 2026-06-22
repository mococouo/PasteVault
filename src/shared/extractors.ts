import type { PasteRecord } from "./types";
import { extractSecretValues, type SecretValueHit } from "./secrets";

export interface ExtractedApiKey {
  id: string;
  sourceRecordId: string;
  sourceTitle: string;
  label: string;
  provider: string;
  model: string;
  tool: string;
  value: string;
  confidence: "high" | "medium" | "low";
}

export interface ExtractedPassword {
  id: string;
  sourceRecordId: string;
  sourceTitle: string;
  site: string;
  url: string;
  tool: string;
  username: string;
  password: string;
  confidence: "high" | "medium" | "low";
}

export interface ExtractedSecrets {
  apiKeys: ExtractedApiKey[];
  passwords: ExtractedPassword[];
}

const API_KEY_TAGS = new Set(["api-key", "token", "jwt", "connection-string", "private-key"]);
const urlRegex = /\bhttps?:\/\/[^\s|,;]+/i;

export function extractSecretsFromRecords(records: PasteRecord[]): ExtractedSecrets {
  const apiKeys: ExtractedApiKey[] = [];
  const passwords: ExtractedPassword[] = [];
  const seenApiKeys = new Set<string>();
  const seenPasswords = new Set<string>();

  for (const record of records) {
    extractApiKeys(record, apiKeys, seenApiKeys);
    extractPasswordsFromLabeledText(record, passwords, seenPasswords);
    extractPasswordsFromMarkdownTables(record, passwords, seenPasswords);
  }

  return { apiKeys, passwords };
}

export function maskSecret(value: string): string {
  if (value.length <= 8) return "********";
  return `${value.slice(0, 4)}${"*".repeat(Math.min(18, Math.max(8, value.length - 8)))}${value.slice(-4)}`;
}

function extractApiKeys(record: PasteRecord, results: ExtractedApiKey[], seen: Set<string>): void {
  const hits = extractSecretValues(record.content);
  for (const hit of hits) {
    if (!API_KEY_TAGS.has(hit.tag)) continue;
    const key = `${record.id}:${hit.value}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const context = contextForHit(record.content, hit.index, 4);
    const provider = hit.provider || findLabeledValue(context, ["provider", "平台", "服务商"]) || "Review needed";
    const model = findLabeledValue(context, ["model", "模型"]) || "Review needed";
    const tool = findLabeledValue(context, ["tool", "工具", "service", "service name", "应用"]) || "";

    results.push({
      id: `api-${record.id}-${results.length}`,
      sourceRecordId: record.id,
      sourceTitle: record.title,
      label: hit.label,
      provider,
      model,
      tool,
      value: hit.value,
      confidence: model !== "Review needed" || tool ? "medium" : "low"
    });
  }
}

function extractPasswordsFromLabeledText(
  record: PasteRecord,
  results: ExtractedPassword[],
  seen: Set<string>
): void {
  const hits = extractSecretValues(record.content);
  for (const hit of hits) {
    if (hit.tag !== "password") continue;
    const context = contextForHit(record.content, hit.index, 6);
    addPasswordResult(record, results, seen, {
      password: hit.value,
      username: findLabeledValue(context, ["username", "user", "login", "email", "账号", "用户名", "邮箱"]),
      site: findLabeledValue(context, ["site", "website", "platform", "service", "网站", "平台", "服务"]),
      url: context.match(urlRegex)?.[0] ?? "",
      tool: findLabeledValue(context, ["tool", "工具", "app", "应用"])
    });
  }
}

function extractPasswordsFromMarkdownTables(
  record: PasteRecord,
  results: ExtractedPassword[],
  seen: Set<string>
): void {
  const lines = record.content.split(/\r?\n/g);
  for (let index = 0; index < lines.length - 2; index += 1) {
    if (!isMarkdownTableLine(lines[index]) || !isMarkdownSeparator(lines[index + 1])) continue;

    const headers = splitMarkdownRow(lines[index]).map((header) => header.trim().toLowerCase());
    index += 2;
    while (index < lines.length && isMarkdownTableLine(lines[index])) {
      const row = splitMarkdownRow(lines[index]);
      const password = valueByHeader(headers, row, ["password", "pwd", "密码"]);
      if (password) {
        addPasswordResult(record, results, seen, {
          password,
          username: valueByHeader(headers, row, ["username", "user", "login", "email", "账号", "用户名", "邮箱"]),
          site: valueByHeader(headers, row, ["site", "website", "platform", "service", "网站", "平台", "服务"]),
          url: valueByHeader(headers, row, ["url", "网址", "网站地址"]),
          tool: valueByHeader(headers, row, ["tool", "工具", "app", "应用"])
        });
      }
      index += 1;
    }
  }
}

function addPasswordResult(
  record: PasteRecord,
  results: ExtractedPassword[],
  seen: Set<string>,
  input: { password: string; username?: string; site?: string; url?: string; tool?: string }
): void {
  const site = input.site || hostFromUrl(input.url ?? "") || "Review needed";
  const username = input.username || "Review needed";
  const url = input.url ?? "";
  const tool = input.tool ?? "";
  const key = `${record.id}:${site}:${username}:${input.password}`;
  if (seen.has(key)) return;
  seen.add(key);

  results.push({
    id: `password-${record.id}-${results.length}`,
    sourceRecordId: record.id,
    sourceTitle: record.title,
    site,
    url,
    tool,
    username,
    password: input.password,
    confidence: site !== "Review needed" && username !== "Review needed" ? "high" : "low"
  });
}

function contextForHit(content: string, index: number, radius: number): string {
  const lines = content.split(/\r?\n/g);
  let charCount = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const lineEnd = charCount + lines[i].length;
    if (index >= charCount && index <= lineEnd + 1) {
      const start = Math.max(0, i - radius);
      const end = Math.min(lines.length, i + radius + 1);
      return lines.slice(start, end).join("\n");
    }
    charCount = lineEnd + 1;
  }
  return content;
}

function findLabeledValue(text: string, labels: string[]): string {
  for (const label of labels) {
    const escaped = escapeRegex(label);
    const match = text.match(new RegExp(`(?:^|[\\n|,;])\\s*${escaped}\\s*[:=：|]\\s*([^\\n|,;]+)`, "i"));
    if (match?.[1]) return match[1].trim();
  }
  return "";
}

function valueByHeader(headers: string[], row: string[], labels: string[]): string {
  const index = headers.findIndex((header) => labels.some((label) => header.includes(label.toLowerCase())));
  return index >= 0 ? (row[index] ?? "").trim() : "";
}

function hostFromUrl(url: string): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
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

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
