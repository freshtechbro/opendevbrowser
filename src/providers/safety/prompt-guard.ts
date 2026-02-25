import type { JsonValue, NormalizedRecord } from "../types";

type PromptGuardSeverity = "low" | "medium" | "high";
type PromptGuardAction = "strip" | "quarantine";
type PromptGuardField = "title" | "content";

type PromptGuardRule = {
  id: string;
  regex: RegExp;
  severity: PromptGuardSeverity;
  action: PromptGuardAction;
};

export interface PromptGuardEntry {
  pattern: string;
  action: PromptGuardAction;
  severity: PromptGuardSeverity;
  excerpt: string;
}

export interface PromptGuardRecordEntry extends PromptGuardEntry {
  recordId: string;
  field: PromptGuardField;
}

export interface PromptGuardTextResult {
  text: string;
  diagnostics: {
    entries: number;
    quarantinedSegments: number;
  };
  entries: PromptGuardEntry[];
}

export interface PromptGuardResult {
  records: NormalizedRecord[];
  audit: {
    enabled: boolean;
    quarantinedSegments: number;
    entries: PromptGuardRecordEntry[];
  };
}

const MAX_EXCERPT_LENGTH = 120;

const RULES: PromptGuardRule[] = [
  {
    id: "reveal_system_prompt",
    regex: /\b(reveal|show|print|dump|expose|leak)\b[^.!?\n]{0,80}\b(system prompt|hidden prompt|internal prompt)\b/gi,
    severity: "high",
    action: "quarantine"
  },
  {
    id: "tool_abuse_directive",
    regex: /\buse (?:the )?tool(?:ing)?\b[^.!?\n]{0,120}\b(delete|remove|drop|wipe|exfiltrat|override|bypass)\w*/gi,
    severity: "high",
    action: "quarantine"
  },
  {
    id: "ignore_previous_instructions",
    regex: /\bignore (?:all )?previous instructions?\b/gi,
    severity: "medium",
    action: "strip"
  },
  {
    id: "reveal_hidden_data",
    regex: /\breveal (?:hidden|secret|confidential) (?:data|information)\b/gi,
    severity: "high",
    action: "quarantine"
  }
];

const sanitizeExcerpt = (value: string): string => {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= MAX_EXCERPT_LENGTH) return compact;
  return `${compact.slice(0, MAX_EXCERPT_LENGTH - 3)}...`;
};

const isJsonObject = (value: JsonValue | undefined): value is Record<string, JsonValue> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const withSecurityAttributes = (
  record: NormalizedRecord,
  enabled: boolean,
  guardEntries: number,
  quarantinedSegments: number
): Record<string, JsonValue> => {
  const existingSecurity = isJsonObject(record.attributes.security)
    ? record.attributes.security
    : {};

  return {
    ...record.attributes,
    security: {
      ...existingSecurity,
      untrustedContent: true,
      dataOnlyContext: true,
      promptGuardEnabled: enabled,
      guardEntries,
      quarantinedSegments
    }
  };
};

export function sanitizePromptGuardText(text: string, enabled: boolean): PromptGuardTextResult {
  if (!enabled || !text) {
    return {
      text,
      diagnostics: { entries: 0, quarantinedSegments: 0 },
      entries: []
    };
  }

  let output = text;
  const entries: PromptGuardEntry[] = [];

  for (const rule of RULES) {
    rule.regex.lastIndex = 0;
    output = output.replace(rule.regex, (match) => {
      entries.push({
        pattern: rule.id,
        action: rule.action,
        severity: rule.severity,
        excerpt: sanitizeExcerpt(match)
      });
      return rule.action === "quarantine" ? "[QUARANTINED]" : " ";
    });
  }

  const normalized = output.replace(/\s{2,}/g, " ").trim();
  const quarantinedSegments = entries.reduce((count, entry) => {
    return entry.action === "quarantine" ? count + 1 : count;
  }, 0);

  return {
    text: normalized,
    diagnostics: {
      entries: entries.length,
      quarantinedSegments
    },
    entries
  };
}

export function applyPromptGuard(records: NormalizedRecord[], enabled: boolean): PromptGuardResult {
  const auditEntries: PromptGuardRecordEntry[] = [];
  let totalQuarantinedSegments = 0;

  const guardedRecords = records.map((record) => {
    if (!enabled) {
      return {
        ...record,
        attributes: withSecurityAttributes(record, false, 0, 0)
      };
    }

    let title = record.title;
    let content = record.content;
    let recordEntries = 0;
    let recordQuarantinedSegments = 0;

    if (typeof record.title === "string") {
      const sanitizedTitle = sanitizePromptGuardText(record.title, true);
      title = sanitizedTitle.text;
      recordEntries += sanitizedTitle.diagnostics.entries;
      recordQuarantinedSegments += sanitizedTitle.diagnostics.quarantinedSegments;
      for (const entry of sanitizedTitle.entries) {
        auditEntries.push({
          ...entry,
          recordId: record.id,
          field: "title"
        });
      }
    }

    if (typeof record.content === "string") {
      const sanitizedContent = sanitizePromptGuardText(record.content, true);
      content = sanitizedContent.text;
      recordEntries += sanitizedContent.diagnostics.entries;
      recordQuarantinedSegments += sanitizedContent.diagnostics.quarantinedSegments;
      for (const entry of sanitizedContent.entries) {
        auditEntries.push({
          ...entry,
          recordId: record.id,
          field: "content"
        });
      }
    }

    totalQuarantinedSegments += recordQuarantinedSegments;

    return {
      ...record,
      ...(typeof title === "string" ? { title } : {}),
      ...(typeof content === "string" ? { content } : {}),
      attributes: withSecurityAttributes(record, true, recordEntries, recordQuarantinedSegments)
    };
  });

  return {
    records: guardedRecords,
    audit: {
      enabled,
      quarantinedSegments: enabled ? totalQuarantinedSegments : 0,
      entries: enabled ? auditEntries : []
    }
  };
}
