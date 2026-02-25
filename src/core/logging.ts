import { randomUUID } from "crypto";

export type LogLevel = "debug" | "info" | "warn" | "error" | "audit";

export type LogEnvelope = {
  ts: string;
  level: LogLevel;
  module: string;
  event: string;
  requestId: string;
  sessionId?: string;
  traceId?: string;
  data?: unknown;
};

type LogFields = {
  requestId?: string;
  sessionId?: string;
  traceId?: string;
  data?: unknown;
};

type LogSink = (entry: LogEnvelope) => void;

const SECRET_KEY_PATTERN = /(token|secret|password|authorization|cookie|api[-_]?key|session)/i;
const SECRET_VALUE_PATTERN = /(bearer\s+[a-z0-9._-]+|sk_[a-z0-9_-]+|pk_[a-z0-9_-]+|eyJ[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+)/gi;

function redactString(value: string): string {
  return value.replace(SECRET_VALUE_PATTERN, "[REDACTED]");
}

export function redactSensitive(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") {
    return redactString(value);
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  if (seen.has(value)) {
    return "[Circular]";
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactSensitive(item, seen));
  }

  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      output[key] = "[REDACTED]";
      continue;
    }
    output[key] = redactSensitive(entry, seen);
  }
  return output;
}

export function createRequestId(): string {
  return randomUUID();
}

const defaultSink: LogSink = (entry) => {
  const payload = JSON.stringify(entry);
  if (entry.level === "error") {
    console.error(payload);
    return;
  }
  if (entry.level === "warn") {
    console.warn(payload);
    return;
  }
  console.log(payload);
};

export function createLogger(moduleName: string, sink: LogSink = defaultSink): {
  debug: (event: string, fields?: LogFields) => LogEnvelope;
  info: (event: string, fields?: LogFields) => LogEnvelope;
  warn: (event: string, fields?: LogFields) => LogEnvelope;
  error: (event: string, fields?: LogFields) => LogEnvelope;
  audit: (event: string, fields?: LogFields) => LogEnvelope;
} {
  const emit = (level: LogLevel, event: string, fields: LogFields = {}): LogEnvelope => {
    const entry: LogEnvelope = {
      ts: new Date().toISOString(),
      level,
      module: moduleName,
      event,
      requestId: fields.requestId ?? createRequestId(),
      ...(fields.sessionId ? { sessionId: fields.sessionId } : {}),
      ...(fields.traceId ? { traceId: fields.traceId } : {}),
      ...(typeof fields.data === "undefined" ? {} : { data: redactSensitive(fields.data) })
    };
    sink(entry);
    return entry;
  };

  return {
    debug: (event, fields) => emit("debug", event, fields),
    info: (event, fields) => emit("info", event, fields),
    warn: (event, fields) => emit("warn", event, fields),
    error: (event, fields) => emit("error", event, fields),
    audit: (event, fields) => emit("audit", event, fields)
  };
}

export const __test__ = {
  redactString,
  defaultSink
};
