#!/usr/bin/env node
import fs from "fs";
import os from "os";
import path from "path";
import net from "net";
import { randomUUID } from "crypto";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { INSTALL_AUTOSTART_SKIP_ENV_VAR } from "./live-direct-utils.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(ROOT, "dist", "cli", "index.js");
const DEFAULT_CLI_TIMEOUT_MS = 45_000;
export const DAEMON_READY_TIMEOUT_MS = 30_000;
export const DAEMON_POLL_INTERVAL_MS = 500;
export const DAEMON_STATUS_TIMEOUT_MS = 15_000;
const MAX_DAEMON_LOG_CHARS = 16_000;
const CHILD_EXIT_WAIT_MS = 5_000;
const DAEMON_LOG_DIR_PREFIX = "opendevbrowser-daemon-";
const DAEMON_STDOUT_LOG = "daemon.stdout.log";
const DAEMON_STDERR_LOG = "daemon.stderr.log";
const DEFAULT_BACKGROUND_SHELL = process.env.SHELL || "/bin/sh";
const BACKGROUND_NODE_COMMAND = JSON.stringify(process.execPath);

function isValidPid(value) {
  return Number.isInteger(value) && value > 0;
}

function isProcessAlive(pid) {
  if (!isValidPid(pid)) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readLogTail(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return "";
  }
  const content = fs.readFileSync(filePath, "utf-8").trim();
  return content.length <= MAX_DAEMON_LOG_CHARS
    ? content
    : content.slice(-MAX_DAEMON_LOG_CHARS);
}

function parseOptions(argv) {
  const options = { variant: "primary" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--variant") {
      const value = argv[index + 1];
      if (value !== "primary" && value !== "secondary") {
        throw new Error("--variant requires primary or secondary.");
      }
      options.variant = value;
      index += 1;
      continue;
    }
    if (arg?.startsWith("--variant=")) {
      const value = arg.split("=", 2)[1];
      if (value !== "primary" && value !== "secondary") {
        throw new Error("--variant requires primary or secondary.");
      }
      options.variant = value;
      continue;
    }
    if (arg === "--help") {
      console.log([
        "Usage: node scripts/cli-smoke-test.mjs [options]",
        "",
        "Options:",
        "  --variant <primary|secondary>  Switch the synthetic page variant (default: primary)",
        "  --help                         Show help"
      ].join("\n"));
      process.exit(0);
    }
    throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

export const parseArgs = parseOptions;

export function ensureCli() {
  if (!fs.existsSync(CLI)) {
    throw new Error(`CLI not found at ${CLI}. Run npm run build first.`);
  }
}

function parseJsonFromStdout(stdout) {
  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    try {
      return JSON.parse(line);
    } catch {
      continue;
    }
  }
  return null;
}

export function runCli(args, options = {}) {
  const withFormat = args.some((arg) => arg.startsWith("--output-format"));
  const finalArgs = options.rawOutput || withFormat ? args : [...args, "--output-format", "json"];
  if (process.env.ODB_CLI_SMOKE_TRACE === "1") {
    console.error(`[cli-smoke] ${finalArgs.join(" ")}`);
  }
  const result = spawnSync(process.execPath, [CLI, ...finalArgs], {
    env: options.env,
    input: options.input,
    encoding: "utf-8",
    timeout: options.timeoutMs ?? DEFAULT_CLI_TIMEOUT_MS
  });

  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const json = parseJsonFromStdout(stdout);
  const timedOut = result.error?.code === "ETIMEDOUT";

  if (!options.allowFailure && (result.status !== 0 || timedOut)) {
    const details = timedOut
      ? `Timed out after ${options.timeoutMs ?? DEFAULT_CLI_TIMEOUT_MS}ms`
      : json?.message || stderr || stdout;
    throw new Error(`Command failed (${finalArgs.join(" ")}): ${details}`);
  }

  return { status: timedOut ? 1 : (result.status ?? 0), stdout, stderr, json, timedOut };
}

