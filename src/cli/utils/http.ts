const DEFAULT_HTTP_TIMEOUT_MS = 5000;

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return "name" in error && (error as { name?: string }).name === "AbortError";
}

export async function fetchWithTimeout(
  input: FetchInput,
  init: FetchInit = {},
  timeoutMs: number = DEFAULT_HTTP_TIMEOUT_MS
): Promise<Response> {
  const resolvedTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? timeoutMs
    : DEFAULT_HTTP_TIMEOUT_MS;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), resolvedTimeout);

  if (init?.signal) {
    if (init.signal.aborted) {
      controller.abort();
    } else {
      init.signal.addEventListener("abort", () => controller.abort(), { once: true });
    }
  }

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error(`Request timed out after ${resolvedTimeout}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
