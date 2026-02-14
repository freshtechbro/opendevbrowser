#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(ROOT, "dist", "cli", "index.js");

/**
 * @typedef {"pass" | "fail" | "env_limited" | "expected_timeout"} StepStatus
 */

/**
 * @typedef {{
 *   id: string;
 *   status: StepStatus;
 *   detail?: string;
 *   data?: Record<string, unknown>;
 * }} StepResult
 */

/**
 * @typedef {{
 *   status: number;
 *   stdout: string;
 *   stderr: string;
 *   json: Record<string, unknown> | null;
 *   durationMs: number;
 *   error?: string;
 * }} CliResult
 */

const MAX_BUFFER = 64 * 1024 * 1024;

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

function runCli(args, { allowFailure = false } = {}) {
  const start = Date.now();
  const result = spawnSync(process.execPath, [CLI, ...args, "--output-format", "json"], {
    encoding: "utf-8",
    maxBuffer: MAX_BUFFER
  });
  const durationMs = Date.now() - start;
  const payload = {
    status: result.status ?? 0,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    json: parseJsonFromStdout(result.stdout ?? ""),
    durationMs,
    ...(result.error ? { error: String(result.error) } : {})
  };

  if (!allowFailure && payload.status !== 0) {
    const detail = payload.json?.error ?? payload.stderr ?? payload.stdout ?? "Unknown CLI failure";
    throw new Error(`CLI failed (${args.join(" ")}): ${detail}`);
  }
  return payload;
}

function startDaemonDetached() {
  const child = spawn(process.execPath, [CLI, "serve", "--output-format", "json"], {
    detached: true,
    stdio: "ignore"
  });
  child.unref();
}

