import { randomUUID } from "crypto";
import { existsSync } from "fs";
import { join } from "path";
import type { Page } from "playwright-core";
import type { BrowserManagerLike } from "../browser/manager-types";
import { getExtensionPath } from "../extension-extractor";
import type {
  AnnotationErrorCode,
  AnnotationPayload,
  AnnotationResponse,
  AnnotationScreenshotMode
} from "../relay/protocol";

export type DirectAnnotateAssets = {
  scriptPath: string;
  stylePath: string;
};

export type DirectAnnotateRequest = {
  sessionId: string;
  targetId?: string;
  url?: string;
  screenshotMode?: AnnotationScreenshotMode;
  debug?: boolean;
  context?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
};

type DirectCompletionMessage =
  | { type: "annotation:complete"; requestId: string; payload: AnnotationPayload }
  | { type: "annotation:error"; requestId: string; error: { code: AnnotationErrorCode; message: string } }
  | { type: "annotation:cancelled"; requestId: string };

type DirectDispatchRuntime = {
  dispatch: (message: Record<string, unknown>) => unknown;
};

const DEFAULT_TIMEOUT_MS = 120_000;
const bindingState = new WeakSet<Page>();
const completionMap = new WeakMap<Page, Map<string, (message: DirectCompletionMessage) => void>>();

export function resolveDirectAnnotateAssets(
  resolvePath: () => string | null = getExtensionPath
): { assets?: DirectAnnotateAssets; error?: string } {
  const extensionPath = resolvePath();
  if (!extensionPath) {
    return { error: "Extension assets unavailable." };
  }
  const scriptPath = join(extensionPath, "dist", "annotate-content.js");
  const stylePath = join(extensionPath, "dist", "annotate-content.css");
  if (!existsSync(scriptPath) || !existsSync(stylePath)) {
    return { error: "Direct annotate assets missing. Run `npm run extension:build` and retry." };
  }
  return { assets: { scriptPath, stylePath } };
}

export async function runDirectAnnotate(
  manager: BrowserManagerLike,
  assets: DirectAnnotateAssets,
  request: DirectAnnotateRequest
): Promise<AnnotationResponse> {
  const requestId = randomUUID();
  const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return manager.withPage(request.sessionId, request.targetId ?? null, async (page) => {
    await ensureBindings(page);
    await ensureShim(page);

    if (request.url) {
      await page.goto(request.url, { waitUntil: "load" });
    }

    await injectAssets(page, assets);
    await ensureAnnotationReady(page);

    const completionHandlers = getCompletionMap(page);
    const responsePromise = new Promise<AnnotationResponse>((resolve) => {
      completionHandlers.set(requestId, (message) => {
        resolve(mapCompletionToResponse(message, requestId));
      });
    });

    const timeoutPromise = new Promise<AnnotationResponse>((resolve) => {
      const timeoutId = setTimeout(() => {
        clearTimeout(timeoutId);
        resolve({
          version: 1,
          requestId,
          status: "error",
          error: { code: "timeout", message: "Annotation request timed out." }
        });
      }, timeoutMs);
    });

    const abortPromise = new Promise<AnnotationResponse>((resolve) => {
      if (!request.signal) return;
      if (request.signal.aborted) {
        resolve({
          version: 1,
          requestId,
          status: "cancelled",
          error: { code: "cancelled", message: "Annotation request cancelled." }
        });
        return;
      }
      const onAbort = () => {
        resolve({
          version: 1,
          requestId,
          status: "cancelled",
          error: { code: "cancelled", message: "Annotation request cancelled." }
        });
      };
      request.signal.addEventListener("abort", onAbort, { once: true });
    });

    await dispatchMessage(page, {
      type: "annotation:start",
      requestId,
      options: {
        screenshotMode: request.screenshotMode ?? "visible",
        debug: request.debug,
        context: request.context
      },
      url: request.url
    });

    const result = await Promise.race([responsePromise, timeoutPromise, abortPromise]);
    completionHandlers.delete(requestId);

    if (result.status !== "ok" && (result.error?.code === "timeout" || result.status === "cancelled")) {
      await dispatchMessage(page, { type: "annotation:cancel", requestId });
    }

    return result;
  });
}

function getCompletionMap(page: Page): Map<string, (message: DirectCompletionMessage) => void> {
  let existing = completionMap.get(page);
  if (!existing) {
    existing = new Map();
    completionMap.set(page, existing);
  }
  return existing;
}

