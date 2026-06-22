import type { SensitiveMatch } from "./types";

export type SecretSeverity = "high" | "low";

export interface SecretRule {
  label: string;
  tag: string;
  provider: string;
  severity: SecretSeverity;
  regex: RegExp;
  redact: RegExp;
}

export interface SecretValueHit {
  label: string;
  tag: string;
  provider: string;
  severity: SecretSeverity;
  value: string;
  index: number;
}

export const secretRules: SecretRule[] = [
  {
    label: "OpenAI API key",
    tag: "api-key",
    provider: "OpenAI",
    severity: "high",
    regex: /\b(?<value>sk-[A-Za-z0-9_-]{20,})\b/g,
    redact: /\bsk-[A-Za-z0-9_-]{8,}\b/g
  },
  {
    label: "GitHub token",
    tag: "token",
    provider: "GitHub",
    severity: "high",
    regex: /\b(?<value>(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{20,})\b/g,
    redact: /\b(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{8,}\b/g
  },
  {
    label: "AWS access key",
    tag: "api-key",
    provider: "AWS",
    severity: "high",
    regex: /\b(?<value>AKIA[0-9A-Z]{16})\b/g,
    redact: /\bAKIA[0-9A-Z]{16}\b/g
  },
  {
    label: "Google API key",
    tag: "api-key",
    provider: "Google",
    severity: "high",
    regex: /\b(?<value>AIza[0-9A-Za-z_-]{35})\b/g,
    redact: /\bAIza[0-9A-Za-z_-]{8,}\b/g
  },
  {
    label: "Stripe live key",
    tag: "api-key",
    provider: "Stripe",
    severity: "high",
    regex: /\b(?<value>(?:sk|rk)_live_[A-Za-z0-9]{24,})\b/g,
    redact: /\b(?:sk|rk)_live_[A-Za-z0-9]{8,}\b/g
  },
  {
    label: "Slack token",
    tag: "token",
    provider: "Slack",
    severity: "high",
    regex: /\b(?<value>xox[baprs]-[A-Za-z0-9-]{10,})\b/g,
    redact: /\bxox[baprs]-[A-Za-z0-9-]{8,}\b/g
  },
  {
    label: "Twilio API key",
    tag: "api-key",
    provider: "Twilio",
    severity: "high",
    regex: /\b(?<value>SK[0-9a-fA-F]{32})\b/g,
    redact: /\bSK[0-9a-fA-F]{8,}\b/g
  },
  {
    label: "JWT",
    tag: "jwt",
    provider: "JWT",
    severity: "high",
    regex: /\b(?<value>eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})\b/g,
    redact: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g
  },
  {
    label: "Database connection string",
    tag: "connection-string",
    provider: "",
    severity: "high",
    regex: /\b(?<value>(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis):\/\/[^\s|"'<>]{4,})/g,
    redact: /((?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis):\/\/)[^\s|"'<>]{4,}/g
  },
  {
    label: "Private key",
    tag: "private-key",
    provider: "",
    severity: "high",
    regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    redact: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g
  },
  {
    label: "API key",
    tag: "api-key",
    provider: "",
    severity: "high",
    regex: /\b(?:api[_\-\s]?key|access[_\-\s]?key|secret[_\-\s]?key|client[_\-\s]?secret|access[_\-\s]?token)\b\s*[:=]\s*["']?(?<value>[A-Za-z0-9_\-./+=]{12,})/gi,
    redact: /(\b(?:api[_\-\s]?key|access[_\-\s]?key|secret[_\-\s]?key|client[_\-\s]?secret|access[_\-\s]?token)\b\s*[:=]\s*["']?)[A-Za-z0-9_\-./+=]{8,}/gi
  },
  {
    label: "Bearer token",
    tag: "token",
    provider: "Bearer",
    severity: "high",
    regex: /\bBearer\s+(?<value>[A-Za-z0-9_\-./+=]{16,})/g,
    redact: /(\bBearer\s+)[A-Za-z0-9_\-./+=]{8,}/g
  },
  {
    label: "Password",
    tag: "password",
    provider: "",
    severity: "high",
    regex: /\b(?:password|passwd|pwd|pass|密码|口令)\b\s*[:=：]\s*["']?(?<value>\S{4,})/gi,
    redact: /(\b(?:password|passwd|pwd|pass|密码|口令)\b\s*[:=：]\s*["']?)\S{2,}/gi
  },
  {
    label: "Chinese ID",
    tag: "id-number",
    provider: "",
    severity: "low",
    regex: /\b(?<value>\d{17}[\dXx])\b/g,
    redact: /\b\d{6}\d{8}\d{3}[\dXx]\b/g
  }
];

export function collectSensitiveMatches(content: string): SensitiveMatch[] {
  const matches: SensitiveMatch[] = [];
  for (const rule of secretRules) {
    rule.regex.lastIndex = 0;
    const found = content.match(rule.regex);
    if (found?.length) {
      matches.push({
        label: rule.label,
        pattern: rule.tag,
        severity: rule.severity,
        count: found.length
      });
    }
    rule.regex.lastIndex = 0;
  }
  return matches;
}

export function redactSecrets(content: string): string {
  let redacted = content;
  for (const rule of secretRules) {
    redacted = redacted.replace(rule.redact, (value: string, prefix?: string) => {
      if (prefix && value.startsWith(prefix)) {
        return `${prefix}${maskValue(value.slice(prefix.length))}`;
      }
      return maskValue(value);
    });
  }
  return redacted;
}

export function extractSecretValues(content: string): SecretValueHit[] {
  const hits: SecretValueHit[] = [];
  for (const rule of secretRules) {
    rule.regex.lastIndex = 0;
    for (const match of content.matchAll(rule.regex)) {
      const value = match.groups?.value ?? match[0];
      hits.push({
        label: rule.label,
        tag: rule.tag,
        provider: rule.provider,
        severity: rule.severity,
        value,
        index: match.index ?? 0
      });
    }
    rule.regex.lastIndex = 0;
  }
  return hits;
}

function maskValue(value: string): string {
  if (value.length <= 6) return "******";
  return `${value.slice(0, 3)}${"*".repeat(Math.min(16, Math.max(6, value.length - 6)))}${value.slice(-3)}`;
}
