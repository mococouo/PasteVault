import type { Classification, ContentKind, SensitiveMatch, Sensitivity } from "./types";
import { collectSensitiveMatches, redactSecrets } from "./secrets";

const MAX_TITLE_LENGTH = 72;

const urlRegex = /\b(?:https?:\/\/|www\.)[^\s"'<>]+/gi;
const emailRegex = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const phoneRegex = /(?<!\d)(?:\+?86[-\s]?)?1[3-9]\d{9}(?!\d)/g;

const keywordGroups: Record<Exclude<ContentKind, "secret" | "url" | "note">, string[]> = {
  account: [
    "账号",
    "账户",
    "用户名",
    "注册",
    "登录",
    "login",
    "username",
    "account",
    "sign in",
    "sign up"
  ],
  resume: [
    "简历",
    "求职",
    "教育经历",
    "工作经历",
    "项目经历",
    "技能",
    "resume",
    "curriculum vitae",
    "work experience",
    "education",
    "skills"
  ],
  job: [
    "jd",
    "job description",
    "岗位职责",
    "任职要求",
    "职位描述",
    "招聘",
    "薪资",
    "responsibilities",
    "requirements",
    "qualifications"
  ],
  "api-doc": [
    "api",
    "endpoint",
    "request",
    "response",
    "authorization",
    "curl",
    "http",
    "sdk",
    "接口",
    "请求参数",
    "返回参数",
    "鉴权"
  ]
};

export function classifyContent(content: string): Classification {
  const normalized = content.trim();
  const lower = normalized.toLowerCase();
  const tags = new Set<string>();
  const sensitiveMatches = collectSensitiveMatches(normalized);

  const sensitivity = resolveSensitivity(normalized, sensitiveMatches);

  for (const match of sensitiveMatches) {
    tags.add(match.pattern);
  }

  if (hasMatch(urlRegex, normalized)) tags.add("url");
  if (hasMatch(emailRegex, normalized)) tags.add("email");
  if (hasMatch(phoneRegex, normalized)) tags.add("phone");

  const scores = new Map<ContentKind, number>();
  for (const [kind, keywords] of Object.entries(keywordGroups) as Array<[
    Exclude<ContentKind, "secret" | "url" | "note">,
    string[]
  ]>) {
    const score = keywords.reduce((total, keyword) => {
      return lower.includes(keyword.toLowerCase()) ? total + 1 : total;
    }, 0);
    if (score > 0) {
      scores.set(kind, score);
      tags.add(kind);
    }
  }

  let contentKind: ContentKind = "note";
  if (sensitivity === "high") {
    contentKind = "secret";
  } else if ((scores.get("resume") ?? 0) >= 2) {
    contentKind = "resume";
  } else if ((scores.get("job") ?? 0) >= 2) {
    contentKind = "job";
  } else if ((scores.get("api-doc") ?? 0) >= 2) {
    contentKind = "api-doc";
  } else if ((scores.get("account") ?? 0) >= 1) {
    contentKind = "account";
  } else if (tags.has("url")) {
    contentKind = "url";
  }

  tags.add(contentKind);

  return {
    title: buildTitle(normalized, contentKind),
    autoTags: Array.from(tags).sort(),
    sensitivity,
    contentKind,
    sensitiveMatches
  };
}

export function redactSensitiveContent(content: string): string {
  return redactSecrets(content);
}

export function parseManualTags(input: string): string[] {
  return uniqueSorted(
    input
      .split(/[,\s，、#]+/g)
      .map((tag) => tag.trim().replace(/^#/, ""))
      .filter(Boolean)
      .map((tag) => tag.toLowerCase())
  );
}

function resolveSensitivity(content: string, matches: SensitiveMatch[]): Sensitivity {
  if (matches.some((match) => match.severity === "high")) return "high";
  if (matches.length > 0) return "low";
  if (hasMatch(emailRegex, content) || hasMatch(phoneRegex, content)) return "low";
  return "none";
}

function buildTitle(content: string, kind: ContentKind): string {
  const firstLine = content
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .find(Boolean);

  const url = content.match(urlRegex)?.[0];

  if (url) {
    try {
      const parsed = new URL(url.startsWith("www.") ? `https://${url}` : url);
      return truncate(stripTrackingParams(parsed.hostname.replace(/^www\./, "")));
    } catch {
      return truncate(url);
    }
  }

  if (firstLine) return truncate(firstLine);

  const labels: Record<ContentKind, string> = {
    "api-doc": "API document",
    account: "Account note",
    job: "Job description",
    note: "Untitled paste",
    resume: "Resume note",
    secret: "Sensitive paste",
    url: "Saved link"
  };
  return labels[kind];
}

function stripTrackingParams(hostname: string): string {
  return hostname;
}

function hasMatch(regex: RegExp, content: string): boolean {
  regex.lastIndex = 0;
  return regex.test(content);
}

function truncate(value: string): string {
  return value.length <= MAX_TITLE_LENGTH ? value : `${value.slice(0, MAX_TITLE_LENGTH - 1)}...`;
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}
