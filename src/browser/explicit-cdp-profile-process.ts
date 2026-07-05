import { execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { ensureLocalEndpoint } from "../utils/endpoint-validation";

const CDP_PROFILE_START_POLL_MS = 100;
const CDP_PROFILE_STOP_POLL_MS = 100;
const PROCESS_COMMAND_TIMEOUT_MS = 1_000;
const PROCESS_COMMAND_MAX_BUFFER_BYTES = 16_384;

export async function reserveLocalPort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        if (port <= 0) {
          reject(new Error("Failed to reserve a local CDP port."));
          return;
        }
        resolvePort(port);
      });
    });
  });
}

export async function waitForCdpWsEndpoint(port: number, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const endpoint = await probeCdpWsEndpoint(port);
    if (endpoint) {
      return endpoint;
    }
    await delay(CDP_PROFILE_START_POLL_MS);
  }
  throw new Error("Timed out waiting for explicit CDP profile remote debugging endpoint.");
}

export async function probeCdpWsEndpoint(port: number): Promise<string | null> {
  let data: { readonly webSocketDebuggerUrl?: string };
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`);
    if (!response.ok) {
      return null;
    }
    data = await response.json() as { readonly webSocketDebuggerUrl?: string };
  } catch {
    return null;
  }
  if (!data.webSocketDebuggerUrl) {
    return null;
  }
  ensureLocalEndpoint(data.webSocketDebuggerUrl, false);
  return data.webSocketDebuggerUrl;
}

export async function waitForProcessExit(pid: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) {
      return;
    }
    await delay(CDP_PROFILE_STOP_POLL_MS);
  }
  throw new Error("Timed out waiting for OpenDevBrowser-owned CDP browser process to exit.");
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (isNodeErrno(error, "ESRCH")) {
      return false;
    }
    if (isNodeErrno(error, "EPERM")) {
      return true;
    }
    throw error;
  }
}

export function isExplicitCdpProcessOwnedByProfile(
  pid: number,
  profileDir: string,
  port: number
): boolean {
  const commandLine = readProcessCommandLine(pid);
  if (!commandLine) {
    return false;
  }
  return commandLineContainsFlag(commandLine, "--remote-debugging-port", String(port))
    && commandLineContainsFlag(commandLine, "--user-data-dir", profileDir);
}

export async function terminateProcessBestEffort(pid: number | undefined, timeoutMs: number): Promise<void> {
  try {
    if (!pid || !isProcessAlive(pid)) {
      return;
    }
    process.kill(pid, "SIGTERM");
    await waitForProcessExit(pid, timeoutMs);
  } catch {
    return;
  }
}

export function isNodeErrno(error: unknown, code: string): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { readonly code?: unknown }).code === code;
}

export function getNodeErrnoCode(error: unknown): string {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return "unknown";
  }
  const code = (error as { readonly code?: unknown }).code;
  return typeof code === "string" ? code : "unknown";
}

function readProcessCommandLine(pid: number): string | null {
  if (process.platform === "win32") {
    return null;
  }
  try {
    return execFileSync("ps", ["-p", String(pid), "-o", "command="], {
      encoding: "utf8",
      timeout: PROCESS_COMMAND_TIMEOUT_MS,
      maxBuffer: PROCESS_COMMAND_MAX_BUFFER_BYTES
    }).trim();
  } catch {
    return null;
  }
}

function commandLineContainsFlag(commandLine: string, flag: string, value: string): boolean {
  const escapedFlag = escapeRegExp(flag);
  const escapedValue = escapeRegExp(value);
  const prefix = `(?:^|\\s)${escapedFlag}`;
  const boundary = /\s/u.test(value) ? "(?=\\s--)" : "(?=\\s|$)";
  const patterns = [
    `${prefix}="${escapedValue}"(?=\\s|$)`,
    `${prefix}='${escapedValue}'(?=\\s|$)`,
    `${prefix}=${escapedValue}${boundary}`,
    `${prefix}\\s${escapedValue}${boundary}`
  ];
  return patterns.some((pattern) => new RegExp(pattern, "u").test(commandLine));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
