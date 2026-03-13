import { readFileSync } from "fs";
import type { ParsedArgs } from "../args";
import { DaemonClient } from "../daemon-client";
import { createUsageError } from "../errors";
import { writeOutput } from "../output";
import { parseNumberFlag } from "../utils/parse";

type CanvasArgs = {
  command?: string;
  params?: string;
  paramsFile?: string;
  timeoutMs?: number;
};

const DEFAULT_FEEDBACK_STREAM_TIMEOUT_MS = 30000;
const MIN_FEEDBACK_STREAM_POLL_MS = 250;
const MAX_FEEDBACK_STREAM_POLL_MS = 1000;

type FeedbackItem = Record<string, unknown>;

type FeedbackPollResult = {
  items: FeedbackItem[];
  nextCursor: string | null;
  retention?: {
    activeTargetIds?: string[];
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const asString = (value: unknown): string | null => {
  return typeof value === "string" && value.length > 0 ? value : null;
};

const asNumber = (value: unknown): number | null => {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

const asRecordArray = (value: unknown): FeedbackItem[] => {
  return Array.isArray(value) ? value.filter(isRecord) : [];
};

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const toFeedbackPollResult = (value: unknown): FeedbackPollResult => {
  if (!isRecord(value)) {
    return { items: [], nextCursor: null };
  }
  const retention = isRecord(value.retention)
    ? {
      activeTargetIds: Array.isArray(value.retention.activeTargetIds)
        ? value.retention.activeTargetIds.filter((entry): entry is string => typeof entry === "string")
        : undefined
    }
    : undefined;
  return {
    items: asRecordArray(value.items),
    nextCursor: asString(value.nextCursor),
    retention
  };
};

async function streamFeedbackViaPolling(
  client: DaemonClient,
  args: ParsedArgs,
  canvasArgs: CanvasArgs,
  params: Record<string, unknown>,
  initial: Record<string, unknown>
): Promise<void> {
  const outputOptions = { format: args.outputFormat, quiet: args.quiet };
  writeOutput({
    success: true,
    message: `Canvas executed: ${canvasArgs.command}`,
    data: {
      command: canvasArgs.command,
      result: initial
    }
  }, outputOptions);

  const heartbeatMs = Math.max(asNumber(initial.heartbeatMs) ?? 15000, 1000);
  const pollIntervalMs = Math.min(
    MAX_FEEDBACK_STREAM_POLL_MS,
    Math.max(MIN_FEEDBACK_STREAM_POLL_MS, Math.floor(heartbeatMs / 3))
  );
  const streamTimeoutMs = canvasArgs.timeoutMs ?? DEFAULT_FEEDBACK_STREAM_TIMEOUT_MS;
  const deadline = Date.now() + streamTimeoutMs;
  let cursor = asString(initial.cursor);
  let lastHeartbeatAt = Date.now();

  while (Date.now() < deadline) {
    await sleep(pollIntervalMs);
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      break;
    }
    const polled = toFeedbackPollResult(await client.call(
      "canvas.execute",
      {
        command: "canvas.feedback.poll",
        params: {
          ...params,
          afterCursor: cursor
        }
      },
      { timeoutMs: remainingMs }
    ));
    if (polled.items.length > 0) {
      for (const item of polled.items) {
        const itemCursor = asString(item.cursor);
        if (itemCursor) {
          cursor = itemCursor;
        }
        writeOutput({
          success: true,
          message: `Canvas feedback: ${canvasArgs.command}`,
          data: {
            command: canvasArgs.command,
            streamEvent: {
              eventType: "feedback.item",
              item,
              cursor: cursor ?? null
            }
          }
        }, outputOptions);
      }
      lastHeartbeatAt = Date.now();
      continue;
    }
    if (polled.nextCursor) {
      cursor = polled.nextCursor;
    }
    if (Date.now() - lastHeartbeatAt >= heartbeatMs) {
      writeOutput({
        success: true,
        message: `Canvas feedback: ${canvasArgs.command}`,
        data: {
          command: canvasArgs.command,
          streamEvent: {
            eventType: "feedback.heartbeat",
            cursor: cursor ?? null,
            ts: new Date().toISOString(),
            activeTargetIds: polled.retention?.activeTargetIds ?? []
          }
        }
      }, outputOptions);
      lastHeartbeatAt = Date.now();
    }
  }

  writeOutput({
    success: true,
    message: `Canvas feedback: ${canvasArgs.command}`,
    data: {
      command: canvasArgs.command,
      streamEvent: {
        eventType: "feedback.complete",
        cursor: cursor ?? null,
        completeReason: "timeout"
      }
    }
  }, outputOptions);
}

const requireValue = (value: string | undefined, flag: string): string => {
  if (!value) throw createUsageError(`Missing value for ${flag}`);
  return value;
};

const parseJsonObject = (raw: string, source: string): Record<string, unknown> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid JSON";
    throw createUsageError(`Invalid JSON from ${source}: ${message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw createUsageError(`Invalid JSON from ${source}: expected object`);
  }
  return parsed as Record<string, unknown>;
};

export const parseCanvasArgs = (rawArgs: string[]): CanvasArgs => {
  const parsed: CanvasArgs = {};
  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    if (arg === "--command") {
      parsed.command = requireValue(rawArgs[i + 1], "--command");
      i += 1;
      continue;
    }
    if (arg?.startsWith("--command=")) {
      parsed.command = requireValue(arg.split("=", 2)[1], "--command");
      continue;
    }
    if (arg === "--params") {
      parsed.params = requireValue(rawArgs[i + 1], "--params");
      i += 1;
      continue;
    }
    if (arg?.startsWith("--params=")) {
      parsed.params = requireValue(arg.split("=", 2)[1], "--params");
      continue;
    }
    if (arg === "--params-file") {
      parsed.paramsFile = requireValue(rawArgs[i + 1], "--params-file");
      i += 1;
      continue;
    }
    if (arg?.startsWith("--params-file=")) {
      parsed.paramsFile = requireValue(arg.split("=", 2)[1], "--params-file");
      continue;
    }
    if (arg === "--timeout-ms") {
      parsed.timeoutMs = parseNumberFlag(requireValue(rawArgs[i + 1], "--timeout-ms"), "--timeout-ms", { min: 1 });
      i += 1;
      continue;
    }
    if (arg?.startsWith("--timeout-ms=")) {
      parsed.timeoutMs = parseNumberFlag(requireValue(arg.split("=", 2)[1], "--timeout-ms"), "--timeout-ms", { min: 1 });
    }
  }
  return parsed;
};

const resolveCanvasParams = (canvasArgs: CanvasArgs): Record<string, unknown> => {
  const hasParams = typeof canvasArgs.params === "string";
  const hasParamsFile = typeof canvasArgs.paramsFile === "string";
  if (Number(hasParams) + Number(hasParamsFile) > 1) {
    throw createUsageError("Provide only one params source: --params or --params-file.");
  }
  if (hasParams) {
    return parseJsonObject(canvasArgs.params ?? "", "--params");
  }
  if (hasParamsFile) {
    let raw = "";
    try {
      raw = readFileSync(canvasArgs.paramsFile ?? "", "utf8");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to read file";
      throw createUsageError(`Invalid --params-file: ${message}`);
    }
    if (!raw.trim()) {
      throw createUsageError("Invalid JSON from --params-file: empty input");
    }
    return parseJsonObject(raw, "--params-file");
  }
  return {};
};

export async function runCanvas(args: ParsedArgs) {
  const canvasArgs = parseCanvasArgs(args.rawArgs);
  if (!canvasArgs.command) {
    throw createUsageError("Usage: opendevbrowser canvas --command <canvas.command> [--params <json> | --params-file <path>]");
  }
  if (!canvasArgs.command.startsWith("canvas.")) {
    throw createUsageError("Canvas command names must start with 'canvas.'.");
  }

  const client = new DaemonClient({ autoRenew: true });
  try {
    const params = resolveCanvasParams(canvasArgs);
    const result = await client.call<unknown>(
      "canvas.execute",
      {
        command: canvasArgs.command,
        params
      },
      { timeoutMs: canvasArgs.timeoutMs }
    );
    if (
      canvasArgs.command === "canvas.feedback.subscribe"
      && args.outputFormat === "stream-json"
      && isRecord(result)
    ) {
      await streamFeedbackViaPolling(client, args, canvasArgs, params, result);
      return {
        success: true,
        message: `Canvas executed: ${canvasArgs.command}`,
        data: {
          suppressOutput: true
        }
      };
    }
    if (args.outputFormat === "text") {
      const output = typeof result === "string" ? result : JSON.stringify(result, null, 2);
      return { success: true, message: output };
    }
    return {
      success: true,
      message: `Canvas executed: ${canvasArgs.command}`,
      data: {
        command: canvasArgs.command,
        result
      }
    };
  } finally {
    await client.releaseBinding().catch(() => {});
  }
}

export const __test__ = {
  parseCanvasArgs,
  parseJsonObject,
  resolveCanvasParams,
  toFeedbackPollResult
};
