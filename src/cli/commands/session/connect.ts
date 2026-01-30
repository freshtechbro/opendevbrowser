import type { ParsedArgs } from "../../args";
import { callDaemon } from "../../client";
import { createUsageError } from "../../errors";
import { parseNumberFlag } from "../../utils/parse";

type ConnectArgs = {
  wsEndpoint?: string;
  host?: string;
  port?: number;
};

function parseConnectArgs(rawArgs: string[]): ConnectArgs {
  const parsed: ConnectArgs = {};
  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    if (arg === "--ws-endpoint") {
      const value = rawArgs[i + 1];
      if (!value) throw createUsageError("Missing value for --ws-endpoint");
      parsed.wsEndpoint = value;
      i += 1;
      continue;
    }
    if (arg?.startsWith("--ws-endpoint=")) {
      parsed.wsEndpoint = arg.split("=", 2)[1];
      continue;
    }
    if (arg === "--host") {
      const value = rawArgs[i + 1];
      if (!value) throw createUsageError("Missing value for --host");
      parsed.host = value;
      i += 1;
      continue;
    }
    if (arg?.startsWith("--host=")) {
      parsed.host = arg.split("=", 2)[1];
      continue;
    }
    if (arg === "--cdp-port") {
      const value = rawArgs[i + 1];
      if (!value) throw createUsageError("Missing value for --cdp-port");
      parsed.port = parseNumberFlag(value, "--cdp-port", { min: 1, max: 65535 });
      i += 1;
      continue;
    }
    if (arg?.startsWith("--cdp-port=")) {
      parsed.port = parseNumberFlag(arg.split("=", 2)[1], "--cdp-port", { min: 1, max: 65535 });
      continue;
    }
  }
  return parsed;
}

export async function runSessionConnect(args: ParsedArgs) {
  const connectArgs = parseConnectArgs(args.rawArgs);
  const result = await callDaemon("session.connect", connectArgs) as { sessionId: string };
  return {
    success: true,
    message: `Session connected: ${result.sessionId}`,
    data: result
  };
}
