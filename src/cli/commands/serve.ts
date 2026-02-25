import { spawnSync } from "node:child_process";
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
const PS_MAX_BUFFER = 8 * 1024 * 1024;

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

function listServeProcessPids(): number[] {
  const result = spawnSync("ps", ["-ax", "-o", "pid=,command="], {
    encoding: "utf-8",
    maxBuffer: PS_MAX_BUFFER
  });
  if ((result.status ?? 1) !== 0) {
    return [];
  }
  const servePattern = /\b(opendevbrowser|dist\/cli\/index\.js)\b.*\bserve\b/;
  const lines = String(result.stdout ?? "").split(/\r?\n/);
  const pids = new Set<number>();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^(\d+)\s+(.+)$/);
    if (!match) continue;
    const pidText = match[1];
    if (!pidText) continue;
    const pid = Number.parseInt(pidText, 10);
    const command = match[2] ?? "";
    if (!Number.isInteger(pid) || pid <= 0) continue;
    if (pid === process.pid || pid === process.ppid) continue;
    if (!servePattern.test(command)) continue;
    pids.add(pid);
  }
  return [...pids];
}

function terminateProcess(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid || pid === process.ppid) {
    return false;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return false;
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // process may have exited after SIGTERM
  }
  return true;
}

function cleanupStaleServeProcesses(keepPid?: number): number {
  const candidates = listServeProcessPids();
  let cleaned = 0;
  for (const pid of candidates) {
    if (Number.isInteger(keepPid) && pid === keepPid) continue;
    if (terminateProcess(pid)) {
      cleaned += 1;
    }
  }
  return cleaned;
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
  const staleCleared = cleanupStaleServeProcesses(existingDaemon?.status.pid);
  if (existingDaemon) {
    const relayPort = existingDaemon.status.relay.port ?? config.relayPort;
    const staleNote = staleCleared > 0 ? ` Cleared ${staleCleared} stale daemon process${staleCleared === 1 ? "" : "es"}.` : "";
    return {
      success: true,
      message: `Daemon already running on 127.0.0.1:${requestedPort} (pid=${existingDaemon.status.pid}, relay ${relayPort}).${staleNote}`,
      data: {
        port: requestedPort,
        pid: existingDaemon.status.pid,
        relayPort,
        alreadyRunning: true,
        staleDaemonsCleared: staleCleared,
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
  const staleNote = staleCleared > 0 ? `\nCleared ${staleCleared} stale daemon process${staleCleared === 1 ? "" : "es"}.` : "";
  const message = nativeMessage ? `${baseMessage}\n${nativeMessage}${staleNote}` : `${baseMessage}${staleNote}`;

  return {
    success: true,
    message,
    data: { port: state.port, pid: state.pid, relayPort: state.relayPort, native: nativeStatus, staleDaemonsCleared: staleCleared },
    exitCode: null
  };
}
