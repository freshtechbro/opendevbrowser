import type { JsonValue, NormalizedRecord } from "../types";

type GuardSeverity = "medium" | "high";
type GuardAction = "strip" | "quarantine";

type PromptGuardPattern = {
  code: string;
  severity: GuardSeverity;
  regex: RegExp;
};

export type PromptGuardEntry = {
  recordId: string;
  provider: string;
  field: "title" | "content";
  pattern: string;
  severity: GuardSeverity;
  action: GuardAction;
  excerpt: string;
};

export type PromptGuardAudit = {
  enabled: boolean;
  quarantinedSegments: number;
  entries: PromptGuardEntry[];
};

export type PromptGuardResult = {
  records: NormalizedRecord[];
  audit: PromptGuardAudit;
};

export type PromptGuardTextSanitization = {
  text: string;
  diagnostics: {
    entries: number;
    quarantinedSegments: number;
  };
};

const PATTERNS: PromptGuardPattern[] = [
  {
    code: "ignore_previous_instructions",
    severity: "high",
    regex: /\bignore\s+(all\s+)?(previous|prior)\s+instructions?\b/gi
  },
  {
    code: "reveal_system_prompt",
    severity: "high",
    regex: /\b(reveal|print|show)\s+(the\s+)?(system|developer)\s+prompt\b/gi
  },
  {
    code: "prompt_injection_marker",
    severity: "high",
    regex: /\b(prompt|instruction)\s*injection\b/gi
  },
  {
    code: "credential_exfiltration",
    severity: "high",
    regex: /\b(api\s*key|token|password|secret)\b.{0,40}\b(send|share|return|exfiltrate)\b/gi
  },
  {
    code: "tool_abuse_directive",
    severity: "medium",
    regex: /\b(use|call|invoke)\s+(the\s+)?(tool|function)\b.{0,60}\b(delete|rm\s+-rf|drop|shutdown)\b/gi
  }
];

const excerpt = (value: string): string => value.slice(0, 120);

const asJsonRecord = (value: JsonValue | undefined): Record<string, JsonValue> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, JsonValue>;
};

const withSecurityTag = (
  record: NormalizedRecord,
  options: { enabled: boolean; quarantinedSegments: number; entries: number }
): NormalizedRecord => {
  const security = asJsonRecord(record.attributes.security as JsonValue | undefined);
  return {
    ...record,
    attributes: {
      ...record.attributes,
      security: {
        ...security,
        untrustedContent: true,
        dataOnlyContext: true,
        promptGuardEnabled: options.enabled,
        quarantinedSegments: options.quarantinedSegments,
        guardEntries: options.entries
      }
    }
  };
};

const sanitizeField = (
  input: string,
  provider: string,
  recordId: string,
  field: "title" | "content",
  entries: PromptGuardEntry[]
): string => {
  let output = input;

  for (const pattern of PATTERNS) {
    let matched = false;
    output = output.replace(pattern.regex, (segment) => {
      matched = true;
      entries.push({
        recordId,
        provider,
        field,
        pattern: pattern.code,
        severity: pattern.severity,
        action: pattern.severity === "high" ? "quarantine" : "strip",
        excerpt: excerpt(segment)
      });
      return pattern.severity === "high" ? " [QUARANTINED] " : " ";
    });

    if (matched) {
      output = output.replace(/\s{2,}/g, " ").trim();
    }
  }

  return output;
};

export const sanitizePromptGuardText = (
  text: string,
  enabled: boolean
): PromptGuardTextSanitization => {
  if (!enabled || !text) {
    return {
      text,
      diagnostics: {
        entries: 0,
        quarantinedSegments: 0
      }
    };
  }

  const entries: PromptGuardEntry[] = [];
  const sanitized = sanitizeField(text, "blocker", "blocker", "content", entries);
  return {
    text: sanitized,
    diagnostics: {
      entries: entries.length,
      quarantinedSegments: entries.filter((entry) => entry.action === "quarantine").length
    }
  };
};

export const applyPromptGuard = (
  records: NormalizedRecord[],
  enabled: boolean
): PromptGuardResult => {
  if (!enabled) {
    return {
      records: records.map((record) => withSecurityTag(record, {
        enabled: false,
        quarantinedSegments: 0,
        entries: 0
      })),
      audit: {
        enabled: false,
        quarantinedSegments: 0,
        entries: []
      }
    };
  }

  const entries: PromptGuardEntry[] = [];
  const sanitized = records.map((record) => {
    const beforeEntries = entries.length;
    const title = typeof record.title === "string"
      ? sanitizeField(record.title, record.provider, record.id, "title", entries)
      : undefined;
    const content = typeof record.content === "string"
      ? sanitizeField(record.content, record.provider, record.id, "content", entries)
      : undefined;
    const recordEntries = entries.slice(beforeEntries);

    return withSecurityTag({
      ...record,
      ...(title === undefined ? {} : { title }),
      ...(content === undefined ? {} : { content })
    }, {
      enabled: true,
      quarantinedSegments: recordEntries.filter((entry) => entry.action === "quarantine").length,
      entries: recordEntries.length
    });
  });

  return {
    records: sanitized,
    audit: {
      enabled: true,
      quarantinedSegments: entries.filter((entry) => entry.action === "quarantine").length,
      entries
    }
  };
};
