export interface CsvParseResult {
  delimiter: string;
  rows: string[][];
}

export interface TableRecordCandidate {
  title: string;
  content: string;
  tags: string[];
}

const DELIMITER_CANDIDATES = [",", ";", "\t", "|"];
const IMPORTANT_HEADERS = [
  "account",
  "username",
  "user",
  "email",
  "login",
  "账号",
  "账户",
  "用户名",
  "邮箱",
  "site",
  "website",
  "url",
  "platform",
  "service",
  "name",
  "title",
  "平台",
  "网站",
  "网址",
  "名称"
];

export function parseCsv(text: string, delimiter = detectDelimiter(text)): CsvParseResult {
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let insideQuotes = false;

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const next = normalized[index + 1];

    if (char === "\"") {
      if (insideQuotes && next === "\"") {
        field += "\"";
        index += 1;
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (char === delimiter && !insideQuotes) {
      row.push(field);
      field = "";
    } else if (char === "\n" && !insideQuotes) {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  row.push(field);
  rows.push(row);

  return {
    delimiter,
    rows: normalizeRows(rows)
  };
}

export function detectDelimiter(text: string): string {
  let bestDelimiter = ",";
  let bestScore = -Infinity;

  for (const delimiter of DELIMITER_CANDIDATES) {
    const rows = parseCsvWithDelimiterOnly(text, delimiter)
      .slice(0, 12)
      .filter((row) => row.some((cell) => cell.trim() !== ""));
    if (!rows.length) continue;

    const counts = rows.map((row) => row.length);
    const maxColumns = Math.max(...counts);
    const consistentRows = counts.filter((count) => count === maxColumns).length;
    const score = maxColumns * 20 + consistentRows * 4 - new Set(counts).size * 3;
    const adjustedScore = maxColumns > 1 ? score : score - 100;
    if (adjustedScore > bestScore) {
      bestScore = adjustedScore;
      bestDelimiter = delimiter;
    }
  }

  return bestDelimiter;
}

export function tableRowsToRecords(rows: string[][], sourceLabel: string, sourceTags: string[]): TableRecordCandidate[] {
  const normalizedRows = normalizeRows(rows);
  if (normalizedRows.length < 2) return [];

  const maxColumns = normalizedRows.reduce((max, row) => Math.max(max, row.length), 0);
  const headers = makeUniqueHeaders(normalizedRows[0], maxColumns);
  const dataRows = normalizedRows.slice(1);

  return dataRows
    .map((row, rowIndex) => rowToRecord(headers, row, rowIndex + 2, sourceLabel, sourceTags))
    .filter((record): record is TableRecordCandidate => Boolean(record));
}

export function tableRowsToMarkdown(rows: string[][]): string {
  const normalizedRows = normalizeRows(rows);
  if (!normalizedRows.length) return "";

  const maxColumns = normalizedRows.reduce((max, row) => Math.max(max, row.length), 0);
  const paddedRows = normalizedRows.map((row) =>
    Array.from({ length: maxColumns }, (_value, index) => formatMarkdownCell(row[index] ?? ""))
  );
  const header = paddedRows[0];
  const separator = header.map(() => "---");
  const body = paddedRows.slice(1);

  return [header, separator, ...body].map((row) => `| ${row.join(" | ")} |`).join("\n");
}

function rowToRecord(
  headers: string[],
  row: string[],
  rowNumber: number,
  sourceLabel: string,
  sourceTags: string[]
): TableRecordCandidate | null {
  const values = headers.map((header, index) => ({
    header,
    value: (row[index] ?? "").trim()
  }));
  const nonEmpty = values.filter((item) => item.value !== "");
  if (!nonEmpty.length) return null;

  const identity =
    IMPORTANT_HEADERS.map((header) => nonEmpty.find((item) => item.header.trim().toLowerCase() === header)).find(
      Boolean
    ) ??
    nonEmpty.find((item) => /账号|账户|用户名|email|mail|user|login|site|url|网站|平台/i.test(item.header)) ??
    nonEmpty[0];

  const lines = [
    `Source: ${sourceLabel}`,
    `Row: ${rowNumber}`,
    "",
    ...nonEmpty.map((item) => `${item.header}: ${item.value}`)
  ];

  return {
    title: `${sourceLabel} row ${rowNumber}: ${identity.value}`,
    content: lines.join("\n"),
    tags: [...sourceTags, "table", "row"]
  };
}

function formatMarkdownCell(value: string): string {
  return value.trim().replace(/\r?\n/g, "<br>").replace(/\|/g, "\\|");
}

function parseCsvWithDelimiterOnly(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let insideQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === "\"") {
      if (insideQuotes && next === "\"") {
        field += "\"";
        index += 1;
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (char === delimiter && !insideQuotes) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !insideQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  row.push(field);
  rows.push(row);
  return rows;
}

function normalizeRows(rows: string[][]): string[][] {
  return rows
    .map((row) => row.map((cell) => cell.trim()))
    .filter((row) => row.some((cell) => cell !== ""));
}

function makeUniqueHeaders(headerRow: string[], maxColumns: number): string[] {
  const seen = new Map<string, number>();
  const headers: string[] = [];

  for (let index = 0; index < maxColumns; index += 1) {
    const raw = (headerRow[index] ?? "").trim();
    const base = raw || `column_${index + 1}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    headers.push(count === 0 ? base : `${base}_${count + 1}`);
  }

  return headers;
}
