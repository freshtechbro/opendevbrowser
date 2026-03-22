import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import {
  CLI,
  ensureCliBuilt,
  INSTALL_AUTOSTART_SKIP_ENV_VAR,
  ROOT,
  runCli,
  sleep
} from "./live-direct-utils.mjs";

const MAX_DAEMON_LOG_CHARS = 16_000;
const CHILD_EXIT_WAIT_MS = 5_000;
const HARNESS_CLEANUP_RETRIES = 8;

function appendLogChunk(chunks, chunk) {
  chunks.push(String(chunk));
  const joined = chunks.join("");
  if (joined.length <= MAX_DAEMON_LOG_CHARS) {
    return;
  }
  chunks.length = 0;
  chunks.push(joined.slice(-MAX_DAEMON_LOG_CHARS));
}

function tailLog(chunks) {
  return chunks.join("").trim();
}

async function waitForChildExit(child, timeoutMs = CHILD_EXIT_WAIT_MS) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  await new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      finish();
    });
    child.once("close", () => {
      clearTimeout(timer);
      finish();
    });
  });
}

async function terminateChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  child.kill("SIGTERM");
  await waitForChildExit(child);
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  child.kill("SIGKILL");
  await waitForChildExit(child);
}

export async function getFreePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to allocate port.")));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

export async function createTempHarness(prefix) {
  ensureCliBuilt();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
  const configDir = path.join(tempRoot, "config");
  const cacheDir = path.join(tempRoot, "cache");
  const daemonPort = await getFreePort();
  const relayToken = randomUUID().replaceAll("-", "");
  const daemonToken = randomUUID().replaceAll("-", "");
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, "opendevbrowser.jsonc"),
    `{
  "relayPort": 8787,
  "relayToken": "${relayToken}",
  "daemonPort": ${daemonPort},
  "daemonToken": "${daemonToken}"
}
`,
    { encoding: "utf8", mode: 0o600 }
  );

  return {
    tempRoot,
    configDir,
    cacheDir,
    daemonPort,
    env: {
      ...process.env,
      OPENCODE_CONFIG_DIR: configDir,
      OPENCODE_CACHE_DIR: cacheDir,
      [INSTALL_AUTOSTART_SKIP_ENV_VAR]: "1"
    }
  };
}

export async function startDaemon(env, daemonPort) {
  const stdoutChunks = [];
  const stderrChunks = [];
  const daemon = spawn(process.execPath, [CLI, "serve", "--port", String(daemonPort), "--output-format", "json"], {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  daemon.stdout?.on("data", (chunk) => appendLogChunk(stdoutChunks, chunk));
  daemon.stderr?.on("data", (chunk) => appendLogChunk(stderrChunks, chunk));
  daemon.on("error", (error) => appendLogChunk(stderrChunks, error instanceof Error ? error.stack ?? error.message : String(error)));

  const timeoutAt = Date.now() + 15_000;
  while (Date.now() < timeoutAt) {
    const status = runCli(["status", "--daemon"], {
      env,
      allowFailure: true,
      timeoutMs: 10_000
    });
    if (status.status === 0 && status.json?.success) {
      return daemon;
    }
    await sleep(250);
  }

  await terminateChild(daemon);
  const stderr = tailLog(stderrChunks);
  const stdout = tailLog(stdoutChunks);
  const detail = stderr || stdout;
  throw new Error(detail ? `Daemon did not become ready in time. ${detail}` : "Daemon did not become ready in time.");
}

export async function stopDaemon(daemon, env) {
  runCli(["daemon", "uninstall"], {
    env,
    allowFailure: true,
    timeoutMs: 15_000
  });
  runCli(["serve", "--stop"], {
    env,
    allowFailure: true,
    timeoutMs: 15_000
  });
  await terminateChild(daemon);
}

export async function cleanupHarness(tempRoot) {
  for (let attempt = 1; attempt <= HARNESS_CLEANUP_RETRIES; attempt += 1) {
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
      if ((code !== "ENOTEMPTY" && code !== "EBUSY") || attempt === HARNESS_CLEANUP_RETRIES) {
        throw error;
      }
      await sleep(250);
    }
  }
}

export async function withTempHarness(prefix, task) {
  const harness = await createTempHarness(prefix);
  const daemon = await startDaemon(harness.env, harness.daemonPort);
  try {
    return await task({
      ...harness,
      daemon
    });
  } finally {
    await stopDaemon(daemon, harness.env);
    await cleanupHarness(harness.tempRoot);
  }
}

export function extractRefByPattern(content, pattern) {
  for (const line of String(content ?? "").split(/\r?\n/)) {
    const match = line.match(/^\[([^\]]+)\]\s+(.*)$/);
    if (!match) continue;
    if (pattern.test(match[2] ?? "")) {
      return match[1] ?? null;
    }
  }
  return null;
}

export function extractTextMarker(content, pattern) {
  return pattern.test(String(content ?? ""));
}

export async function startHttpFixtureServer(handler) {
  const port = await getFreePort();
  const server = handler();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });

  return {
    server,
    baseUrl: `http://127.0.0.1:${port}`
  };
}

export async function closeHttpFixtureServer(server) {
  await new Promise((resolve) => {
    server.close(() => resolve());
  });
}
