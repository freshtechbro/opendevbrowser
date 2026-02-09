type LogErrorOptions = {
  code?: string;
  extra?: Record<string, unknown>;
};

const safeStringify = (value: unknown): string => {
  try {
    const seen = new WeakSet<object>();
    return JSON.stringify(value, (_key, val) => {
      if (typeof val !== "object" || val === null) {
        return val;
      }
      if (seen.has(val)) {
        return "[Circular]";
      }
      seen.add(val);
      return val;
    });
  } catch {
    return "[Unserializable]";
  }
};

const normalizeError = (error: unknown): { message: string; name?: string; stack?: string } => {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack
    };
  }
  if (error && typeof error === "object") {
    const record = error as { message?: unknown; name?: unknown; stack?: unknown };
    const message = typeof record.message === "string" && record.message.trim()
      ? record.message
      : safeStringify(error);
    const name = typeof record.name === "string" ? record.name : undefined;
    const stack = typeof record.stack === "string" ? record.stack : undefined;
    return { message, name, stack };
  }
  if (typeof error === "string") {
    return { message: error };
  }
  return { message: String(error ?? "Unknown error") };
};

export const logError = (context: string, error: unknown, options?: LogErrorOptions): void => {
  const detail = normalizeError(error);
  const payload = {
    context,
    code: options?.code ?? "unknown",
    ...detail,
    ...(options?.extra ?? {})
  };
  console.error("[opendevbrowser]", safeStringify(payload));
};
