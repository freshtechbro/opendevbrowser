import type { ParsedArgs } from "../args";
import { createUsageError } from "../errors";
import { parseNumberFlag } from "../utils/parse";
import { DaemonClient } from "../daemon-client";
import { buildAnnotateResult } from "../../annotate/output";
import type { AnnotationResponse, AnnotationTransport } from "../../relay/protocol";

type AnnotateArgs = {
  sessionId?: string;
  url?: string;
  screenshotMode?: "visible" | "full" | "none";
  debug?: boolean;
  context?: string;
  timeoutMs?: number;
  transport?: AnnotationTransport;
  targetId?: string;
  tabId?: number;
};

const requireValue = (value: string | undefined, flag: string): string => {
  if (!value) throw createUsageError(`Missing value for ${flag}`);
  return value;
};

const requireScreenshotMode = (value: string): "visible" | "full" | "none" => {
  if (value === "visible" || value === "full" || value === "none") {
    return value;
  }
  throw createUsageError(`Invalid --screenshot-mode: ${value}`);
};

const requireTransport = (value: string): AnnotationTransport => {
  if (value === "auto" || value === "direct" || value === "relay") {
    return value;
  }
  throw createUsageError(`Invalid --transport: ${value}`);
};

export const parseAnnotateArgs = (rawArgs: string[]): AnnotateArgs => {
  const parsed: AnnotateArgs = {};
  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    if (arg === "--session-id") {
      const value = requireValue(rawArgs[i + 1], "--session-id");
      parsed.sessionId = value;
      i += 1;
      continue;
    }
    if (arg?.startsWith("--session-id=")) {
      const value = requireValue(arg.split("=", 2)[1], "--session-id");
      parsed.sessionId = value;
      continue;
    }
    if (arg === "--url") {
      const value = requireValue(rawArgs[i + 1], "--url");
      parsed.url = value;
      i += 1;
      continue;
    }
    if (arg?.startsWith("--url=")) {
      const value = requireValue(arg.split("=", 2)[1], "--url");
      parsed.url = value;
      continue;
    }
    if (arg === "--screenshot-mode") {
      const value = requireValue(rawArgs[i + 1], "--screenshot-mode");
      parsed.screenshotMode = requireScreenshotMode(value);
      i += 1;
      continue;
    }
    if (arg?.startsWith("--screenshot-mode=")) {
      const value = requireValue(arg.split("=", 2)[1], "--screenshot-mode");
      parsed.screenshotMode = requireScreenshotMode(value);
      continue;
    }
    if (arg === "--transport") {
      const value = requireValue(rawArgs[i + 1], "--transport");
      parsed.transport = requireTransport(value);
      i += 1;
      continue;
    }
    if (arg?.startsWith("--transport=")) {
      const value = requireValue(arg.split("=", 2)[1], "--transport");
      parsed.transport = requireTransport(value);
      continue;
    }
    if (arg === "--target-id") {
      const value = requireValue(rawArgs[i + 1], "--target-id");
      parsed.targetId = value;
      i += 1;
      continue;
    }
    if (arg?.startsWith("--target-id=")) {
      const value = requireValue(arg.split("=", 2)[1], "--target-id");
      parsed.targetId = value;
      continue;
    }
    if (arg === "--tab-id") {
      const value = requireValue(rawArgs[i + 1], "--tab-id");
      parsed.tabId = parseNumberFlag(value, "--tab-id", { min: 1 });
      i += 1;
      continue;
    }
    if (arg?.startsWith("--tab-id=")) {
      const value = requireValue(arg.split("=", 2)[1], "--tab-id");
      parsed.tabId = parseNumberFlag(value, "--tab-id", { min: 1 });
      continue;
    }
    if (arg === "--debug") {
      parsed.debug = true;
      continue;
    }
    if (arg === "--context") {
      const value = requireValue(rawArgs[i + 1], "--context");
      parsed.context = value;
      i += 1;
      continue;
    }
    if (arg?.startsWith("--context=")) {
      const value = requireValue(arg.split("=", 2)[1], "--context");
      parsed.context = value;
      continue;
    }
    if (arg === "--timeout-ms") {
      const value = requireValue(rawArgs[i + 1], "--timeout-ms");
      parsed.timeoutMs = parseNumberFlag(value, "--timeout-ms", { min: 1 });
      i += 1;
      continue;
    }
    if (arg?.startsWith("--timeout-ms=")) {
      const value = requireValue(arg.split("=", 2)[1], "--timeout-ms");
      parsed.timeoutMs = parseNumberFlag(value, "--timeout-ms", { min: 1 });
      continue;
    }
  }
  return parsed;
};

export async function runAnnotate(args: ParsedArgs) {
  const { sessionId, url, screenshotMode, debug, context, timeoutMs, transport, targetId, tabId } = parseAnnotateArgs(args.rawArgs);
  if (!sessionId) throw createUsageError("Missing --session-id");

  const client = new DaemonClient({ autoRenew: true });
  const callTimeoutMs = typeof timeoutMs === "number" ? timeoutMs + 10_000 : undefined;

  try {
    const response = await client.call<AnnotationResponse>("annotate", {
      sessionId,
      transport,
      targetId,
      tabId,
      url,
      screenshotMode,
      debug,
      context,
      timeoutMs
    }, { timeoutMs: callTimeoutMs });

    if (response.status !== "ok" || !response.payload) {
      const message = response.error?.message ?? "Annotation failed.";
      throw new Error(message);
    }

    const { message, details, screenshots } = await buildAnnotateResult(response.payload);
    return { success: true, message, data: { details, screenshots } };
  } finally {
    await client.releaseBinding().catch(() => {});
  }
}