async function waitForDaemonReady(timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const status = runCli(["status", "--daemon"], { allowFailure: true });
    if (status.status === 0) {
      return status;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return null;
}

function ensureCliBuilt() {
  if (!fs.existsSync(CLI)) {
    throw new Error(`CLI not found at ${CLI}. Run npm run build first.`);
  }
}

function summarizeFailure(result) {
  const fromJson = result.json?.error ?? result.json?.message;
  return typeof fromJson === "string" && fromJson.length > 0
    ? fromJson
    : result.stderr || result.stdout || result.error || "Unknown failure";
}

function pickSessionId(result) {
  return typeof result.json?.data?.sessionId === "string" ? result.json.data.sessionId : null;
}

async function getFreePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Unable to allocate free port")));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

async function waitForHttp(port, pathSuffix, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}${pathSuffix}`);
      if (response.ok) {
        return true;
      }
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

function isDetachedFrameError(detail) {
  const message = String(detail || "").toLowerCase();
  return message.includes("frame has been detached");
}

function isTimeoutError(detail) {
  const message = String(detail || "").toLowerCase();
  return message.includes("timed out");
}

function isExtensionUnavailable(detail) {
  const message = String(detail || "").toLowerCase();
  return message.includes("extension not connected")
    || message.includes("connect the extension")
    || message.includes("extension handshake");
}

function addResult(results, entry) {
  results.push(entry);
}

function summarize(results, startedAt) {
  const counts = {
    pass: results.filter((item) => item.status === "pass").length,
    env_limited: results.filter((item) => item.status === "env_limited").length,
    expected_timeout: results.filter((item) => item.status === "expected_timeout").length,
    fail: results.filter((item) => item.status === "fail").length
  };
  return {
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    counts,
    ok: counts.fail === 0,
    results
  };
}

async function runMatrix() {
  ensureCliBuilt();
  const startedAt = Date.now();
  /** @type {StepResult[]} */
  const results = [];

  // Ensure the daemon process is using the current local build.
  try {
    runCli(["serve", "--stop"], { allowFailure: true });
    startDaemonDetached();
    const restart = await waitForDaemonReady(30000);
    if (!restart) {
      throw new Error("Timed out waiting for daemon to become ready after recycle.");
    }
    addResult(results, {
      id: "infra.daemon.recycle",
      status: "pass",
      data: {
        durationMs: restart.durationMs,
        message: typeof restart.json?.message === "string" ? restart.json.message : null
      }
    });
  } catch (error) {
    addResult(results, {
      id: "infra.daemon.recycle",
      status: "fail",
      detail: error instanceof Error ? error.message : String(error)
    });
  }

  // Infrastructure checks
  try {
    const daemonStatus = runCli(["status", "--daemon"]);
    addResult(results, {
      id: "infra.status.daemon",
      status: "pass",
      data: {
        durationMs: daemonStatus.durationMs,
        relay: daemonStatus.json?.data?.relay ?? null
      }
    });
  } catch (error) {
    addResult(results, {
      id: "infra.status.daemon",
      status: "fail",
      detail: error instanceof Error ? error.message : String(error)
    });
  }

  for (const [id, args] of [
    ["infra.daemon.status", ["daemon", "status"]],
    ["infra.native.status", ["native", "status"]]
  ]) {
    try {
      const result = runCli(args);
      addResult(results, {
        id,
        status: "pass",
        data: {
          durationMs: result.durationMs,
          message: typeof result.json?.message === "string" ? result.json.message : null
        }
      });
    } catch (error) {
      addResult(results, {
        id,
        status: "fail",
        detail: error instanceof Error ? error.message : String(error)
      });
    }
  }

  // Managed mode + cookie URL-form import
  let managedSessionId = null;
  try {
    const launch = runCli(["launch", "--no-extension", "--headless", "--start-url", "https://example.com"]);
    managedSessionId = pickSessionId(launch);
    if (!managedSessionId) {
      throw new Error("Managed launch returned no sessionId.");
    }
    runCli(["goto", "--session-id", managedSessionId, "--url", "https://example.com", "--wait-until", "load", "--timeout-ms", "30000"]);
    runCli(["wait", "--session-id", managedSessionId, "--until", "load", "--timeout-ms", "30000"]);
    runCli(["snapshot", "--session-id", managedSessionId, "--mode", "actionables", "--max-chars", "6000"]);
    runCli(["perf", "--session-id", managedSessionId]);

    const cookiesPayload = JSON.stringify([{ name: "matrix_cookie", value: "ok", url: "https://example.com" }]);
    runCli(["cookie-import", "--session-id", managedSessionId, "--cookies", cookiesPayload, "--request-id", "matrix-cookie-url"]);
    addResult(results, { id: "mode.managed", status: "pass" });
    addResult(results, { id: "feature.cookie_import_url", status: "pass" });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    addResult(results, { id: "mode.managed", status: "fail", detail });
    if (detail.includes("matrix-cookie-url") || detail.toLowerCase().includes("cookie import")) {
      addResult(results, { id: "feature.cookie_import_url", status: "fail", detail });
    }
  } finally {
    if (managedSessionId) {
      runCli(["disconnect", "--session-id", managedSessionId, "--close-browser"], { allowFailure: true });
    }
  }

  // Extension ops mode
  let extensionSessionId = null;
  try {
    const launch = runCli(["launch", "--extension-only", "--wait-for-extension", "--wait-timeout-ms", "30000"]);
    extensionSessionId = pickSessionId(launch);
    if (!extensionSessionId) {
      throw new Error("Extension launch returned no sessionId.");
    }
    runCli(["goto", "--session-id", extensionSessionId, "--url", "https://example.com", "--wait-until", "load", "--timeout-ms", "30000"]);
    runCli(["snapshot", "--session-id", extensionSessionId, "--mode", "actionables", "--max-chars", "6000"]);
    runCli(["perf", "--session-id", extensionSessionId]);
    addResult(results, { id: "mode.extension_ops", status: "pass" });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    addResult(results, {
      id: "mode.extension_ops",
      status: isExtensionUnavailable(detail) ? "env_limited" : "fail",
      detail
    });
  } finally {
    if (extensionSessionId) {
      runCli(["disconnect", "--session-id", extensionSessionId], { allowFailure: true });
    }
  }

  // Extension legacy (/cdp) mode
  let extensionLegacySessionId = null;
  try {
    const launch = runCli(["launch", "--extension-only", "--extension-legacy", "--wait-for-extension", "--wait-timeout-ms", "30000"]);
    extensionLegacySessionId = pickSessionId(launch);
    if (!extensionLegacySessionId) {
      throw new Error("Extension legacy launch returned no sessionId.");
    }

    let goto = runCli(
      ["goto", "--session-id", extensionLegacySessionId, "--url", "https://example.com", "--wait-until", "load", "--timeout-ms", "30000"],
      { allowFailure: true }
    );
    if (goto.status !== 0 && isDetachedFrameError(summarizeFailure(goto))) {
      goto = runCli(
        ["goto", "--session-id", extensionLegacySessionId, "--url", "https://example.com", "--wait-until", "load", "--timeout-ms", "30000"],
        { allowFailure: true }
      );
    }
    if (goto.status !== 0) {
      throw new Error(summarizeFailure(goto));
    }

    runCli(["snapshot", "--session-id", extensionLegacySessionId, "--mode", "actionables", "--max-chars", "6000"]);
    runCli(["perf", "--session-id", extensionLegacySessionId]);
    addResult(results, { id: "mode.extension_legacy_cdp", status: "pass" });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    addResult(results, {
      id: "mode.extension_legacy_cdp",
      status: isExtensionUnavailable(detail) ? "env_limited" : "fail",
      detail
    });
  } finally {
    if (extensionLegacySessionId) {
      runCli(["disconnect", "--session-id", extensionLegacySessionId], { allowFailure: true });
    }
  }

  // cdpConnect mode
  let cdpSessionId = null;
  let chromeProcess = null;
  let chromeProfileDir = null;
  try {
    const chromeCandidates = [
      process.env.CHROME_PATH,
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
      "/Applications/Chromium.app/Contents/MacOS/Chromium"
    ].filter(Boolean);
    const chromePath = chromeCandidates.find((candidate) => fs.existsSync(candidate));
    if (!chromePath) {
      throw new Error("No Chrome binary found for cdpConnect validation.");
    }

    const port = await getFreePort();
    chromeProfileDir = fs.mkdtempSync(path.join(os.tmpdir(), "opendevbrowser-live-cdp-"));
    chromeProcess = spawn(chromePath, [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${chromeProfileDir}`,
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "about:blank"
    ], { stdio: ["ignore", "ignore", "ignore"] });

    const ready = await waitForHttp(port, "/json/version", 30000);
    if (!ready) {
      throw new Error(`Remote debugging endpoint did not become ready on port ${port}.`);
    }

    const connect = runCli(["connect", "--host", "127.0.0.1", "--cdp-port", String(port)]);
    cdpSessionId = pickSessionId(connect);
    if (!cdpSessionId) {
      throw new Error("cdpConnect returned no sessionId.");
    }
    runCli(["goto", "--session-id", cdpSessionId, "--url", "https://example.com", "--wait-until", "load", "--timeout-ms", "30000"]);
    runCli(["wait", "--session-id", cdpSessionId, "--until", "load", "--timeout-ms", "30000"]);
    runCli(["snapshot", "--session-id", cdpSessionId, "--mode", "actionables", "--max-chars", "6000"]);
    runCli(["perf", "--session-id", cdpSessionId]);
    addResult(results, { id: "mode.cdp_connect", status: "pass" });
  } catch (error) {
    addResult(results, {
      id: "mode.cdp_connect",
      status: "fail",
      detail: error instanceof Error ? error.message : String(error)
    });
  } finally {
    if (cdpSessionId) {
      runCli(["disconnect", "--session-id", cdpSessionId], { allowFailure: true });
    }
    if (chromeProcess && !chromeProcess.killed) {
      chromeProcess.kill("SIGTERM");
    }
    if (chromeProfileDir && fs.existsSync(chromeProfileDir)) {
      try {
        fs.rmSync(chromeProfileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      } catch {
        // ignore cleanup races
      }
    }
  }

  // RPC checks
  for (const [id, args] of [
    ["feature.rpc.relay_status", ["rpc", "--unsafe-internal", "--name", "relay.status"]],
    ["feature.rpc.macro_resolve_execute", ["rpc", "--unsafe-internal", "--name", "macro.resolve", "--params", "{\"expression\":\"@web.search(\\\"openai\\\", 3)\",\"execute\":true}"]]
  ]) {
    try {
      runCli(args);
      addResult(results, { id, status: "pass" });
    } catch (error) {
      addResult(results, {
        id,
        status: "fail",
        detail: error instanceof Error ? error.message : String(error)
      });
    }
  }

  // Macro / research matrix
  const macroCases = [
    { id: "macro.web.search", expression: "@web.search(\"openai\", 3)" },
    { id: "macro.web.fetch", expression: "@web.fetch(\"https://example.com\")" },
    { id: "macro.developer.docs", expression: "@developer.docs(\"playwright locator\", 3)" },
    { id: "macro.community.search.url", expression: "@community.search(\"https://example.com\")" },
    { id: "macro.community.search.keyword", expression: "@community.search(\"openai\", 3)" },
    { id: "macro.media.search.reddit", expression: "@media.search(\"openai\", \"reddit\", 3)" },
    { id: "macro.media.search.x", expression: "@media.search(\"openai\", \"x\", 3)" },
    { id: "macro.media.trend.x", expression: "@media.trend(\"x\", \"ai\", 3)" },
    { id: "macro.media.search.linkedin", expression: "@media.search(\"openai\", \"linkedin\", 1)" }
  ];

  for (const macroCase of macroCases) {
    try {
      const result = runCli(["macro-resolve", "--execute", "--expression", macroCase.expression]);
      const execution = result.json?.data?.execution;
      const records = Array.isArray(execution?.records) ? execution.records.length : 0;
      const failures = Array.isArray(execution?.failures) ? execution.failures : [];
      const failureCodes = failures.map((item) => item?.error?.code).filter((value) => typeof value === "string");

      if (records > 0) {
        addResult(results, {
          id: macroCase.id,
          status: "pass",
          data: { records, failures: failures.length }
        });
        continue;
      }

      if (failures.length > 0 && failureCodes.length === failures.length && failureCodes.every((code) => code === "unavailable")) {
        addResult(results, {
          id: macroCase.id,
          status: "env_limited",
          detail: failures[0]?.error?.message ?? "Upstream unavailable",
          data: { records, failures: failures.length, failureCodes }
        });
        continue;
      }

      addResult(results, {
        id: macroCase.id,
        status: "fail",
        detail: failures[0]?.error?.message ?? "Execution returned no records.",
        data: { records, failures: failures.length, failureCodes }
      });
    } catch (error) {
      addResult(results, {
        id: macroCase.id,
        status: "fail",
        detail: error instanceof Error ? error.message : String(error)
      });
    }
  }

  // Resolve-only macro parity check for write action semantics
  try {
    const result = runCli(["macro-resolve", "--expression", "@social.post(\"x\", \"target\", \"content\", false, false)", "--include-catalog"]);
    const hasCatalog = Array.isArray(result.json?.data?.catalog);
    addResult(results, {
      id: "macro.social.post.resolve_only",
      status: hasCatalog ? "pass" : "fail",
      detail: hasCatalog ? undefined : "Missing macro catalog in resolve-only response."
    });
  } catch (error) {
    addResult(results, {
      id: "macro.social.post.resolve_only",
      status: "fail",
      detail: error instanceof Error ? error.message : String(error)
    });
  }

  // Annotation invocation (manual interaction expected, timeout acceptable)
  async function runAnnotateProbe(mode) {
    let sessionId = null;
    try {
      const launchArgs = mode === "relay"
        ? ["launch", "--extension-only", "--wait-for-extension", "--wait-timeout-ms", "30000"]
        : ["launch", "--no-extension", "--headless", "--start-url", "https://example.com"];
      const launch = runCli(launchArgs);
      sessionId = pickSessionId(launch);
      if (!sessionId) throw new Error("Annotation probe launch returned no sessionId.");

      const annotateArgs = [
        "annotate",
        "--session-id", sessionId,
        "--transport", mode,
        "--screenshot-mode", "none",
        "--timeout-ms", "8000",
        "--context", "Live regression matrix annotation probe"
      ];
      const annotate = runCli(annotateArgs, { allowFailure: true });
      if (annotate.status === 0 && annotate.json?.success === true) {
        addResult(results, { id: `feature.annotate.${mode}`, status: "pass" });
        return;
      }
      const detail = summarizeFailure(annotate);
      if (isTimeoutError(detail)) {
        addResult(results, {
          id: `feature.annotate.${mode}`,
          status: "expected_timeout",
          detail
        });
        return;
      }
      addResult(results, {
        id: `feature.annotate.${mode}`,
        status: "fail",
        detail
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      addResult(results, {
        id: `feature.annotate.${mode}`,
        status: mode === "relay" && isExtensionUnavailable(detail) ? "env_limited" : "fail",
        detail
      });
    } finally {
      if (sessionId) {
        const closeBrowser = mode === "direct" ? ["--close-browser"] : [];
        runCli(["disconnect", "--session-id", sessionId, ...closeBrowser], { allowFailure: true });
      }
    }
  }

  await runAnnotateProbe("relay");
  await runAnnotateProbe("direct");

  const summary = summarize(results, startedAt);
  const pretty = JSON.stringify(summary, null, 2);
  console.log(pretty);
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

runMatrix().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({
    ok: false,
    fatal: message
  }, null, 2));
  process.exitCode = 1;
});
