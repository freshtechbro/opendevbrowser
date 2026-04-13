#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const DEFAULT_RETRIES = 6;
const DEFAULT_DELAY_MS = 5000;
const LOOKUP_TERMS = [
  "screencast / browser replay",
  "desktop observation",
  "computer use / browser-scoped computer use"
];

function parsePositiveInt(value, label) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer, got ${value}`);
  }
  return parsed;
}

export function parseRegistryConsumerSmokeArgs(argv) {
  let version = "";
  let outputPath = "";
  let retries = DEFAULT_RETRIES;
  let delayMs = DEFAULT_DELAY_MS;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--version" && next) {
      version = next;
      index += 1;
      continue;
    }
    if (arg === "--output" && next) {
      outputPath = next;
      index += 1;
      continue;
    }
    if (arg === "--retries" && next) {
      retries = parsePositiveInt(next, "--retries");
      index += 1;
      continue;
    }
    if (arg === "--delay-ms" && next) {
      delayMs = parsePositiveInt(next, "--delay-ms");
      index += 1;
      continue;
    }
    throw new Error(`Unknown or incomplete argument: ${arg}`);
  }

  if (!version) {
    throw new Error("Missing required --version <x.y.z> argument.");
  }

  return { version, outputPath, retries, delayMs };
}

function sleep(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function trimOutput(value) {
  return value.trim() || "(empty)";
}

function runCommand(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: process.env
  });

  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? ""
  };
}

function writeJson(outputPath, value) {
  if (!outputPath) {
    return;
  }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function installPublishedPackage(version, cwd, retries, delayMs) {
  let lastFailure = "install did not run";

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const installResult = runCommand("npm", ["install", `opendevbrowser@${version}`], cwd);
    if (installResult.status === 0) {
      return attempt;
    }
    lastFailure = `${trimOutput(installResult.stderr)}\n${trimOutput(installResult.stdout)}`;
    if (attempt < retries) {
      await sleep(delayMs * attempt);
    }
  }

  throw new Error(`Registry install failed after ${retries} attempts.\n${lastFailure}`);
}

function parseJson(label, raw) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to parse ${label} JSON: ${message}`);
  }
}

export function summarizeDependencyGraph(tree) {
  const rootDeps = tree?.dependencies ?? {};
  const pkg = rootDeps.opendevbrowser ?? {};
  return {
    opendevbrowser: pkg.version ?? null,
    plugin: pkg.dependencies?.["@opencode-ai/plugin"]?.version ?? null,
    ws: pkg.dependencies?.ws?.version ?? null,
    zod: pkg.dependencies?.zod?.version ?? null,
    nestedPluginZod: pkg.dependencies?.["@opencode-ai/plugin"]?.dependencies?.zod?.version ?? null
  };
}

export function assertRegistryConsumerSmoke({
  version,
  helpText,
  helpAliasText,
  versionPayload,
  extensionDirExists,
  skillsDirExists
}) {
  if (helpText.trim() !== helpAliasText.trim()) {
    throw new Error("Registry consumer help alias diverged from --help output.");
  }

  if (!helpText.includes("Find It Fast:")) {
    throw new Error("Registry consumer help output is missing Find It Fast.");
  }

  for (const term of LOOKUP_TERMS) {
    if (!helpText.includes(term)) {
      throw new Error(`Registry consumer help output is missing lookup term: ${term}`);
    }
  }

  if (versionPayload?.success !== true || versionPayload?.message !== `opendevbrowser v${version}`) {
    throw new Error(`Registry consumer version output did not match ${version}.`);
  }

  if (!extensionDirExists) {
    throw new Error("Registry consumer install is missing packaged extension assets.");
  }

  if (!skillsDirExists) {
    throw new Error("Registry consumer install is missing packaged skills.");
  }
}

export async function runRegistryConsumerSmoke({
  version,
  outputPath = "",
  retries = DEFAULT_RETRIES,
  delayMs = DEFAULT_DELAY_MS
}) {
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "opendevbrowser-registry-consumer-"));
  const packageRoot = path.join(workdir, "node_modules", "opendevbrowser");

  const init = runCommand("npm", ["init", "-y"], workdir);
  if (init.status !== 0) {
    throw new Error(`Unable to initialize temp workspace.\n${trimOutput(init.stderr)}\n${trimOutput(init.stdout)}`);
  }
  const installAttempts = await installPublishedPackage(version, workdir, retries, delayMs);

  const help = runCommand("npx", ["--no-install", "opendevbrowser", "--help"], workdir);
  const helpAlias = runCommand("npx", ["--no-install", "opendevbrowser", "help"], workdir);
  const versionResult = runCommand("npx", ["--no-install", "opendevbrowser", "version", "--output-format", "json"], workdir);
  const dependencyTree = runCommand("npm", ["ls", "opendevbrowser", "@opencode-ai/plugin", "ws", "zod", "--all", "--json"], workdir);

  if (help.status !== 0 || helpAlias.status !== 0 || versionResult.status !== 0 || dependencyTree.status !== 0) {
    throw new Error(
      [
        `help status=${help.status}`,
        `help alias status=${helpAlias.status}`,
        `version status=${versionResult.status}`,
        `dependencyTree status=${dependencyTree.status}`
      ].join(", ")
    );
  }

  const versionPayload = parseJson("version", versionResult.stdout);
  const graphSummary = summarizeDependencyGraph(parseJson("dependency graph", dependencyTree.stdout));
  const extensionDirExists = fs.existsSync(path.join(packageRoot, "extension"));
  const skillsDirExists = fs.existsSync(path.join(packageRoot, "skills"));

  assertRegistryConsumerSmoke({
    version,
    helpText: help.stdout,
    helpAliasText: helpAlias.stdout,
    versionPayload,
    extensionDirExists,
    skillsDirExists
  });

  const result = {
    success: true,
    version,
    workdir,
    installAttempts,
    helpLineCount: help.stdout.split("\n").length,
    checks: {
      helpAliasMatches: true,
      findItFastPresent: true,
      extensionDirExists,
      skillsDirExists,
      versionMatches: true
    },
    consumerGraph: graphSummary
  };

  writeJson(outputPath, result);
  return result;
}

async function main() {
  const options = parseRegistryConsumerSmokeArgs(process.argv.slice(2));

  try {
    const result = await runRegistryConsumerSmoke(options);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    const failure = {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
    writeJson(options.outputPath, failure);
    console.log(JSON.stringify(failure, null, 2));
    process.exit(1);
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main();
}
