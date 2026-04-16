import { spawnSync } from "node:child_process";
import type { ParsedArgs } from "../args";
import {
  getCurrentDaemonFingerprint,
  readDaemonMetadata,
  startDaemon
} from "../daemon";
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

type ServeProcessSnapshot = {
  pid: number;
  uid: number | null;
  command: string;
};

let daemonHandle: DaemonHandle | null = null;
const PS_MAX_BUFFER = 8 * 1024 * 1024;
const SERVE_COMMAND_PATTERN = /(?:^|\s)(?:\S*[\\/])?(?:opendevbrowser|dist[\\/]+cli[\\/]+index\.js)(?=\s|$).*?\bserve\b/;
const SERVE_STOP_PATTERN = /(?:^|\s)--stop(?:\s|$)/;
const CURRENT_UID = typeof process.getuid === "function" ? process.getuid() : null;
const CURRENT_EXECUTABLE = process.execPath;

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

function isPositivePid(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function rememberStalePid(staleDaemonPids: Set<number>, pid: unknown): void {
  if (isPositivePid(pid)) {
    staleDaemonPids.add(pid);
  }
}

async function stopDaemonOnPort(port: number, token: string): Promise<boolean> {
  try {
    const response = await fetchWithTimeout(`http://127.0.0.1:${port}/stop`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` }
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function stopStaleDaemon(
  port: number,
  daemon: { token: string; status: DaemonStatusPayload },
  staleDaemonPids: Set<number>
): Promise<void> {
  rememberStalePid(staleDaemonPids, daemon.status.pid);
  const stopped = await stopDaemonOnPort(port, daemon.token);
  if (!stopped && isPositivePid(daemon.status.pid)) {
    terminateProcess(daemon.status.pid);
  }
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

function parseServeProcessSnapshot(line: string): ServeProcessSnapshot | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const match = trimmed.match(/^(\d+)(?:\s+(\d+))?\s+(.*)$/);
  if (!match) {
    return null;
  }
  const pid = Number.parseInt(match[1] ?? "", 10);
  if (!Number.isInteger(pid) || pid <= 0) {
    return null;
  }
  const rawUid = match[2];
  const parsedUid = typeof rawUid === "string" && rawUid.length > 0
    ? Number.parseInt(rawUid, 10)
    : null;
  const command = (match[3] ?? "").trim();
  if (command.length === 0) {
    return null;
  }
  return {
    pid,
    uid: typeof parsedUid === "number" && Number.isInteger(parsedUid) && parsedUid >= 0 ? parsedUid : null,
    command
  };
}

function listServeProcessSnapshots(): ServeProcessSnapshot[] {
  const result = spawnSync("ps", ["-axww", "-o", "pid=,uid=,command="], {
    encoding: "utf-8",
    maxBuffer: PS_MAX_BUFFER
  });
  if ((result.status ?? 1) !== 0) {
    return [];
  }
  return String(result.stdout ?? "")
    .split("\n")
    .map((line) => parseServeProcessSnapshot(line))
    .filter((snapshot): snapshot is ServeProcessSnapshot => snapshot !== null);
}

function isCurrentExecutableServeProcess(snapshot: ServeProcessSnapshot): boolean {
  if (CURRENT_UID === null || snapshot.uid === null || snapshot.uid !== CURRENT_UID) {
    return false;
  }
  if (!snapshot.command.includes(CURRENT_EXECUTABLE)) {
    return false;
  }
  if (!SERVE_COMMAND_PATTERN.test(snapshot.command)) {
    return false;
  }
  return !SERVE_STOP_PATTERN.test(snapshot.command);
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

function cleanupCompetingServeProcesses(keepPid?: number): number[] {
  const candidates = listServeProcessSnapshots().filter((snapshot) => {
    if (!isCurrentExecutableServeProcess(snapshot)) {
      return false;
    }
    if (snapshot.pid === process.pid || snapshot.pid === process.ppid) {
      return false;
    }
    if (Number.isInteger(keepPid) && snapshot.pid === keepPid) {
      return false;
    }
    return true;
  });
  if (candidates.length === 0) {
    return [];
  }

  const clearedPids: number[] = [];
  for (const snapshot of candidates) {
    if (terminateProcess(snapshot.pid)) {
      clearedPids.push(snapshot.pid);
    }
  }

  return clearedPids;
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
  const currentFingerprint = getCurrentDaemonFingerprint();

  const existingDaemon = await resolveExistingDaemon(requestedPort, tokenCandidates);
  const staleDaemonPids = new Set(cleanupCompetingServeProcesses(existingDaemon?.status.pid));
  const staleCleared = () => staleDaemonPids.size;
  let replacedStaleFingerprint = false;

  if (existingDaemon) {
    const fingerprintMatches = existingDaemon.status.fingerprint === currentFingerprint;
    if (fingerprintMatches) {
      const relayPort = existingDaemon.status.relay.port ?? config.relayPort;
      const clearedCount = staleCleared();
      const staleNote = clearedCount > 0 ? `\nCleared ${clearedCount} stale daemon process${clearedCount === 1 ? "" : "es"}.` : "";
      return {
        success: true,
        message: `Daemon already running on 127.0.0.1:${requestedPort} (pid=${existingDaemon.status.pid}, relay ${relayPort}).${staleNote}`,
        data: {
          port: requestedPort,
          pid: existingDaemon.status.pid,
          relayPort,
          alreadyRunning: true,
          staleDaemonsCleared: clearedCount,
          relay: existingDaemon.status.relay
        },
        exitCode: null
      };
    }
    await stopStaleDaemon(requestedPort, existingDaemon, staleDaemonPids);
    replacedStaleFingerprint = true;
  }

  let nativeStatus = getNativeStatusSnapshot();
  let nativeMessage: string | null = null;
  if (!nativeStatus.installed || nativeStatus.mismatch) {
    const discovered = discoverExtensionId();
    const extensionId = nativeStatus.expectedExtensionId ?? config.nativeExtensionId ?? discovered.extensionId ?? null;
    const usedDiscovery = nativeStatus.expectedExtensionSource !== "config" && Boolean(extensionId);
    const previousExtensionId = nativeStatus.extensionId;
    if (extensionId) {
      const installResult = installNativeHost(extensionId);
      if (installResult.success) {
        const suffix = usedDiscovery && discovered.matchedBy ? ` (auto-detected by ${discovered.matchedBy})` : "";
        nativeMessage = nativeStatus.mismatch && previousExtensionId
          ? `Native host reinstalled for extension ${extensionId} (replacing stale ${previousExtensionId}).${suffix}`
          : `${installResult.message ?? "Native host installed."}${suffix}`;
        nativeStatus = getNativeStatusSnapshot();
      } else {
        nativeMessage = nativeStatus.mismatch
          ? `Native host reinstall skipped: ${installResult.message ?? "unknown error"}`
          : `Native host install skipped: ${installResult.message ?? "unknown error"}`;
      }
    } else if (nativeStatus.mismatch && previousExtensionId) {
      nativeMessage = `Native host targets stale extension ${previousExtensionId}, but no current extension id could be resolved for reinstall.`;
    } else {
      nativeMessage = "Native host not installed. Set nativeExtensionId in opendevbrowser.jsonc to auto-install.";
    }
  }

  let handle: Awaited<ReturnType<typeof startDaemon>> | null = null;
  let startError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      handle = await startDaemon({
        port: serveArgs.port,
        token: serveArgs.token,
        config
      });
      startError = null;
      break;
    } catch (error) {
      startError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("EADDRINUSE") && !message.includes("in use")) {
        break;
      }
      const runningDaemon = await resolveExistingDaemon(requestedPort, tokenCandidates);
      if (runningDaemon) {
        const fingerprintMatches = runningDaemon.status.fingerprint === currentFingerprint;
        if (fingerprintMatches) {
          const relayPort = runningDaemon.status.relay.port ?? config.relayPort;
          const clearedCount = staleCleared();
          const staleNote = clearedCount > 0 ? `\nCleared ${clearedCount} stale daemon process${clearedCount === 1 ? "" : "es"}.` : "";
          return {
            success: true,
            message: `Daemon already running on 127.0.0.1:${requestedPort} (pid=${runningDaemon.status.pid}, relay ${relayPort}).${staleNote}`,
            data: {
              port: requestedPort,
              pid: runningDaemon.status.pid,
              relayPort,
              alreadyRunning: true,
              staleDaemonsCleared: clearedCount,
              relay: runningDaemon.status.relay
            },
            exitCode: null
          };
        }
        await stopStaleDaemon(requestedPort, runningDaemon, staleDaemonPids);
        replacedStaleFingerprint = true;
        if (attempt === 0) {
          continue;
        }
      }
      if (attempt === 0) {
        let clearedNewPid = false;
        for (const pid of cleanupCompetingServeProcesses()) {
          const previousSize = staleDaemonPids.size;
          staleDaemonPids.add(pid);
          if (staleDaemonPids.size > previousSize) {
            clearedNewPid = true;
          }
        }
        if (clearedNewPid) {
          continue;
        }
      }
      break;
    }
  }

  if (!handle) {
    const message = startError instanceof Error ? startError.message : String(startError);
    if (message.includes("EADDRINUSE") || message.includes("in use")) {
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
  const clearedCount = staleCleared();
  const staleNote = clearedCount > 0 ? `\nCleared ${clearedCount} stale daemon process${clearedCount === 1 ? "" : "es"}.` : "";
  const fingerprintNote = replacedStaleFingerprint ? "\nReplaced stale daemon fingerprint." : "";
  const message = nativeMessage
    ? `${baseMessage}\n${nativeMessage}${fingerprintNote}${staleNote}`
    : `${baseMessage}${fingerprintNote}${staleNote}`;

  return {
    success: true,
    message,
    data: { port: state.port, pid: state.pid, relayPort: state.relayPort, native: nativeStatus, staleDaemonsCleared: clearedCount },
    exitCode: null
  };
}