export function buildSmokeReviewArgs(sessionId) {
  return ["review", "--session-id", sessionId, "--max-chars", "2000"];
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatDaemonFailure(baseMessage, handle, statusDetail) {
  const details = [];
  details.push(`pid=${handle.pid}`);
  details.push(`alive=${isProcessAlive(handle.pid)}`);
  if (statusDetail) {
    details.push(`status=${statusDetail}`);
  }
  const stderr = readLogTail(handle.stderrPath);
  if (stderr) {
    details.push(`stderr=${stderr}`);
  }
  const stdout = readLogTail(handle.stdoutPath);
  if (stdout) {
    details.push(`stdout=${stdout}`);
  }
  return details.length > 0 ? `${baseMessage} ${details.join(" | ")}` : baseMessage;
}

async function waitForProcessExit(pid, timeoutMs = CHILD_EXIT_WAIT_MS) {
  if (!isProcessAlive(pid)) {
    return;
  }
  const timeoutAt = Date.now() + timeoutMs;
  while (Date.now() < timeoutAt) {
    if (!isProcessAlive(pid)) {
      return;
    }
    await sleep(100);
  }
}

export async function terminateChild(handle) {
  if (!handle || !isValidPid(handle.pid) || !isProcessAlive(handle.pid)) {
    return;
  }
  try {
    process.kill(handle.pid, "SIGTERM");
  } catch {
    return;
  }
  await waitForProcessExit(handle.pid);
  if (!isProcessAlive(handle.pid)) {
    return;
  }
  try {
    process.kill(handle.pid, "SIGKILL");
  } catch {
    return;
  }
  await waitForProcessExit(handle.pid);
}

export async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to allocate port")));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

export async function startDaemon(env, port) {
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), DAEMON_LOG_DIR_PREFIX));
  const stdoutPath = path.join(logDir, DAEMON_STDOUT_LOG);
  const stderrPath = path.join(logDir, DAEMON_STDERR_LOG);
  const command = [
    BACKGROUND_NODE_COMMAND,
    JSON.stringify(CLI),
    "serve",
    "--port",
    String(port),
    "--output-format",
    "json",
    ">",
    JSON.stringify(stdoutPath),
    "2>",
    JSON.stringify(stderrPath),
    "&",
    "echo $!"
  ].join(" ");
  const launcher = spawnSync(DEFAULT_BACKGROUND_SHELL, ["-lc", command], {
    cwd: ROOT,
    env,
    encoding: "utf-8"
  });
  if (launcher.error) {
    throw launcher.error;
  }
  if ((launcher.status ?? 1) !== 0) {
    const detail = launcher.stderr?.trim() || launcher.stdout?.trim() || "unknown launcher failure";
    throw new Error(`Failed to start background daemon: ${detail}`);
  }
  const pid = Number.parseInt(String(launcher.stdout ?? "").trim(), 10);
  if (!isValidPid(pid)) {
    const detail = launcher.stdout?.trim() || launcher.stderr?.trim() || "missing daemon pid";
    throw new Error(`Failed to capture background daemon pid: ${detail}`);
  }
  const handle = { pid, stdoutPath, stderrPath };

  let lastStatusDetail = null;
  const timeoutAt = Date.now() + DAEMON_READY_TIMEOUT_MS;
  while (Date.now() < timeoutAt) {
    const status = runCli(["status", "--daemon"], {
      env,
      allowFailure: true,
      timeoutMs: DAEMON_STATUS_TIMEOUT_MS
    });
    if (status.status === 0 && status.json?.success) {
      return handle;
    }
    lastStatusDetail = status.timedOut
      ? `status --daemon timed out after ${DAEMON_STATUS_TIMEOUT_MS}ms`
      : (status.json?.message || status.stderr || status.stdout || null);
    if (!isProcessAlive(handle.pid)) {
      throw new Error(formatDaemonFailure(
        "Daemon exited before becoming ready.",
        handle,
        lastStatusDetail
      ));
    }
    await sleep(DAEMON_POLL_INTERVAL_MS);
  }

  await terminateChild(handle);
  throw new Error(formatDaemonFailure(
    "Daemon did not become ready in time.",
    handle,
    lastStatusDetail
  ));
}

function buildDataUrl(variant) {
  const heading = variant === "secondary" ? "Smoke Test Secondary" : "Smoke Test";
  const buttonLabel = variant === "secondary" ? "Open overlay" : "Do thing";
  const html = `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>OpenDevBrowser ${variant === "secondary" ? "Secondary " : ""}Smoke</title>
    <style>
      body { font-family: sans-serif; padding: 24px; }
      .spacer { height: 1200px; }
    </style>
    <script>
      window.__odbSmokeClicks = 0;
      function handleAction() {
        window.__odbSmokeClicks += 1;
      }
    </script>
  </head>
  <body>
    <h1>${heading}</h1>
    <button id="action" onclick="handleAction()">${buttonLabel}</button>
    <label for="name">Name</label>
    <input id="name" type="text" aria-label="Name" />
    <label for="agree">Agree</label>
    <input id="agree" type="checkbox" aria-label="Agree" />
    <label for="choice">Choice</label>
    <select id="choice" aria-label="Choice">
      <option value="one">One</option>
      <option value="two">Two</option>
    </select>
    <div class="spacer"></div>
  </body>
</html>
  `.trim();
  return `data:text/html,${encodeURIComponent(html)}`;
}

