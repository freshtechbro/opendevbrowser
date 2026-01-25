#!/usr/bin/env node
import fs from "fs";
import os from "os";
import path from "path";
import net from "net";
import { spawn, spawnSync } from "child_process";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(ROOT, "dist", "cli", "index.js");

function ensureCli() {
  if (!fs.existsSync(CLI)) {
    throw new Error(`CLI not found at ${CLI}. Run npm run build first.`);
  }
}

function parseJsonFromStdout(stdout) {
  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    try {
      return JSON.parse(line);
    } catch {
      continue;
    }
  }
  return null;
}

function runCli(args, options = {}) {
  const withFormat = args.some((arg) => arg.startsWith("--output-format"));
  const finalArgs = withFormat ? args : [...args, "--output-format", "json"];
  const result = spawnSync(process.execPath, [CLI, ...finalArgs], {
    env: options.env,
    input: options.input,
    encoding: "utf-8"
  });

  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const json = parseJsonFromStdout(stdout);

  if (!options.allowFailure && result.status !== 0) {
    const details = json?.message || stderr || stdout;
    throw new Error(`Command failed (${finalArgs.join(" ")}): ${details}`);
  }

  return { status: result.status ?? 0, stdout, stderr, json };
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getFreePort() {
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

async function startDaemon(env, port) {
  const child = spawn(process.execPath, [CLI, "serve", "--port", String(port), "--output-format", "json"], {
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });

  const timeoutMs = 15000;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const status = runCli(["status", "--daemon"], { env, allowFailure: true });
    if (status.json?.success) {
      return child;
    }
    await sleep(250);
  }

  child.kill("SIGTERM");
  throw new Error("Daemon did not become ready in time.");
}

function buildDataUrl() {
  const html = `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>OpenDevBrowser Smoke</title>
    <style>
      body { font-family: sans-serif; padding: 24px; }
      .spacer { height: 1200px; }
    </style>
  </head>
  <body>
    <h1>Smoke Test</h1>
    <button id="action">Do thing</button>
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
  ensureCli();

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opendevbrowser-cli-"));
  const configDir = path.join(tempRoot, "config");
  const cacheDir = path.join(tempRoot, "cache");
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(cacheDir, { recursive: true });

  const env = {
    ...process.env,
    OPENCODE_CONFIG_DIR: configDir,
    OPENCODE_CACHE_DIR: cacheDir
  };

  console.log(`Using temp config: ${configDir}`);
  console.log(`Using temp cache: ${cacheDir}`);

  runCli(["help"], { env });
  runCli(["version"], { env });
  runCli(["install", "--global", "--no-prompt", "--no-skills"], { env });
  runCli(["update"], { env });

  const daemonPort = await getFreePort();
  const daemon = await startDaemon(env, daemonPort);

  let sessionId = null;
  try {
    runCli(["status", "--daemon"], { env });

    const dataUrl = buildDataUrl();
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
    runCli(["serve", "--stop"], { env, allowFailure: true });
    daemon.kill("SIGTERM");
  }

  runCli(["uninstall", "--global", "--no-prompt"], { env });

  console.log("CLI smoke test completed.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
