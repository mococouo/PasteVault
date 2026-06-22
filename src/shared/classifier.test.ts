import { describe, expect, it } from "vitest";
import { classifyContent, parseManualTags, redactSensitiveContent } from "./classifier";

describe("classifyContent", () => {
  it("marks API keys and passwords as high sensitivity", () => {
    const result = classifyContent("api_key = fake-api-key-for-tests-0000\npassword: correct-horse");

    expect(result.sensitivity).toBe("high");
    expect(result.contentKind).toBe("secret");
    expect(result.autoTags).toContain("api-key");
    expect(result.autoTags).toContain("password");
  });

  it("recognizes job descriptions", () => {
    const result = classifyContent("JD\n岗位职责：开发桌面应用\n任职要求：熟悉 TypeScript");

    expect(result.contentKind).toBe("job");
    expect(result.autoTags).toContain("job");
  });

  it("redacts sensitive values without dropping labels", () => {
    const redacted = redactSensitiveContent("password: my-super-secret\nBearer abcdefghijklmnopqrstuvwxyz");

    expect(redacted).toContain("password:");
    expect(redacted).toContain("Bearer");
    expect(redacted).not.toContain("my-super-secret");
    expect(redacted).not.toContain("abcdefghijklmnopqrstuvwxyz");
  });
});

describe("parseManualTags", () => {
  it("normalizes separators and duplicates", () => {
    expect(parseManualTags("#Work, work，JD api")).toEqual(["api", "jd", "work"]);
  });
});
