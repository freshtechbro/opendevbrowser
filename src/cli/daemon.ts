import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { createHash, timingSafeEqual } from "crypto";
import { mkdirSync, readFileSync, writeFileSync, unlinkSync, existsSync } from "fs";
import { homedir } from "os";
import { basename, dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { generateSecureToken } from "../utils/crypto";
import { createOpenDevBrowserCore } from "../core";
import { loadGlobalConfig, resolveConfig, type OpenDevBrowserConfig } from "../config";
import { handleDaemonCommand, type DaemonCommandRequest } from "./daemon-commands";
import { clearBinding, getBindingDiagnostics, getHubInstanceId } from "./daemon-state";

const DEFAULT_DAEMON_PORT = 8788;
export const DAEMON_STOP_DEBUG_ENV = "OPDEVBROWSER_DEBUG_DAEMON_STOP";
const DAEMON_FINGERPRINT_FILE = "daemon-fingerprint.json";
export const DAEMON_STOP_REASON_HEADER = "x-opendevbrowser-stop-reason";
export const DAEMON_STOP_CLIENT_PID_HEADER = "x-opendevbrowser-stop-client-pid";
export const DAEMON_STOP_FINGERPRINT_HEADER = "x-opendevbrowser-stop-fingerprint";

const RECOVERABLE_PLAYWRIGHT_TRANSPORT_ERRORS = [
  "Cannot find context with specified id",
  "Detached while handling command.",
  "No frame with given id found"
] as const;
const DAEMON_FINGERPRINT_VERSION = "v1";

export type DaemonState = {
  port: number;
  token: string;
  pid: number;
  relayPort: number;
  startedAt: string;
  fingerprint: string;
  hubInstanceId?: string;
  relayInstanceId?: string;
  relayEpoch?: number;
};

type DaemonOptions = {
  port?: number;
  token?: string;
  config?: OpenDevBrowserConfig;
  directory?: string;
  worktree?: string | null;
};

type ResolveDaemonEntrypointOptions = {
  argv1?: string;
  moduleUrl?: string;
  entryExists?: (path: string) => boolean;
};

export function getCacheRoot(): string {
  const base = process.env.OPENCODE_CACHE_DIR
    ?? process.env.XDG_CACHE_HOME
    ?? join(homedir(), ".cache");
  return join(base, "opendevbrowser");
}

export function getDaemonMetadataPath(): string {
  return join(getCacheRoot(), "daemon.json");
}

export function readDaemonMetadata(): DaemonState | null {
  const metadataPath = getDaemonMetadataPath();
  if (!existsSync(metadataPath)) {
    return null;
  }
  try {
    const content = readFileSync(metadataPath, "utf-8");
    return JSON.parse(content) as DaemonState;
  } catch {
    return null;
  }
}

export function writeDaemonMetadata(state: DaemonState): void {
  const metadataPath = getDaemonMetadataPath();
  mkdirSync(join(getCacheRoot()), { recursive: true });
  writeFileSync(metadataPath, JSON.stringify(state, null, 2), { encoding: "utf-8", mode: 0o600 });
}

export function clearDaemonMetadata(): void {
  const metadataPath = getDaemonMetadataPath();
  try {
    unlinkSync(metadataPath);
  } catch {
    void 0;
  }
}

export function resolveCurrentDaemonEntrypointPath(
  options: ResolveDaemonEntrypointOptions = {}
): string {
  const rawEntry = options.argv1 ?? process.argv[1];
  if (typeof rawEntry === "string" && rawEntry.trim().length > 0) {
    return resolve(rawEntry);
  }
  const moduleUrl = options.moduleUrl ?? import.meta.url;
  const cliEntrypoint = resolve(fileURLToPath(new URL("./index.js", moduleUrl)));
  const entryExists = options.entryExists ?? existsSync;
  if (entryExists(cliEntrypoint)) {
    return cliEntrypoint;
  }
  return resolve(fileURLToPath(moduleUrl));
}

function hashFileContents(entryPath: string): string {
  try {
    return createHash("sha256").update(readFileSync(entryPath)).digest("hex");
  } catch {
    return "missing";
  }
}

function resolveDaemonFingerprintDistRoot(modulePath: string): string | null {
  let currentDir = dirname(modulePath);
  while (true) {
    if (basename(currentDir) === "dist") {
      return currentDir;
    }
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
  }
  return null;
}

function readDaemonFingerprintArtifact(modulePath: string): string | null {
  const distRoot = resolveDaemonFingerprintDistRoot(modulePath);
  if (distRoot === null) {
    return null;
  }
  try {
    const content = readFileSync(join(distRoot, DAEMON_FINGERPRINT_FILE), "utf-8");
    const payload = JSON.parse(content) as { fingerprint?: unknown };
    if (typeof payload.fingerprint === "string" && payload.fingerprint.trim().length > 0) {
      return payload.fingerprint.trim();
    }
  } catch {
    // Fall back to the local module hash below.
  }
  return null;
}

export function getCurrentDaemonFingerprint(options: ResolveDaemonEntrypointOptions = {}): string {
  const modulePath = resolve(fileURLToPath(options.moduleUrl ?? import.meta.url));
  const sharedFingerprint = readDaemonFingerprintArtifact(modulePath);
  const fingerprintParts = [
    DAEMON_FINGERPRINT_VERSION,
    sharedFingerprint ?? hashFileContents(modulePath)
  ];

  return createHash("sha256")
    .update(fingerprintParts.join("\n"))
    .digest("hex");
}

export function isCurrentDaemonFingerprint(fingerprint?: string | null): boolean {
  return typeof fingerprint === "string" && fingerprint === getCurrentDaemonFingerprint();
}

export function createDaemonStopHeaders(token: string, reason: string): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    [DAEMON_STOP_FINGERPRINT_HEADER]: getCurrentDaemonFingerprint(),
    [DAEMON_STOP_REASON_HEADER]: reason
  };
  if (process.env[DAEMON_STOP_DEBUG_ENV] === "1") {
    headers[DAEMON_STOP_CLIENT_PID_HEADER] = String(process.pid);
  }
  return headers;
}

