import type { DesktopResult, DesktopRuntimeLike } from "../desktop";
import type { ToolDeps } from "./deps";
import { failure, serializeError } from "./response";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function requireDesktopRuntime(deps: ToolDeps): DesktopRuntimeLike | string {
  if (deps.desktopRuntime) {
    return deps.desktopRuntime;
  }
  return failure("Desktop runtime unavailable.", "desktop_runtime_unavailable");
}

export function desktopResult<T>(result: DesktopResult<T>): string {
  if (result.ok) {
    const payload = isRecord(result.value)
      ? { ok: true, ...result.value, audit: result.audit }
      : { ok: true, value: result.value, audit: result.audit };
    return JSON.stringify(payload);
  }
  return JSON.stringify({
    ok: false,
    code: result.code,
    message: result.message,
    audit: result.audit
  });
}

export function desktopToolFailure(error: unknown, code: string): string {
  return failure(serializeError(error).message, code);
}
