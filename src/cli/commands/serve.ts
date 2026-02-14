import type { ParsedArgs } from "../args";
import { startDaemon, readDaemonMetadata } from "../daemon";
import { loadGlobalConfig } from "../../config";
import { createUsageError, EXIT_DISCONNECTED, EXIT_EXECUTION } from "../errors";
import { parseNumberFlag } from "../utils/parse";
import { fetchWithTimeout } from "../utils/http";
import { discoverExtensionId, getNativeStatusSnapshot, installNativeHost } from "./native";
import type { DaemonStatusPayload } from "../daemon-status";
import { fetchDaemonStatus } from "../daemon-status";

type ServeArgs = {
  port?: number;
  token?: string;
  stop: boolean;
};

type DaemonHandle = {
  stop: () => Promise<void>;
};

let daemonHandle: DaemonHandle | null = null;

function resolveTokenCandidates(
  requestedToken: string | undefined,
  metadataToken: string | undefined,
  configToken: string | undefined
): string[] {
  return Array.from(new Set([requestedToken, metadataToken, configToken].filter((token): token is string => (
    typeof token === "string" && token.trim().length > 0
  ))));
}

async function resolveExistingDaemon(
  port: number,
  tokens: string[]
): Promise<{ token: string; status: DaemonStatusPayload } | null> {
  for (const token of tokens) {
    const status = await fetchDaemonStatus(port, token);
    if (status?.ok) {
      return { token, status };
    }
  }
  return null;
}

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
      const value = arg.split("=", 2)[1];
      if (!value) {
        throw createUsageError("Missing value for --port");
      }
      parsed.port = parseNumberFlag(value, "--port", { min: 1, max: 65535 });
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
      const value = arg.split("=", 2)[1];
      if (!value) {
        throw createUsageError("Missing value for --token");
      }
      parsed.token = value;
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

  const config = loadGlobalConfig();
  const requestedPort = serveArgs.port ?? config.daemonPort;
  const metadata = readDaemonMetadata();
  const metadataToken = metadata?.port === requestedPort ? metadata.token : undefined;
  const tokenCandidates = resolveTokenCandidates(serveArgs.token, metadataToken, config.daemonToken);

  const existingDaemon = await resolveExistingDaemon(requestedPort, tokenCandidates);
  if (existingDaemon) {
    const relayPort = existingDaemon.status.relay.port ?? config.relayPort;
    return {
      success: true,
      message: `Daemon already running on 127.0.0.1:${requestedPort} (pid=${existingDaemon.status.pid}, relay ${relayPort}).`,
      data: {
        port: requestedPort,
        pid: existingDaemon.status.pid,
        relayPort,
        alreadyRunning: true,
        relay: existingDaemon.status.relay
      },
      exitCode: null
    };
  }

  let nativeStatus = getNativeStatusSnapshot();
  let nativeMessage: string | null = null;
  if (!nativeStatus.installed) {
    const discovered = discoverExtensionId();
    const extensionId = config.nativeExtensionId ?? discovered.extensionId ?? null;
    const usedDiscovery = !config.nativeExtensionId && Boolean(discovered.extensionId);
    if (extensionId) {
      const installResult = installNativeHost(extensionId);
      if (installResult.success) {
        const suffix = usedDiscovery && discovered.matchedBy ? ` (auto-detected by ${discovered.matchedBy})` : "";
        nativeMessage = `${installResult.message ?? "Native host installed."}${suffix}`;
        nativeStatus = getNativeStatusSnapshot();
      } else {
        nativeMessage = `Native host install skipped: ${installResult.message ?? "unknown error"}`;
      }
    } else {
      nativeMessage = "Native host not installed. Set nativeExtensionId in opendevbrowser.jsonc to auto-install.";
    }
  }

  let handle: Awaited<ReturnType<typeof startDaemon>>;
  try {
    handle = await startDaemon({
      port: serveArgs.port,
      token: serveArgs.token,
      config
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("EADDRINUSE") || message.includes("in use")) {
      const runningDaemon = await resolveExistingDaemon(requestedPort, tokenCandidates);
      if (runningDaemon) {
        const relayPort = runningDaemon.status.relay.port ?? config.relayPort;
        return {
          success: true,
          message: `Daemon already running on 127.0.0.1:${requestedPort} (pid=${runningDaemon.status.pid}, relay ${relayPort}).`,
          data: {
            port: requestedPort,
            pid: runningDaemon.status.pid,
            relayPort,
            alreadyRunning: true,
            relay: runningDaemon.status.relay
          },
          exitCode: null
        };
      }
      return {
        success: false,
        message: `Daemon port ${requestedPort} is already in use by another process. If this is an existing daemon, run \`opendevbrowser status --daemon\` or \`opendevbrowser serve --stop\`.`,
        exitCode: EXIT_EXECUTION
      };
    }
    return {
      success: false,
      message: `Failed to start daemon: ${message}`,
      exitCode: EXIT_EXECUTION
    };
  }

  daemonHandle = handle;
  const { state } = handle;

  const baseMessage = `Daemon running on 127.0.0.1:${state.port} (relay ${state.relayPort})`;
  const message = nativeMessage ? `${baseMessage}\n${nativeMessage}` : baseMessage;

  return {
    success: true,
    message,
    data: { port: state.port, pid: state.pid, relayPort: state.relayPort, native: nativeStatus },
    exitCode: null
  };
}
