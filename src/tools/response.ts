export type ToolError = {
  ok: false;
  error: {
    message: string;
    code?: string;
  };
};

export type ToolOk<T> = T & { ok: true };

export function ok<T extends Record<string, unknown>>(data: T): string {
  return JSON.stringify({ ok: true, ...data });
}

export function failure(message: string, code?: string): string {
  return JSON.stringify({
    ok: false,
    error: {
      message,
      code
    }
  });
}

export function serializeError(error: unknown): { message: string } {
  if (error instanceof Error) {
    return { message: error.message };
  }
  return { message: "Unknown error" };
}
