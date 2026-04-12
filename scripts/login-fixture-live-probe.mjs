#!/usr/bin/env node
import http from "node:http";
import { URLSearchParams } from "node:url";
import {
  defaultArtifactPath,
  finalizeReport,
  pushStep,
  runCliAsync,
  sleep,
  writeJson
} from "./live-direct-utils.mjs";
import {
  closeHttpFixtureServer,
  extractRefByPattern,
  extractTextMarker,
  startHttpFixtureServer,
  withTempHarness
} from "./skill-runtime-probe-utils.mjs";

const HELP_TEXT = [
  "Usage: node scripts/login-fixture-live-probe.mjs [options]",
  "",
  "Options:",
  "  --out <path>   Output JSON path",
  "  --quiet        Suppress per-step progress logging",
  "  --help         Show help"
].join("\n");

const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX1QAAAAASUVORK5CYII=",
  "base64"
);

export const INVALID_BRANCH_SETTLE_MS = 250;
export const FIXTURE_NAVIGATION_TIMEOUT_MS = 15_000;

export function parseArgs(argv) {
  const options = {
    out: defaultArtifactPath("odb-login-fixture-live-probe"),
    quiet: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help") {
      console.log(HELP_TEXT);
      process.exit(0);
    }
    if (arg === "--quiet") {
      options.quiet = true;
      continue;
    }
    if (arg === "--out") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("--out requires a file path.");
      }
      options.out = next;
      index += 1;
      continue;
    }
    if (arg.startsWith("--out=")) {
      options.out = arg.slice("--out=".length);
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

export function shouldWaitForLoadAfterSubmit(branch) {
  return branch !== "invalid-credentials";
}

export function buildFixtureGotoArgs(sessionId, url) {
  return [
    "goto",
    "--session-id",
    sessionId,
    "--url",
    url,
    "--wait-until",
    "load",
    "--timeout-ms",
    String(FIXTURE_NAVIGATION_TIMEOUT_MS)
  ];
}

export function buildFixtureLoadWaitArgs(sessionId) {
  return [
    "wait",
    "--session-id",
    sessionId,
    "--until",
    "load",
    "--timeout-ms",
    String(FIXTURE_NAVIGATION_TIMEOUT_MS)
  ];
}

function renderLayout(content, { title = "Fixture Login", error = "", action = "/login" } = {}) {
  const errorMarkup = error
    ? `<p id="error-message" role="alert" aria-live="assertive">${error}</p>`
    : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>${title}</title>
    <style>
      body { font-family: sans-serif; margin: 0; background: #f5f7fb; color: #14213d; }
      main { max-width: 720px; margin: 0 auto; padding: 32px 24px 48px; position: relative; }
      #pointer-target { position: absolute; left: 40px; top: 72px; width: 170px; height: 44px; border: 1px solid #243b53; background: #fff; }
      #pointer-status { position: absolute; left: 230px; top: 80px; width: 180px; font-weight: 600; border: 0; background: transparent; color: #14213d; }
      #drag-shell { position: absolute; left: 40px; top: 132px; width: 260px; }
      #drag-shell .hint { margin: 12px 0 0; }
      #drag-rail { position: relative; width: 240px; height: 24px; border-radius: 999px; background: #dce7f3; border: 1px solid #9fb3c8; }
      #drag-knob { position: absolute; left: 0; top: -4px; width: 32px; height: 32px; border-radius: 50%; background: #1f6feb; }
      form { margin-top: 220px; display: grid; gap: 12px; background: #fff; padding: 24px; border-radius: 16px; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08); }
      label { font-weight: 600; display: grid; gap: 6px; }
      input { padding: 10px 12px; font-size: 16px; border-radius: 10px; border: 1px solid #9fb3c8; }
      button[type="submit"] { padding: 12px 16px; font-size: 16px; font-weight: 600; border: 0; border-radius: 12px; background: #1f6feb; color: #fff; }
      .hint { color: #52606d; font-size: 14px; }
      #success-banner { color: #0b6e4f; font-weight: 700; }
      #error-message { color: #b42318; font-weight: 700; }
      img { max-width: 100%; }
    </style>
  </head>
  <body>
    <main>
      <button id="pointer-target" type="button">Pointer target</button>
      <input id="pointer-status" type="text" aria-label="Pointer status" value="pointer-idle" readonly>
      <div id="drag-shell">
        <div id="drag-rail" aria-label="Pointer drag rail">
          <div id="drag-knob"></div>
        </div>
        <p class="hint">Drag the handle right to complete the pointer check.</p>
      </div>
      ${content}
      ${errorMarkup}
      <script>
        (() => {
          const status = document.getElementById("pointer-status");
          const target = document.getElementById("pointer-target");
          const rail = document.getElementById("drag-rail");
          const knob = document.getElementById("drag-knob");
          let dragging = false;
          let knobX = 0;
          const setStatus = (value) => {
            status.value = value;
            status.setAttribute("value", value);
            document.body.dataset.pointerStatus = value;
          };
          target.addEventListener("pointerup", () => setStatus("tap-complete"));
          rail.addEventListener("pointerdown", (event) => {
            dragging = true;
            knobX = Math.max(0, Math.min(event.clientX - rail.getBoundingClientRect().left, 208));
            knob.style.left = knobX + "px";
            setStatus("drag-started");
          });
          window.addEventListener("pointermove", (event) => {
            if (!dragging) return;
            knobX = Math.max(0, Math.min(event.clientX - rail.getBoundingClientRect().left, 208));
            knob.style.left = knobX + "px";
            if (knobX > 120) {
              setStatus("drag-progress");
            }
          });
          window.addEventListener("pointerup", () => {
            if (!dragging) return;
            dragging = false;
            if (knobX > 150) {
              setStatus("drag-complete");
            } else {
              setStatus("drag-reset");
              knob.style.left = "0px";
            }
          });
        })();
      </script>
    </main>
  </body>
</html>`;
}

function loginPage(error = "") {
  return renderLayout(
    `<h1>Fixture Login</h1>
      <p class="hint">Use <strong>demo@example.com</strong> for direct success or <strong>mfa@example.com</strong> for the MFA path.</p>
      <form method="post" action="/login">
        <label>Email
          <input name="email" type="email" aria-label="Email" autocomplete="username">
        </label>
        <label>Password
          <input name="password" type="password" aria-label="Password" autocomplete="current-password">
        </label>
        <button type="submit">Sign in</button>
      </form>`,
    { error }
  );
}

function mfaPage(error = "") {
  return renderLayout(
    `<h1>Enter the 6-digit code</h1>
      <p class="hint">Use <strong>123456</strong> to complete the step-up flow.</p>
      <form method="post" action="/mfa">
        <label>Verification code
          <input name="code" type="text" aria-label="Verification code" inputmode="numeric">
        </label>
        <button type="submit">Verify code</button>
      </form>`,
    { title: "Fixture MFA", error }
  );
}

function dashboardPage() {
  return renderLayout(
    `<h1>Dashboard Ready</h1>
      <p id="success-banner">Authenticated state confirmed.</p>
      <img src="/assets/verified.png" alt="Verified account badge">
      <form method="post" action="/logout">
        <button type="submit">Sign out</button>
      </form>`,
    { title: "Fixture Dashboard" }
  );
}

function createLoginFixtureServer() {
  return http.createServer(async (request, response) => {
    const method = request.method ?? "GET";
    const url = new URL(request.url ?? "/", "http://127.0.0.1");

    if (url.pathname === "/assets/verified.png") {
      response.writeHead(200, {
        "content-type": "image/png",
        "content-length": PNG_BYTES.length
      });
      response.end(PNG_BYTES);
      return;
    }

    if (method === "GET" && url.pathname === "/") {
      response.writeHead(302, { location: "/login" });
      response.end();
      return;
    }

    if (method === "GET" && url.pathname === "/login") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(loginPage());
      return;
    }

    if (method === "POST" && url.pathname === "/login") {
      const chunks = [];
      for await (const chunk of request) {
        chunks.push(chunk);
      }
      const body = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
      const email = body.get("email");
      const password = body.get("password");

      if (email === "demo@example.com" && password === "Secret123!") {
        response.writeHead(303, {
          location: "/dashboard",
          "set-cookie": "fixture_auth=ok; Path=/; HttpOnly"
        });
        response.end();
        return;
      }

      if (email === "mfa@example.com" && password === "Secret123!") {
        response.writeHead(303, {
          location: "/mfa",
          "set-cookie": "fixture_stage=mfa; Path=/; HttpOnly"
        });
        response.end();
        return;
      }

      response.writeHead(401, { "content-type": "text/html; charset=utf-8" });
      response.end(loginPage("Invalid email or password."));
      return;
    }

    if (method === "GET" && url.pathname === "/mfa") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(mfaPage());
      return;
    }

    if (method === "POST" && url.pathname === "/mfa") {
      const chunks = [];
      for await (const chunk of request) {
        chunks.push(chunk);
      }
      const body = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
      const code = body.get("code");
      if (code === "123456") {
        response.writeHead(303, {
          location: "/dashboard",
          "set-cookie": "fixture_auth=ok; Path=/; HttpOnly"
        });
        response.end();
        return;
      }

      response.writeHead(401, { "content-type": "text/html; charset=utf-8" });
      response.end(mfaPage("Incorrect verification code."));
      return;
    }

    if (method === "GET" && url.pathname === "/dashboard") {
      if (!String(request.headers.cookie ?? "").includes("fixture_auth=ok")) {
        response.writeHead(302, { location: "/login" });
        response.end();
        return;
      }
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(dashboardPage());
      return;
    }

    if (method === "POST" && url.pathname === "/logout") {
      response.writeHead(303, {
        location: "/login",
        "set-cookie": "fixture_auth=; Path=/; Max-Age=0"
      });
      response.end();
      return;
    }

    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("not found");
  });
}

async function runProbe(options) {
  const report = {
    startedAt: new Date().toISOString(),
    out: options.out,
    steps: []
  };

  await withTempHarness("odb-login-fixture", async ({ env }) => {
    const { server, baseUrl } = await startHttpFixtureServer(createLoginFixtureServer);
    let sessionId = null;
    try {
      pushStep(report, {
        id: "fixture.server",
        status: "pass",
        detail: null,
        data: { baseUrl }
      }, { prefix: "[login-fixture]", logProgress: !options.quiet });

      const daemonStatus = await runCliAsync(["status", "--daemon"], {
        env,
        allowFailure: true,
        timeoutMs: 10_000
      });
      pushStep(report, {
        id: "infra.daemon_status",
        status: daemonStatus.status === 0 ? "pass" : "fail",
        detail: daemonStatus.status === 0 ? null : daemonStatus.detail
      }, { prefix: "[login-fixture]", logProgress: !options.quiet });
      if (daemonStatus.status !== 0) {
        return;
      }

      const launch = await runCliAsync([
        "launch",
        "--no-extension",
        "--headless",
        "--start-url",
        `${baseUrl}/login`,
        "--no-interactive"
      ], { env });
      sessionId = launch.json?.data?.sessionId ?? null;
      pushStep(report, {
        id: "workflow.launch",
        status: sessionId ? "pass" : "fail",
        detail: sessionId ? null : "Missing sessionId from launch."
      }, { prefix: "[login-fixture]", logProgress: !options.quiet });
      if (!sessionId) {
        return;
      }

      const initialSnapshot = await runCliAsync([
        "snapshot",
        "--session-id",
        sessionId,
        "--mode",
        "actionables",
        "--max-chars",
        "6000"
      ], { env });
      const initialContent = initialSnapshot.json?.data?.content ?? "";
      const emailRef = extractRefByPattern(initialContent, /\btextbox\b.*email/i);
      const passwordRef = extractRefByPattern(initialContent, /\btextbox\b.*password/i);
      const submitRef = extractRefByPattern(initialContent, /\bbutton\b.*sign in/i);
      pushStep(report, {
        id: "workflow.refs_ready",
        status: emailRef && passwordRef && submitRef ? "pass" : "fail",
        detail: emailRef && passwordRef && submitRef ? null : "Failed to resolve login form refs."
      }, { prefix: "[login-fixture]", logProgress: !options.quiet });
      if (!emailRef || !passwordRef || !submitRef) {
        return;
      }

      await runCliAsync(["pointer-move", "--session-id", sessionId, "--x", "96", "--y", "96", "--steps", "4"], { env });
      await runCliAsync(["pointer-down", "--session-id", sessionId, "--x", "96", "--y", "96"], { env });
      await runCliAsync(["pointer-up", "--session-id", sessionId, "--x", "96", "--y", "96"], { env });
      await runCliAsync([
        "pointer-drag",
        "--session-id",
        sessionId,
        "--from-x",
        "72",
        "--from-y",
        "154",
        "--to-x",
        "252",
        "--to-y",
        "154",
        "--steps",
        "16"
      ], { env });
      await sleep(150);
      let postPointerActionables = await runCliAsync([
        "snapshot",
        "--session-id",
        sessionId,
        "--mode",
        "actionables",
        "--max-chars",
        "6000"
      ], { env });
      let pointerContent = postPointerActionables.json?.data?.content ?? "";
      const pointerStatusRef = extractRefByPattern(pointerContent, /\btextbox\b.*pointer status/i);
      const pointerStatus = pointerStatusRef
        ? await runCliAsync(["dom-value", "--session-id", sessionId, "--ref", pointerStatusRef], { env })
        : null;
      let pointerStatusValue = typeof pointerStatus?.json?.data?.value === "string"
        ? pointerStatus.json.data.value
        : null;
      let fallbackPointerStatusValue = null;
      if (pointerStatusValue !== "drag-complete") {
        await runCliAsync(["pointer-move", "--session-id", sessionId, "--x", "72", "--y", "154", "--steps", "2"], { env });
        await runCliAsync(["pointer-down", "--session-id", sessionId, "--x", "72", "--y", "154"], { env });
        await runCliAsync(["pointer-move", "--session-id", sessionId, "--x", "252", "--y", "154", "--steps", "16"], { env });
        await runCliAsync(["pointer-up", "--session-id", sessionId, "--x", "252", "--y", "154"], { env });
        await sleep(150);
        postPointerActionables = await runCliAsync([
          "snapshot",
          "--session-id",
          sessionId,
          "--mode",
          "actionables",
          "--max-chars",
          "6000"
        ], { env });
        pointerContent = postPointerActionables.json?.data?.content ?? "";
        const fallbackStatusRef = extractRefByPattern(pointerContent, /\btextbox\b.*pointer status/i);
        const fallbackStatus = fallbackStatusRef
          ? await runCliAsync(["dom-value", "--session-id", sessionId, "--ref", fallbackStatusRef], { env })
          : null;
        fallbackPointerStatusValue = typeof fallbackStatus?.json?.data?.value === "string"
          ? fallbackStatus.json.data.value
          : null;
      }
      pushStep(report, {
        id: "workflow.pointer_controls",
        status: pointerStatusValue === "drag-complete" ? "pass" : "fail",
        detail: pointerStatusValue === "drag-complete"
          ? null
          : "Pointer controls did not complete the drag interaction.",
        data: {
          pointerStatus: pointerStatusValue,
          fallbackPointerStatus: fallbackPointerStatusValue
        }
      }, { prefix: "[login-fixture]", logProgress: !options.quiet });

      const postPointerContent = pointerContent;
      const currentEmailRef = extractRefByPattern(postPointerContent, /\btextbox\b.*email/i);
      const currentPasswordRef = extractRefByPattern(postPointerContent, /\btextbox\b.*password/i);
      const currentSubmitRef = extractRefByPattern(postPointerContent, /\bbutton\b.*sign in/i);
      pushStep(report, {
        id: "workflow.refs_after_pointer",
        status: currentEmailRef && currentPasswordRef && currentSubmitRef ? "pass" : "fail",
        detail: currentEmailRef && currentPasswordRef && currentSubmitRef ? null : "Failed to refresh login form refs after pointer interactions."
      }, { prefix: "[login-fixture]", logProgress: !options.quiet });
      if (!currentEmailRef || !currentPasswordRef || !currentSubmitRef) {
        return;
      }

      await runCliAsync(["type", "--session-id", sessionId, "--ref", currentEmailRef, "--text", "wrong@example.com", "--clear"], { env });
      await runCliAsync(["type", "--session-id", sessionId, "--ref", currentPasswordRef, "--text", "bad-password", "--clear"], { env });
      await runCliAsync(["click", "--session-id", sessionId, "--ref", currentSubmitRef], { env });
      if (shouldWaitForLoadAfterSubmit("invalid-credentials")) {
        await runCliAsync(buildFixtureLoadWaitArgs(sessionId), { env });
      } else {
        await sleep(INVALID_BRANCH_SETTLE_MS);
      }
      const invalidSnapshot = await runCliAsync([
        "snapshot",
        "--session-id",
        sessionId,
        "--mode",
        "outline",
        "--max-chars",
        "5000"
      ], { env });
      const invalidNetwork = await runCliAsync([
        "network-poll",
        "--session-id",
        sessionId,
        "--since-seq",
        "0",
        "--max",
        "50"
      ], { env });
      const invalidUiOk = extractTextMarker(invalidSnapshot.json?.data?.content, /invalid email or password/i);
      const invalidNetworkText = JSON.stringify(invalidNetwork.json ?? {});
      const invalidNetworkOk = /401/.test(invalidNetworkText);
      const invalidBranchOk = invalidUiOk || invalidNetworkOk;
      pushStep(report, {
        id: "workflow.invalid_credentials",
        status: invalidBranchOk ? "pass" : "fail",
        detail: invalidBranchOk ? null : "Invalid credential branch did not render the expected error UI.",
        data: {
          invalidUiOk,
          invalidNetworkOk
        }
      }, { prefix: "[login-fixture]", logProgress: !options.quiet });

      const mfaActionables = await runCliAsync([
        "snapshot",
        "--session-id",
        sessionId,
        "--mode",
        "actionables",
        "--max-chars",
        "6000"
      ], { env });
      const mfaContent = mfaActionables.json?.data?.content ?? "";
      const mfaEmailRef = extractRefByPattern(mfaContent, /\btextbox\b.*email/i);
      const mfaPasswordRef = extractRefByPattern(mfaContent, /\btextbox\b.*password/i);
      const mfaSubmitRef = extractRefByPattern(mfaContent, /\bbutton\b.*sign in/i);
      if (!mfaEmailRef || !mfaPasswordRef || !mfaSubmitRef) {
        pushStep(report, {
          id: "workflow.mfa_refs_ready",
          status: "fail",
          detail: "Failed to resolve MFA login refs."
        }, { prefix: "[login-fixture]", logProgress: !options.quiet });
        return;
      }

      await runCliAsync(["type", "--session-id", sessionId, "--ref", mfaEmailRef, "--text", "mfa@example.com", "--clear"], { env });
      await runCliAsync(["type", "--session-id", sessionId, "--ref", mfaPasswordRef, "--text", "Secret123!", "--clear"], { env });
      await runCliAsync(["click", "--session-id", sessionId, "--ref", mfaSubmitRef], { env });
      await runCliAsync(buildFixtureLoadWaitArgs(sessionId), { env });
      const otpActionables = await runCliAsync([
        "snapshot",
        "--session-id",
        sessionId,
        "--mode",
        "actionables",
        "--max-chars",
        "6000"
      ], { env });
      const otpContent = otpActionables.json?.data?.content ?? "";
      const codeRef = extractRefByPattern(otpContent, /\btextbox\b.*verification code/i);
      const verifyRef = extractRefByPattern(otpContent, /\bbutton\b.*verify code/i);
      const mfaPromptOk = extractTextMarker(otpContent, /verification code|6-digit code/i);
      pushStep(report, {
        id: "workflow.mfa_branch",
        status: codeRef && verifyRef && mfaPromptOk ? "pass" : "fail",
        detail: codeRef && verifyRef && mfaPromptOk ? null : "MFA branch did not render expected prompt."
      }, { prefix: "[login-fixture]", logProgress: !options.quiet });
      if (!codeRef || !verifyRef) {
        return;
      }

      await runCliAsync(["type", "--session-id", sessionId, "--ref", codeRef, "--text", "123456", "--clear"], { env });
      await runCliAsync(["click", "--session-id", sessionId, "--ref", verifyRef], { env });
      await runCliAsync(buildFixtureLoadWaitArgs(sessionId), { env });
      const dashboardSnapshot = await runCliAsync([
        "snapshot",
        "--session-id",
        sessionId,
        "--mode",
        "outline",
        "--max-chars",
        "5000"
      ], { env });
      const successNetwork = await runCliAsync([
        "network-poll",
        "--session-id",
        sessionId,
        "--since-seq",
        "0",
        "--max",
        "80"
      ], { env });
      const dashboardOk = extractTextMarker(dashboardSnapshot.json?.data?.content, /dashboard ready|authenticated state confirmed/i)
        && /dashboard/.test(JSON.stringify(successNetwork.json ?? {}));
      pushStep(report, {
        id: "workflow.mfa_success",
        status: dashboardOk ? "pass" : "fail",
        detail: dashboardOk ? null : "MFA success branch did not reach the authenticated dashboard."
      }, { prefix: "[login-fixture]", logProgress: !options.quiet });

      await runCliAsync(buildFixtureGotoArgs(sessionId, `${baseUrl}/dashboard`), { env });
      await sleep(INVALID_BRANCH_SETTLE_MS);
      const persistenceSnapshot = await runCliAsync([
        "snapshot",
        "--session-id",
        sessionId,
        "--mode",
        "outline",
        "--max-chars",
        "4000"
      ], { env });
      pushStep(report, {
        id: "workflow.session_persistence",
        status: extractTextMarker(persistenceSnapshot.json?.data?.content, /dashboard ready/i) ? "pass" : "fail",
        detail: extractTextMarker(persistenceSnapshot.json?.data?.content, /dashboard ready/i)
          ? null
          : "Authenticated state was not preserved on dashboard revisit."
      }, { prefix: "[login-fixture]", logProgress: !options.quiet });
    } catch (error) {
      pushStep(report, {
        id: "workflow.exception",
        status: "fail",
        detail: error instanceof Error ? error.message : String(error)
      }, { prefix: "[login-fixture]", logProgress: !options.quiet });
    } finally {
      if (sessionId) {
        await runCliAsync(["disconnect", "--session-id", sessionId, "--close-browser"], {
          env,
          allowFailure: true,
          timeoutMs: 60_000
        });
      }
      await closeHttpFixtureServer(server);
    }
  });

  finalizeReport(report);
  writeJson(options.out, report);
  return report;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = await runProbe(options);
  console.log(JSON.stringify({
    ok: report.ok,
    counts: report.counts,
    summary: {
      status: report.ok ? "pass" : "fail",
      artifactPath: options.out
    }
  }, null, 2));
  if (!report.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
