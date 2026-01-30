import type { ParsedArgs } from "../args";
import { startDaemon, readDaemonMetadata } from "../daemon";
import { createUsageError, EXIT_DISCONNECTED, EXIT_EXECUTION } from "../errors";
import { parseNumberFlag } from "../utils/parse";
import { fetchWithTimeout } from "../utils/http";

type ServeArgs = {
  port?: number;
  token?: string;
  stop: boolean;
};

type DaemonHandle = {
  stop: () => Promise<void>;
};

let daemonHandle: DaemonHandle | null = null;

function parseServeArgs(rawArgs: string[]): ServeArgs {
  const parsed: ServeArgs = { stop: false };
  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    if (arg === "--stop") {
      parsed.stop = true;
      continue;
    }
    if (arg === "--port") {
      const value = rawArgs[i + 1];
      if (!value) {
        throw createUsageError("Missing value for --port");
      }
      parsed.port = parseNumberFlag(value, "--port", { min: 1, max: 65535 });
      i += 1;
      continue;
    }
    if (arg?.startsWith("--port=")) {
      parsed.port = parseNumberFlag(arg.split("=", 2)[1], "--port", { min: 1, max: 65535 });
      continue;
    }
    if (arg === "--token") {
      const value = rawArgs[i + 1];
      if (!value) {
        throw createUsageError("Missing value for --token");
      }
      parsed.token = value;
      i += 1;
      continue;
    }
    if (arg?.startsWith("--token=")) {
      parsed.token = arg.split("=", 2)[1];
      continue;
    }
  }
  return parsed;
}

export async function runServe(args: ParsedArgs) {
  const serveArgs = parseServeArgs(args.rawArgs);

  if (serveArgs.stop) {
    const metadata = readDaemonMetadata();
    if (!metadata) {
      if (daemonHandle) {
        await daemonHandle.stop();
        daemonHandle = null;
        return { success: true, message: "Daemon stopped." };
      }
      return { success: false, message: "Daemon not running.", exitCode: EXIT_DISCONNECTED };
    }

    try {
      const response = await fetchWithTimeout(`http://127.0.0.1:${metadata.port}/stop`, {
        method: "POST",
        headers: { Authorization: `Bearer ${metadata.token}` }
      });
      if (!response.ok) {
        throw new Error(`Stop failed (${response.status})`);
      }
      return { success: true, message: "Daemon stopped." };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, message: `Failed to stop daemon: ${message}`, exitCode: EXIT_EXECUTION };
    }
  }

  const handle = await startDaemon({
    port: serveArgs.port,
    token: serveArgs.token
  });
  daemonHandle = handle;
  const { state } = handle;

  return {
    success: true,
    message: `Daemon running on 127.0.0.1:${state.port} (relay ${state.relayPort})`,
    data: { port: state.port, pid: state.pid, relayPort: state.relayPort },
    exitCode: null
  };
}