export function resolveDaemonFingerprint(...candidates: Array<string | null | undefined>): string {
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate;
    }
  }
  return "missing";
}

export function isRecoverablePlaywrightTransportError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return RECOVERABLE_PLAYWRIGHT_TRANSPORT_ERRORS.some((pattern) => message.includes(pattern));
}

function isRecoverablePlaywrightTransportAssertion(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const isKnownTransportAssertion = message.includes("Assertion error")
    || message.includes("No tab attached");
  if (!isKnownTransportAssertion) {
    return false;
  }
  const stack = error instanceof Error && typeof error.stack === "string" ? error.stack : "";
  return stack.includes("playwright-core/lib/server/chromium/crConnection.js")
    || stack.includes("playwright-core/lib/server/transport.js");
}

function isAuthorized(request: IncomingMessage, token: string): boolean {
  const header = request.headers.authorization ?? "";
  if (!header.startsWith("Bearer ")) {
    return false;
  }
  const received = header.slice("Bearer ".length).trim();
  const expectedBuf = Buffer.from(token, "utf-8");
  const receivedBuf = Buffer.from(received, "utf-8");

  if (expectedBuf.length !== receivedBuf.length) {
    timingSafeEqual(expectedBuf, expectedBuf);
    return false;
  }
  return timingSafeEqual(expectedBuf, receivedBuf);
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function logDaemonStopDebug(message: string, details?: Record<string, unknown>): void {
  if (process.env[DAEMON_STOP_DEBUG_ENV] !== "1") {
    return;
  }
  const suffix = details ? ` ${JSON.stringify(details)}` : "";
  console.error(`[daemon-stop-debug] ${message}${suffix}`);
}

function readSingleHeader(request: IncomingMessage, name: string): string | null {
  const value = request.headers[name];
  if (typeof value === "string") {
    return value;
  }
  return null;
}

const isDaemonCommandRequest = (value: Record<string, unknown>): value is DaemonCommandRequest => {
  if (typeof value.name !== "string") {
    return false;
  }
  if (typeof value.params === "undefined") {
    return true;
  }
  return typeof value.params === "object" && value.params !== null && !Array.isArray(value.params);
};

export async function startDaemon(options: DaemonOptions = {}): Promise<{ state: DaemonState; stop: () => Promise<void> }> {
  const config = typeof options.config === "undefined"
    ? loadGlobalConfig()
    : resolveConfig(options.config);
  const port = options.port ?? config.daemonPort ?? DEFAULT_DAEMON_PORT;
  const token = options.token ?? config.daemonToken ?? generateSecureToken();
  const startedAt = new Date().toISOString();
  const fingerprint = getCurrentDaemonFingerprint();
  const core = createOpenDevBrowserCore({
    directory: options.directory ?? process.cwd(),
    worktree: options.worktree ?? null,
    config
  });

  await core.ensureRelay(config.relayPort);

  const server = createServer(async (request, response) => {
    if (!isAuthorized(request, token)) {
      sendJson(response, 401, { error: "Unauthorized" });
      return;
    }

    const url = new URL(request.url ?? "/", "http://127.0.0.1");

    if (request.method === "GET" && url.pathname === "/status") {
      const relayStatus = core.relay.status();
      writeDaemonMetadata({
        port,
        token,
        pid: process.pid,
        relayPort: relayStatus.port ?? config.relayPort,
        startedAt,
        fingerprint,
        hubInstanceId: getHubInstanceId(),
        relayInstanceId: relayStatus.instanceId,
        relayEpoch: relayStatus.epoch
      });
      sendJson(response, 200, {
        ok: true,
        pid: process.pid,
        fingerprint,
        hub: { instanceId: getHubInstanceId() },
        relay: relayStatus,
        binding: getBindingDiagnostics()
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/stop") {
      const stopFingerprint = readSingleHeader(request, DAEMON_STOP_FINGERPRINT_HEADER);
      logDaemonStopDebug("http.stop", {
        remoteAddress: request.socket.remoteAddress ?? null,
        remotePort: request.socket.remotePort ?? null,
        reason: readSingleHeader(request, DAEMON_STOP_REASON_HEADER),
        clientPid: readSingleHeader(request, DAEMON_STOP_CLIENT_PID_HEADER),
        fingerprintMatches: stopFingerprint === fingerprint
      });
      if (stopFingerprint !== fingerprint) {
        sendJson(response, 409, { ok: false, error: "Stale daemon stop request." });
        return;
      }
      sendJson(response, 200, { ok: true });
      await stop("http.stop");
      return;
    }

    if (request.method === "POST" && url.pathname === "/command") {
      try {
        const body = await readJson(request);
        if (!isDaemonCommandRequest(body)) {
          throw new Error("Invalid daemon command request");
        }
        const data = await handleDaemonCommand(core, body);
        sendJson(response, 200, { ok: true, data });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sendJson(response, 400, { ok: false, error: message });
      }
      return;
    }

    sendJson(response, 404, { error: "Not found" });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });

  const state: DaemonState = {
    port,
    token,
    pid: process.pid,
    relayPort: config.relayPort,
    startedAt,
    fingerprint,
    hubInstanceId: getHubInstanceId(),
    relayInstanceId: core.relay.status().instanceId,
    relayEpoch: core.relay.status().epoch
  };
  writeDaemonMetadata(state);

  let stopping = false;
  const handleRecoverableDaemonError = (channel: "uncaughtException" | "unhandledRejection", error: unknown): boolean => {
    if (!isRecoverablePlaywrightTransportError(error)) {
      if (isRecoverablePlaywrightTransportAssertion(error)) {
        const message = error instanceof Error ? error.message : String(error ?? "unknown");
        console.warn(`[daemon] ignored recoverable Playwright transport follow-on (${channel}): ${message}`);
        return true;
      }
      return false;
    }
    const message = error instanceof Error ? error.message : String(error ?? "unknown");
    console.warn(`[daemon] ignored recoverable Playwright transport error (${channel}): ${message}`);
    return true;
  };

  const uncaughtExceptionHandler = (error: Error) => {
    if (handleRecoverableDaemonError("uncaughtException", error)) {
      return;
    }
    console.error(error);
    void stop("uncaughtException").finally(() => {
      process.exitCode = 1;
    });
  };

  const unhandledRejectionHandler = (reason: unknown) => {
    if (handleRecoverableDaemonError("unhandledRejection", reason)) {
      return;
    }
    console.error(reason);
    void stop("unhandledRejection").finally(() => {
      process.exitCode = 1;
    });
  };

  const stop = async (reason = "unknown") => {
    if (stopping) {
      return;
    }
    stopping = true;
    logDaemonStopDebug("stop.begin", { reason });
    clearDaemonMetadata();
    clearBinding();
    process.off("SIGINT", sigintHandler);
    process.off("SIGTERM", sigtermHandler);
    process.off("uncaughtException", uncaughtExceptionHandler);
    process.off("unhandledRejection", unhandledRejectionHandler);
    core.cleanup();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    logDaemonStopDebug("stop.complete", { reason });
  };

  const sigintHandler = () => {
    void stop("SIGINT").catch(() => {});
  };
  const sigtermHandler = () => {
    void stop("SIGTERM").catch(() => {});
  };

  process.on("SIGINT", sigintHandler);
  process.on("SIGTERM", sigtermHandler);
  process.on("uncaughtException", uncaughtExceptionHandler);
  process.on("unhandledRejection", unhandledRejectionHandler);

  return { state, stop };
}

function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let data = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      data += chunk;
    });
    request.on("end", () => {
      try {
        const parsed = JSON.parse(data || "{}");
        if (!parsed || typeof parsed !== "object") {
          reject(new Error("Invalid JSON body"));
          return;
        }
        resolve(parsed as Record<string, unknown>);
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}
