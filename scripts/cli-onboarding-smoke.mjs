#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { INSTALL_AUTOSTART_SKIP_ENV_VAR } from "./live-direct-utils.mjs";
import {
  ensureCli,
  getFreePort,
  runCli,
  startDaemon,
  terminateChild
} from "./cli-smoke-test.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ONBOARDING_METADATA = JSON.parse(
  fs.readFileSync(path.join(ROOT, "src", "cli", "onboarding-metadata.json"), "utf8")
);

export function assertOnboardingHelp(helpText, metadata = ONBOARDING_METADATA) {
  const requiredTerms = [
    `${metadata.sectionTitle}:`,
    metadata.sectionSummary,
    metadata.quickStartCommands.promptingGuide,
    metadata.quickStartCommands.skillLoad,
    metadata.quickStartCommands.skillList,
    metadata.quickStartCommands.happyPath,
    metadata.referencePaths.onboardingDoc,
    metadata.referencePaths.skillDoc
  ];

  for (const term of requiredTerms) {
    if (!helpText.includes(term)) {
      throw new Error(`Help output is missing onboarding guidance: ${term}`);
    }
  }
}

export function assertQuickStartGuide(guide, metadata = ONBOARDING_METADATA) {
  if (guide.includes("## Fast Start")) {
    throw new Error("Quick-start guide still uses the stale Fast Start heading.");
  }
  const normalized = guide.toLowerCase();
  if (!normalized.includes(metadata.skillTopic)) {
    throw new Error(`Quick-start guide is missing topic ${metadata.skillTopic}.`);
  }
}

const ISOLATED_SKILL_ENV_KEYS = [
  "OPENCODE_CONFIG_DIR",
  "CODEX_HOME",
  "CLAUDECODE_HOME",
  "CLAUDE_HOME",
  "AMPCLI_HOME",
  "AMP_CLI_HOME",
  "AMP_HOME"
];

async function withTemporaryEnv(overrides, fn) {
  const previous = new Map();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return await fn();
  } finally {
    for (const key of Object.keys(overrides)) {
      const value = previous.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function buildIsolatedSkillEnv(tempRoot, configDir) {
  const codexHome = path.join(tempRoot, ".codex");
  const claudeHome = path.join(tempRoot, ".claude");
  const ampHome = path.join(tempRoot, ".amp");
  return {
    OPENCODE_CONFIG_DIR: configDir,
    CODEX_HOME: codexHome,
    CLAUDECODE_HOME: claudeHome,
    CLAUDE_HOME: claudeHome,
    AMPCLI_HOME: ampHome,
    AMP_CLI_HOME: ampHome,
    AMP_HOME: ampHome
  };
}

export async function loadQuickStartGuide(
  rootDir = ROOT,
  metadata = ONBOARDING_METADATA,
  envOverrides = {}
) {
  const moduleUrl = pathToFileURL(path.join(ROOT, "dist", "skills", "skill-loader.js")).href;
  const { SkillLoader } = await import(moduleUrl);
  const overrides = Object.fromEntries(
    ISOLATED_SKILL_ENV_KEYS.map((key) => [key, envOverrides[key]])
  );
  return withTemporaryEnv(overrides, async () => {
    const loader = new SkillLoader(rootDir);
    return loader.loadSkill(metadata.skillName, metadata.skillTopic);
  });
}

function buildOnboardingDataUrl() {
  const html = `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>OpenDevBrowser Onboarding Smoke</title>
  </head>
  <body>
    <main>
      <h1>OpenDevBrowser Onboarding Smoke</h1>
      <button id="action">Continue</button>
    </main>
  </body>
</html>
  `.trim();
  return `data:text/html,${encodeURIComponent(html)}`;
}

export async function runCliOnboardingSmoke() {
  ensureCli();

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opendevbrowser-onboarding-"));
  const configDir = path.join(tempRoot, "config");
  const cacheDir = path.join(tempRoot, "cache");
  const daemonPort = await getFreePort();
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(cacheDir, { recursive: true });

  const relayToken = randomUUID().replaceAll("-", "");
  const daemonToken = randomUUID().replaceAll("-", "");
  fs.writeFileSync(
    path.join(configDir, "opendevbrowser.jsonc"),
    `{
  "relayPort": 8787,
  "relayToken": "${relayToken}",
  "daemonPort": ${daemonPort},
  "daemonToken": "${daemonToken}",
  "headless": true,
  "persistProfile": false
}
`,
    { encoding: "utf8", mode: 0o600 }
  );

  const env = {
    ...process.env,
    OPENCODE_CONFIG_DIR: configDir,
    OPENCODE_CACHE_DIR: cacheDir,
    [INSTALL_AUTOSTART_SKIP_ENV_VAR]: "1"
  };

  const help = runCli(["--help"], { env, rawOutput: true });
  const helpAlias = runCli(["help"], { env, rawOutput: true });
  if (help.status !== 0 || helpAlias.status !== 0) {
    throw new Error("Help commands failed during onboarding smoke.");
  }
  if (help.stdout.trim() !== helpAlias.stdout.trim()) {
    throw new Error("`--help` and `help` outputs diverged.");
  }
  assertOnboardingHelp(help.stdout);

  const guide = await loadQuickStartGuide(ROOT, ONBOARDING_METADATA, buildIsolatedSkillEnv(tempRoot, configDir));
  assertQuickStartGuide(guide);

  const daemon = await startDaemon(env, daemonPort);
  let sessionId = null;
  try {
    runCli(["status", "--daemon"], { env });

    const dataUrl = buildOnboardingDataUrl();
    const launch = runCli([
      "launch",
      "--no-extension",
      "--headless",
      "--start-url",
      dataUrl
    ], { env });
    sessionId = launch.json?.data?.sessionId ?? null;
    if (!sessionId) {
      throw new Error("Missing sessionId from onboarding launch.");
    }

    runCli(["goto", "--session-id", sessionId, "--url", dataUrl], { env });
    const snapshot = runCli([
      "snapshot",
      "--session-id",
      sessionId,
      "--mode",
      "actionables",
      "--max-chars",
      "2000"
    ], { env });
    const content = snapshot.json?.data?.content ?? "";
    if (!content.includes("Continue")) {
      throw new Error("Onboarding happy path did not produce the expected actionable snapshot.");
    }

    runCli(["disconnect", "--session-id", sessionId, "--close-browser"], { env });
    sessionId = null;
  } finally {
    if (sessionId) {
      runCli(["disconnect", "--session-id", sessionId, "--close-browser"], { env, allowFailure: true });
    }
    runCli(["serve", "--stop"], { env, allowFailure: true });
    await terminateChild(daemon);
  }

  console.log("CLI onboarding smoke test completed.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCliOnboardingSmoke().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
