import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { timingSafeEqual } from "crypto";
import { mkdirSync, readFileSync, writeFileSync, unlinkSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { generateSecureToken } from "../utils/crypto";
import { createOpenDevBrowserCore } from "../core";
import { loadGlobalConfig, type OpenDevBrowserConfig } from "../config";
import { handleDaemonCommand } from "./daemon-commands";

const DEFAULT_DAEMON_PORT = 8788;

export type DaemonState = {
  port: number;
  token: string;
  pid: number;
  relayPort: number;
  startedAt: string;
};

type DaemonOptions = {
  port?: number;
  token?: string;
  config?: OpenDevBrowserConfig;
  directory?: string;
  worktree?: string | null;
};

function getCacheRoot(): string {
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

export async function startDaemon(options: DaemonOptions = {}): Promise<{ state: DaemonState; stop: () => Promise<void> }> {
  const config = options.config ?? loadGlobalConfig();
  const port = options.port ?? DEFAULT_DAEMON_PORT;
  const token = options.token ?? generateSecureToken();
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
      sendJson(response, 200, {
        ok: true,
        pid: process.pid,
        relay: core.relay.status()
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/stop") {
      sendJson(response, 200, { ok: true });
      await stop();
      return;
    }

    if (request.method === "POST" && url.pathname === "/command") {
      try {
        const body = await readJson(request);
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
    startedAt: new Date().toISOString()
  };
  writeDaemonMetadata(state);

  const stop = async () => {
    clearDaemonMetadata();
    core.cleanup();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  };

  process.on("SIGINT", () => {
    stop().catch(() => {});
  });
  process.on("SIGTERM", () => {
    stop().catch(() => {});
  });

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
