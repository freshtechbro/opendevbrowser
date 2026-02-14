import { readFileSync } from "fs";
import type { ParsedArgs } from "../args";
import { DaemonClient } from "../daemon-client";
import { createUsageError } from "../errors";
import { parseNumberFlag } from "../utils/parse";

type RpcArgs = {
  name?: string;
  params?: string;
  paramsFile?: string;
  timeoutMs?: number;
  unsafeInternal?: boolean;
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

export const parseRpcArgs = (rawArgs: string[]): RpcArgs => {
  const parsed: RpcArgs = {};
  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    if (arg === "--unsafe-internal") {
      parsed.unsafeInternal = true;
      continue;
    }
    if (arg === "--name") {
      parsed.name = requireValue(rawArgs[i + 1], "--name");
      i += 1;
      continue;
    }
    if (arg?.startsWith("--name=")) {
      parsed.name = requireValue(arg.split("=", 2)[1], "--name");
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

const resolveRpcParams = (rpcArgs: RpcArgs): Record<string, unknown> => {
  const hasParamsArg = typeof rpcArgs.params === "string";
  const hasParamsFile = typeof rpcArgs.paramsFile === "string";
  const inputCount = Number(hasParamsArg) + Number(hasParamsFile);

  if (inputCount > 1) {
    throw createUsageError("Provide only one params source: --params or --params-file.");
  }
  if (hasParamsArg) {
    return parseJsonObject(rpcArgs.params ?? "", "--params");
  }
  if (hasParamsFile) {
    let raw = "";
    try {
      raw = readFileSync(rpcArgs.paramsFile ?? "", "utf8");
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

export async function runRpc(args: ParsedArgs) {
  const rpcArgs = parseRpcArgs(args.rawArgs);
  if (!rpcArgs.unsafeInternal) {
    throw createUsageError(
      "Missing --unsafe-internal. rpc is a power-user command that executes internal daemon commands and can mutate session state."
    );
  }
  if (!rpcArgs.name) {
    throw createUsageError("Missing --name");
  }

  const params = resolveRpcParams(rpcArgs);
  const client = new DaemonClient({ autoRenew: true });
  try {
    const result = await client.call<unknown>(rpcArgs.name, params, { timeoutMs: rpcArgs.timeoutMs });
    if (args.outputFormat === "text") {
      const output = typeof result === "string" ? result : JSON.stringify(result, null, 2);
      return { success: true, message: output };
    }
    return {
      success: true,
      message: `RPC executed: ${rpcArgs.name}`,
      data: {
        name: rpcArgs.name,
        result
      }
    };
  } finally {
    await client.releaseBinding().catch(() => {});
  }
}

export const __test__ = {
  parseJsonObject,
  parseRpcArgs,
  resolveRpcParams
};
