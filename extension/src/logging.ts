type LogErrorOptions = {
  code?: string;
  extra?: Record<string, unknown>;
};

const normalizeError = (error: unknown): { message: string; name?: string; stack?: string } => {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack
    };
  }
  if (typeof error === "string") {
    return { message: error };
  }
  try {
    return { message: JSON.stringify(error) };
  } catch {
    return { message: "Unknown error" };
  }
};

export const logError = (context: string, error: unknown, options?: LogErrorOptions): void => {
  const detail = normalizeError(error);
  const payload = {
    context,
    code: options?.code ?? "unknown",
    ...detail,
    ...(options?.extra ?? {})
  };
  console.error("[opendevbrowser]", payload);
};

