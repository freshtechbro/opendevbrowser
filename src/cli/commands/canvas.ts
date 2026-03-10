import { readFileSync } from "fs";
import type { ParsedArgs } from "../args";
import { DaemonClient } from "../daemon-client";
import { createUsageError } from "../errors";
import { parseNumberFlag } from "../utils/parse";

type CanvasArgs = {
  command?: string;
  params?: string;
  paramsFile?: string;
  timeoutMs?: number;
};

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
    const result = await client.call<unknown>(
      "canvas.execute",
      {
        command: canvasArgs.command,
        params: resolveCanvasParams(canvasArgs)
      },
      { timeoutMs: canvasArgs.timeoutMs }
    );
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
  resolveCanvasParams
};
