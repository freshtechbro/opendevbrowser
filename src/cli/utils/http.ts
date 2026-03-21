const DEFAULT_HTTP_TIMEOUT_MS = 5000;

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

export type TimedFetchResponse = {
  response: Response;
  signal: AbortSignal;
  timeoutMs: number;
  dispose: () => void;
};

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return "name" in error && (error as { name?: string }).name === "AbortError";
}

const resolveTimeoutMs = (timeoutMs: number = DEFAULT_HTTP_TIMEOUT_MS): number => {
  return Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_HTTP_TIMEOUT_MS;
};

const createTimeoutError = (timeoutMs: number): Error => {
  return new Error(`Request timed out after ${timeoutMs}ms`);
};

const createTimedSignal = (
  timeoutMs: number,
  upstreamSignal?: AbortSignal
): { signal: AbortSignal; dispose: () => void } => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let removeAbortListener: (() => void) | undefined;
  if (upstreamSignal) {
    if (upstreamSignal.aborted) {
      controller.abort(upstreamSignal.reason);
    } else {
      const onAbort = () => controller.abort(upstreamSignal.reason);
      upstreamSignal.addEventListener("abort", onAbort, { once: true });
      removeAbortListener = () => upstreamSignal.removeEventListener("abort", onAbort);
    }
  }

  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timeoutId);
      removeAbortListener?.();
    }
  };
};

const cancelResponseBody = (response: Response): void => {
  try {
    void response.body?.cancel?.();
  } catch {
    // Best effort only.
  }
};

const readResponseBodyWithTimeout = async <T>(
  response: Response,
  signal: AbortSignal,
  timeoutMs: number,
  reader: () => Promise<T>
): Promise<T> => {
  let bodyCancelled = false;
  const cancelBody = () => {
    if (bodyCancelled) {
      return;
    }
    bodyCancelled = true;
    cancelResponseBody(response);
  };

  if (signal.aborted) {
    cancelBody();
    throw createTimeoutError(timeoutMs);
  }

  let removeAbortListener: (() => void) | undefined;
  const abortPromise = new Promise<T>((_, reject) => {
    const onAbort = () => {
      cancelBody();
      reject(createTimeoutError(timeoutMs));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    removeAbortListener = () => signal.removeEventListener("abort", onAbort);
  });

  try {
    return await Promise.race([reader(), abortPromise]);
  } catch (error) {
    if (signal.aborted || isAbortError(error)) {
      cancelBody();
      throw createTimeoutError(timeoutMs);
    }
    throw error;
  } finally {
    removeAbortListener?.();
  }
};

export async function fetchWithTimeout(
  input: FetchInput,
  init: FetchInit = {},
  timeoutMs: number = DEFAULT_HTTP_TIMEOUT_MS
): Promise<Response> {
  const resolvedTimeout = resolveTimeoutMs(timeoutMs);
  const timedSignal = createTimedSignal(resolvedTimeout, init?.signal ?? undefined);

  try {
    return await fetch(input, { ...init, signal: timedSignal.signal });
  } catch (error) {
    if (isAbortError(error) || timedSignal.signal.aborted) {
      throw createTimeoutError(resolvedTimeout);
    }
    throw error;
  } finally {
    timedSignal.dispose();
  }
}

export async function fetchWithTimeoutContext(
  input: FetchInput,
  init: FetchInit = {},
  timeoutMs: number = DEFAULT_HTTP_TIMEOUT_MS
): Promise<TimedFetchResponse> {
  const resolvedTimeout = resolveTimeoutMs(timeoutMs);
  const timedSignal = createTimedSignal(resolvedTimeout, init?.signal ?? undefined);

  try {
    const response = await fetch(input, { ...init, signal: timedSignal.signal });
    return {
      response,
      signal: timedSignal.signal,
      timeoutMs: resolvedTimeout,
      dispose: timedSignal.dispose
    };
  } catch (error) {
    timedSignal.dispose();
    if (isAbortError(error) || timedSignal.signal.aborted) {
      throw createTimeoutError(resolvedTimeout);
    }
    throw error;
  }
}

export async function readResponseTextWithTimeout(
  response: Response,
  signal: AbortSignal,
  timeoutMs: number
): Promise<string> {
  return await readResponseBodyWithTimeout(response, signal, timeoutMs, () => response.text());
}

export async function readResponseJsonWithTimeout<T>(
  response: Response,
  signal: AbortSignal,
  timeoutMs: number
): Promise<T> {
  return await readResponseBodyWithTimeout(response, signal, timeoutMs, () => response.json() as Promise<T>);
}