function extractRef(content, roleCandidates) {
  const lines = content.split(/\r?\n/);
  for (const role of roleCandidates) {
    const regex = new RegExp(`^\\[([^\\]]+)\\]\\s+${role}\\b`, "i");
    for (const line of lines) {
      const match = line.match(regex);
      if (match) {
        return match[1];
      }
    }
  }
  return null;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  ensureCli();

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opendevbrowser-cli-"));
  const configDir = path.join(tempRoot, "config");
  const cacheDir = path.join(tempRoot, "cache");
  const daemonPort = await getFreePort();
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(cacheDir, { recursive: true });

  const configPath = path.join(configDir, "opendevbrowser.jsonc");
  const relayToken = randomUUID().replaceAll("-", "");
  const daemonToken = randomUUID().replaceAll("-", "");
  fs.writeFileSync(
    configPath,
    `{
  "relayPort": 8787,
  "relayToken": "${relayToken}",
  "daemonPort": ${daemonPort},
  "daemonToken": "${daemonToken}"
}
`,
    { encoding: "utf-8", mode: 0o600 }
  );

  const env = {
    ...process.env,
    OPENCODE_CONFIG_DIR: configDir,
    OPENCODE_CACHE_DIR: cacheDir,
    [INSTALL_AUTOSTART_SKIP_ENV_VAR]: "1"
  };

  console.log(`Using temp config: ${configDir}`);
  console.log(`Using temp cache: ${cacheDir}`);

  runCli(["help"], { env });
  runCli(["version"], { env });
  runCli(["install", "--global", "--no-prompt", "--no-skills"], { env });
  runCli(["update"], { env });

  const daemon = await startDaemon(env, daemonPort);

  let sessionId = null;
  try {
    runCli(["status", "--daemon"], { env });

    const dataUrl = buildDataUrl(options.variant);
    const launch = runCli([
      "launch",
      "--no-extension",
      "--headless",
      "--start-url",
      dataUrl,
      "--no-interactive"
    ], { env });
    sessionId = launch.json?.data?.sessionId;
    if (!sessionId) {
      throw new Error("Missing sessionId from launch.");
    }
    runCli(["status", "--session-id", sessionId], { env });
    runCli(["goto", "--session-id", sessionId, "--url", dataUrl], { env });
    runCli(["wait", "--session-id", sessionId, "--until", "load"], { env });
    runCli(buildSmokeReviewArgs(sessionId), { env });

    const snapshot = runCli([
      "snapshot",
      "--session-id",
      sessionId,
      "--mode",
      "actionables",
      "--max-chars",
      "4000"
    ], { env });

    const content = snapshot.json?.data?.content ?? "";
    const buttonRef = extractRef(content, ["button", "link"]);
    const inputRef = extractRef(content, ["textbox", "searchbox", "textarea"]);
    const checkboxRef = extractRef(content, ["checkbox", "switch"]);
    const selectRef = extractRef(content, ["combobox", "listbox"]);

    runCli(["pointer-move", "--session-id", sessionId, "--x", "32", "--y", "32", "--steps", "2"], { env });
    runCli(["pointer-down", "--session-id", sessionId, "--x", "32", "--y", "32"], { env });
    runCli(["pointer-up", "--session-id", sessionId, "--x", "32", "--y", "32"], { env });
    runCli(["pointer-drag", "--session-id", sessionId, "--from-x", "32", "--from-y", "32", "--to-x", "96", "--to-y", "96", "--steps", "3"], { env });

    if (buttonRef) {
      runCli(["hover", "--session-id", sessionId, "--ref", buttonRef], { env });
      runCli(["click", "--session-id", sessionId, "--ref", buttonRef], { env });
    }
    if (inputRef) {
      runCli(["type", "--session-id", sessionId, "--ref", inputRef, "--text", "hello", "--clear"], { env });
      runCli(["press", "--session-id", sessionId, "--ref", inputRef, "--key", "Enter"], { env });
    }
    if (selectRef) {
      runCli(["select", "--session-id", sessionId, "--ref", selectRef, "--values", "two"], { env });
    }
    if (checkboxRef) {
      runCli(["check", "--session-id", sessionId, "--ref", checkboxRef], { env });
      runCli(["uncheck", "--session-id", sessionId, "--ref", checkboxRef], { env });
    }

    runCli(["scroll", "--session-id", sessionId, "--dy", "200"], { env });
    if (buttonRef) {
      runCli(["scroll-into-view", "--session-id", sessionId, "--ref", buttonRef], { env });
    }
    if (buttonRef) {
      runCli(["dom-html", "--session-id", sessionId, "--ref", buttonRef, "--max-chars", "2000"], { env });
      runCli(["dom-text", "--session-id", sessionId, "--ref", buttonRef, "--max-chars", "2000"], { env });
      runCli(["dom-attr", "--session-id", sessionId, "--ref", buttonRef, "--attr", "id"], { env });
      runCli(["dom-visible", "--session-id", sessionId, "--ref", buttonRef], { env });
      runCli(["dom-enabled", "--session-id", sessionId, "--ref", buttonRef], { env });
      runCli(["clone-component", "--session-id", sessionId, "--ref", buttonRef], { env });
    }
    if (inputRef) {
      runCli(["dom-value", "--session-id", sessionId, "--ref", inputRef], { env });
    }
    if (checkboxRef) {
      runCli(["dom-checked", "--session-id", sessionId, "--ref", checkboxRef], { env });
    }

    const cookieFile = path.join(tempRoot, "cookies.json");
    fs.writeFileSync(cookieFile, JSON.stringify([
      {
        name: "session",
        value: options.variant === "secondary" ? "def456" : "abc123",
        url: "https://example.com"
      }
    ], null, 2), "utf-8");
    runCli(["cookie-import", "--session-id", sessionId, "--cookies-file", cookieFile, "--strict=false"], { env });
    runCli(["cookie-list", "--session-id", sessionId, "--url", "https://example.com"], { env });

    runCli(["clone-page", "--session-id", sessionId], { env });
    runCli(["perf", "--session-id", sessionId], { env });

    const screenshotPath = path.join(tempRoot, "smoke.png");
    runCli(["screenshot", "--session-id", sessionId, "--path", screenshotPath], { env });
    runCli(["console-poll", "--session-id", sessionId, "--since-seq", "0", "--max", "10"], { env });
    runCli(["network-poll", "--session-id", sessionId, "--since-seq", "0", "--max", "10"], { env });

    const targetNew = runCli(["target-new", "--session-id", sessionId, "--url", dataUrl], { env });
    const targetId = targetNew.json?.data?.targetId;
    runCli(["targets-list", "--session-id", sessionId], { env });
    if (targetId) {
      runCli(["target-use", "--session-id", sessionId, "--target-id", targetId], { env });
      runCli(["target-close", "--session-id", sessionId, "--target-id", targetId], { env });
    }

    runCli(["page", "--session-id", sessionId, "--name", "smoke", "--url", dataUrl], { env });
    runCli(["pages", "--session-id", sessionId], { env });
    runCli(["page-close", "--session-id", sessionId, "--name", "smoke"], { env });

    const runScriptPath = path.join(tempRoot, "run-script.json");
    const runScript = [
      { action: "goto", args: { url: dataUrl } },
      { action: "wait", args: { until: "load" } },
      { action: "snapshot", args: { mode: "actionables", maxChars: 2000 } }
    ];
    fs.writeFileSync(runScriptPath, JSON.stringify(runScript, null, 2), "utf-8");
    const runProfile = `smoke-run-${Date.now()}`;
    runCli(["run", "--script", runScriptPath, "--headless", "--profile", runProfile], { env });
    runCli(["artifacts", "cleanup", "--expired-only", "--output-dir", tempRoot], { env });

    runCli(["disconnect", "--session-id", sessionId, "--close-browser"], { env });
    sessionId = null;
  } finally {
    if (sessionId) {
      try {
        runCli(["disconnect", "--session-id", sessionId, "--close-browser"], { env, allowFailure: true });
      } catch {
        void 0;
      }
    }
    runCli(["daemon", "uninstall"], { env, allowFailure: true });
    runCli(["serve", "--stop"], { env, allowFailure: true });
    await terminateChild(daemon);
  }

  runCli(["uninstall", "--global", "--no-prompt"], { env });

  console.log("CLI smoke test completed.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
