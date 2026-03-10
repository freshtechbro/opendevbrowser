export type ToolError = {
  ok: false;
  error: {
    message: string;
    code?: string;
    details?: Record<string, unknown>;
  };
};

export type ToolOk<T> = T & { ok: true };

export function ok<T extends Record<string, unknown>>(data: T): string {
  return JSON.stringify({ ok: true, ...data });
}

export function failure(message: string, code?: string, details?: Record<string, unknown>): string {
  return JSON.stringify({
    ok: false,
    error: {
      message,
      code,
      ...(details ? { details } : {})
    }
  });
}

export function serializeError(error: unknown): { message: string; code?: string; details?: Record<string, unknown> } {
  if (error instanceof Error) {
    const detailCarrier = error as Error & { code?: string; blocker?: unknown; details?: unknown };
    const details = detailCarrier.details && typeof detailCarrier.details === "object" && !Array.isArray(detailCarrier.details)
      ? detailCarrier.details as Record<string, unknown>
      : detailCarrier.blocker && typeof detailCarrier.blocker === "object" && !Array.isArray(detailCarrier.blocker)
        ? { blocker: detailCarrier.blocker as Record<string, unknown> }
        : undefined;
    return {
      message: error.message,
      code: detailCarrier.code,
      details
    };
  }
  return { message: "Unknown error" };
}