async function ensureBindings(page: Page): Promise<void> {
  if (!bindingState.has(page)) {
    try {
      await page.exposeBinding("__odbDirectCapture", async (_source, _mode: AnnotationScreenshotMode) => {
        const buffer = await page.screenshot({ type: "png", fullPage: false });
        const base64 = buffer.toString("base64");
        return `data:image/png;base64,${base64}`;
      });
    } catch (error) {
      if (!isBindingExistsError(error)) {
        throw error;
      }
    }

    try {
      await page.exposeBinding("__odbDirectComplete", (_source, message: DirectCompletionMessage) => {
        if (!message || typeof message !== "object") return;
        const requestId = (message as DirectCompletionMessage).requestId;
        if (!requestId) return;
        const handlers = completionMap.get(page);
        const handler = handlers?.get(requestId);
        if (handler) {
          handler(message as DirectCompletionMessage);
          handlers?.delete(requestId);
        }
      });
    } catch (error) {
      if (!isBindingExistsError(error)) {
        throw error;
      }
    }

    bindingState.add(page);
  }
}

async function ensureShim(page: Page): Promise<void> {
  await page.addInitScript(installShim);
  await page.evaluate(installShim);
}

function installShim(): void {
  const w = window as unknown as {
    chrome?: { runtime?: Record<string, unknown> };
    __odbDirectShim?: boolean;
    __odbDirectRuntime?: DirectDispatchRuntime;
    __odbDirectCapture?: (mode: AnnotationScreenshotMode) => Promise<string>;
    __odbDirectComplete?: (message: DirectCompletionMessage) => void;
  };
  if (w.__odbDirectShim) return;
  const listeners = new Set<(...args: unknown[]) => unknown>();

  const runtime = {
    onMessage: {
      addListener: (listener: (...args: unknown[]) => unknown) => {
        listeners.add(listener);
      }
    },
    sendMessage: (message: { type?: string; mode?: AnnotationScreenshotMode }, callback?: (response: Record<string, unknown>) => void) => {
      const type = message?.type ?? "";
      if (type === "annotation:capture") {
        const capture = w.__odbDirectCapture;
        if (!capture) {
          callback?.({ ok: false, error: "Capture binding unavailable" });
          return;
        }
        Promise.resolve(capture(message.mode ?? "visible"))
          .then((dataUrl) => {
            callback?.({ ok: true, dataUrl });
          })
          .catch((error) => {
            const detail = error instanceof Error ? error.message : "Capture failed";
            callback?.({ ok: false, error: detail });
          });
        return;
      }
      if (type === "annotation:complete" || type === "annotation:error" || type === "annotation:cancelled") {
        try {
          w.__odbDirectComplete?.(message as DirectCompletionMessage);
        } catch {
          // Ignore completion routing errors.
        }
        callback?.({ ok: true });
        return;
      }

      let responseSent = false;
      const sendResponse = (response: Record<string, unknown>) => {
        if (responseSent) return;
        responseSent = true;
        callback?.(response);
      };

      for (const listener of listeners) {
        try {
          listener(message, undefined, sendResponse);
        } catch {
          // ignore listener errors
        }
      }

      if (!responseSent) {
        callback?.({ ok: true });
      }
    }
  };

  const chromeRoot = w.chrome ?? {};
  chromeRoot.runtime = runtime;
  w.chrome = chromeRoot;

  w.__odbDirectRuntime = {
    dispatch: (message: Record<string, unknown>) => {
      let response: unknown = null;
      const sendResponse = (value: unknown) => {
        response = value;
      };
      for (const listener of listeners) {
        try {
          listener(message, undefined, sendResponse);
        } catch {
          // ignore listener errors
        }
      }
      return response;
    }
  };

  w.__odbDirectShim = true;
}

async function injectAssets(page: Page, assets: DirectAnnotateAssets): Promise<void> {
  await page.addStyleTag({ path: assets.stylePath });
  await page.addScriptTag({ path: assets.scriptPath });
}

async function ensureAnnotationReady(page: Page): Promise<void> {
  const response = await dispatchMessage(page, { type: "annotation:ping" });
  if (!response || typeof response !== "object" || (response as { ok?: boolean }).ok !== true) {
    throw new Error("Annotation content script unavailable");
  }
}

async function dispatchMessage(page: Page, message: Record<string, unknown>): Promise<unknown> {
  return await page.evaluate((payload) => {
    const runtime = (window as unknown as { __odbDirectRuntime?: DirectDispatchRuntime }).__odbDirectRuntime;
    if (!runtime?.dispatch) {
      throw new Error("Direct annotation runtime missing");
    }
    return runtime.dispatch(payload);
  }, message);
}

function mapCompletionToResponse(message: DirectCompletionMessage, requestId: string): AnnotationResponse {
  if (message.type === "annotation:complete") {
    return {
      version: 1,
      requestId,
      status: "ok",
      payload: message.payload
    };
  }
  if (message.type === "annotation:cancelled") {
    return {
      version: 1,
      requestId,
      status: "cancelled",
      error: { code: "cancelled", message: "Annotation cancelled." }
    };
  }
  return {
    version: 1,
    requestId,
    status: "error",
    error: {
      code: message.error?.code ?? "unknown",
      message: message.error?.message ?? "Annotation failed."
    }
  };
}

function isBindingExistsError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes("already registered") || message.toLowerCase().includes("has been already exposed");
}
