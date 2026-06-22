import { describe, expect, it } from "vitest";
import { detectDelimiter, parseCsv, tableRowsToMarkdown, tableRowsToRecords } from "./table";

describe("CSV parsing", () => {
  it("detects delimiter and handles quoted fields", () => {
    const csv = 'site;username;password\n"OpenAI";"ada@example.com";"a;b"\n';

    expect(detectDelimiter(csv)).toBe(";");
    expect(parseCsv(csv).rows).toEqual([
      ["site", "username", "password"],
      ["OpenAI", "ada@example.com", "a;b"]
    ]);
  });
});

describe("tableRowsToRecords", () => {
  it("turns table rows into searchable record candidates", () => {
    const records = tableRowsToRecords(
      [
        ["平台", "账号", "密码"],
        ["GitHub", "me@example.com", "secret"]
      ],
      "accounts.csv",
      ["csv"]
    );

    expect(records).toHaveLength(1);
    expect(records[0].title).toContain("me@example.com");
    expect(records[0].content).toContain("平台: GitHub");
    expect(records[0].content).toContain("密码: secret");
  });
});

describe("tableRowsToMarkdown", () => {
  it("turns a sheet into a markdown table", () => {
    const markdown = tableRowsToMarkdown([
      ["Name", "API Key"],
      ["OpenAI", "fake-api-key-for-tests"],
      ["Pipe", "a|b"]
    ]);

    expect(markdown).toBe("| Name | API Key |\n| --- | --- |\n| OpenAI | fake-api-key-for-tests |\n| Pipe | a\\|b |");
  });
});
