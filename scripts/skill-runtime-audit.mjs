#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  CLI,
  DEFAULT_CLI_TIMEOUT_MS,
  DEFAULT_NODE_TIMEOUT_MS,
  INSTALL_AUTOSTART_SKIP_ENV_VAR,
  ROOT,
  classifyRecords,
  defaultArtifactPath,
  ensureCliBuilt,
  finalizeReport,
  normalizedCodesFromFailures,
  parseJsonFromStdout,
  summarizeFailure,
  writeJson
} from "./live-direct-utils.mjs";
import {
  getAuditDomains,
  getCanonicalSkillRuntimePacks,
  getRuntimeFamilies,
  loadSkillRuntimeMatrix,
  SKILL_RUNTIME_SHARED_LANES
} from "./skill-runtime-scenarios.mjs";
import {
  withConfiguredDaemon,
  withTempHarness
} from "./skill-runtime-probe-utils.mjs";

const HELP_TEXT = [
  "Usage: node scripts/skill-runtime-audit.mjs [options]",
  "",
  "Options:",
  "  --smoke        Run the reduced audit profile",
  "  --out <path>   Output JSON path",
  "  --quiet        Suppress per-lane progress logging",
  "  --help         Show help"
].join("\n");

const SHELL = process.env.SHELL || "/bin/zsh";

function parseArgs(argv) {
  const options = {
    smoke: false,
    quiet: false,
    out: null
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help") {
      console.log(HELP_TEXT);
      process.exit(0);
    }
    if (arg === "--smoke") {
      options.smoke = true;
      continue;
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
      options.out = resolveArtifactPath(next);
      index += 1;
      continue;
    }
    if (arg.startsWith("--out=")) {
      const value = arg.slice("--out=".length);
      if (!value) {
        throw new Error("--out requires a file path.");
      }
      options.out = resolveArtifactPath(value);
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  const mode = options.smoke ? "smoke" : "full";
  return {
    ...options,
    mode,
    out: options.out ?? path.join(ROOT, "artifacts", "skill-runtime-audit", `${mode}.json`)
  };
}

function resolveArtifactPath(value) {
  return path.isAbsolute(value) ? value : path.resolve(ROOT, value);
}

function laneArtifactPath(reportOut, laneId) {
  return path.join(path.dirname(reportOut), "lanes", `${laneId}.json`);
}

function ensureDir(targetPath) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
}

function logProgress(options, message) {
  if (!options.quiet) {
    console.error(`[skill-runtime-audit] ${message}`);
  }
}

function readJsonIfExists(targetPath) {
  if (!fs.existsSync(targetPath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(targetPath, "utf8"));
}

function runNodeAtCwd(args, {
  cwd = ROOT,
  env = process.env,
  timeoutMs = DEFAULT_NODE_TIMEOUT_MS,
  allowFailure = false
} = {}) {
  const result = spawnSync(process.execPath, args, {
    cwd,
    env,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024
  });
  const status = result.status ?? (result.signal ? 1 : 0);
  const payload = {
    status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    json: parseJsonFromStdout(result.stdout ?? ""),
    timedOut: result.error?.code === "ETIMEDOUT",
    signal: result.signal ?? null,
    ...(result.error ? { error: String(result.error) } : {})
  };
  payload.detail = payload.timedOut
    ? `Node script timed out after ${timeoutMs}ms (${args.join(" ")}).`
    : summarizeFailure(payload);
  if (!allowFailure && payload.status !== 0) {
    throw new Error(payload.detail);
  }
  return payload;
}

function runCliAtCwd(args, {
  cwd = ROOT,
  env = process.env,
  timeoutMs = DEFAULT_CLI_TIMEOUT_MS,
  allowFailure = false
} = {}) {
  const finalArgs = args.some((arg) => arg === "--output-format" || arg.startsWith("--output-format="))
    ? args
    : [...args, "--output-format", "json"];
  const result = spawnSync(process.execPath, [CLI, ...finalArgs], {
    cwd,
    env,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024
  });
  const status = result.status ?? (result.signal ? 1 : 0);
  const payload = {
    status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    json: parseJsonFromStdout(result.stdout ?? ""),
    timedOut: result.error?.code === "ETIMEDOUT",
    signal: result.signal ?? null,
    ...(result.error ? { error: String(result.error) } : {})
  };
  payload.detail = payload.timedOut
    ? `CLI timed out after ${timeoutMs}ms (${finalArgs.join(" ")}).`
    : summarizeFailure(payload);
  if (!allowFailure && payload.status !== 0) {
    throw new Error(payload.detail);
  }
  return payload;
}

function runShell(command, {
  cwd = ROOT,
  env = process.env,
  timeoutMs = DEFAULT_NODE_TIMEOUT_MS,
  allowFailure = false
} = {}) {
  const result = spawnSync(SHELL, ["-lc", command], {
    cwd,
    env,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024
  });
  const status = result.status ?? (result.signal ? 1 : 0);
  const payload = {
    status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    timedOut: result.error?.code === "ETIMEDOUT",
    signal: result.signal ?? null,
    ...(result.error ? { error: String(result.error) } : {})
  };
  payload.detail = payload.timedOut
    ? `Shell command timed out after ${timeoutMs}ms (${command}).`
    : payload.stderr || payload.stdout || payload.error || "Unknown failure";
  if (!allowFailure && payload.status !== 0) {
    throw new Error(payload.detail);
  }
  return payload;
}

function countObservedExternalConstraints(counts) {
  if (!counts || typeof counts !== "object") {
    return 0;
  }
  return (counts.env_limited ?? 0) + (counts.expected_timeout ?? 0);
}

export function shouldUseConfiguredAuditEnv(laneId, options) {
  return options.smoke !== true && (laneId === "provider-direct" || laneId === "live-regression");
}

function summarizeConstraintEntry(entry) {
  const constraintCount = countObservedExternalConstraints(entry.counts);
  if (constraintCount === 0) {
    return null;
  }
  return {
    id: entry.id,
    detail: entry.detail ?? null,
    artifactPath: entry.artifactPath ?? null,
    constraintCount,
    envLimitedCount: entry.counts?.env_limited ?? 0,
    expectedTimeoutCount: entry.counts?.expected_timeout ?? 0
  };
}

export function normalizeLaneStatus(counts, defaultStatus = "pass") {
  if (!counts || typeof counts !== "object") {
    return defaultStatus;
  }
  if ((counts.fail ?? 0) > 0) {
    return "fail";
  }
  if ((counts.pass ?? 0) > 0) {
    return "pass";
  }
  if ((counts.env_limited ?? 0) > 0 || (counts.expected_timeout ?? 0) > 0) {
    return "env_limited";
  }
  if ((counts.skipped ?? 0) > 0) {
    return "skipped";
  }
  return defaultStatus;
}

export function summarizeJsonLane(id, label, laneJson, fallbackArtifactPath = null) {
  const counts = laneJson?.counts ?? null;
  const status = normalizeLaneStatus(counts, laneJson?.ok === false ? "fail" : "pass");
  return {
    id,
    label,
    status,
    detail: laneJson?.ok === false && status === "fail"
      ? "lane_report_failed"
      : null,
    artifactPath: laneJson?.out ?? laneJson?.outPath ?? fallbackArtifactPath,
    counts,
    observedExternalConstraintCount: countObservedExternalConstraints(counts),
    rerunMetadata: laneJson?.rerunMetadata ?? null,
    data: laneJson
  };
}

function normalizeTextLane(id, label, result, artifactPath = null) {
  return {
    id,
    label,
    status: result.status === 0 ? "pass" : "fail",
    detail: result.status === 0 ? null : result.detail,
    artifactPath,
    counts: {
      pass: result.status === 0 ? 1 : 0,
      fail: result.status === 0 ? 0 : 1,
      env_limited: 0,
      expected_timeout: 0,
      skipped: 0
    },
    data: {
      stdout: result.stdout.trim().slice(0, 1000),
      stderr: result.stderr.trim().slice(0, 1000)
    }
  };
}

function canonicalPackIds() {
  return getCanonicalSkillRuntimePacks().map((entry) => entry.packId);
}

function expectedGlobalTargets(env) {
  return [
    { id: "opencode-global", dir: path.join(env.OPENCODE_CONFIG_DIR, "skill") },
    { id: "codex-global", dir: path.join(env.CODEX_HOME, "skills") },
    { id: "claudecode-global", dir: path.join(env.CLAUDECODE_HOME, "skills") },
    { id: "ampcli-global", dir: path.join(env.AMPCLI_HOME, "skills") }
  ];
}

function expectedLocalTargets(workspaceDir) {
  return [
    { id: "opencode-local", dir: path.join(workspaceDir, ".opencode", "skill") },
    { id: "codex-local", dir: path.join(workspaceDir, ".codex", "skills") },
    { id: "claudecode-local", dir: path.join(workspaceDir, ".claude", "skills") },
    { id: "ampcli-local", dir: path.join(workspaceDir, ".amp", "skills") }
  ];
}

function readFrontmatterName(skillPath) {
  const content = fs.readFileSync(skillPath, "utf8");
  const match = content.match(/^name:\s*([^\n]+)$/m);
  return match?.[1]?.trim().replace(/^["']|["']$/g, "") ?? null;
}

async function runSkillDiscoveryLane(options, reportOut) {
  const artifactPath = laneArtifactPath(reportOut, "skill-discovery");
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "odb-skill-discovery-"));
  const workspaceDir = path.join(tempRoot, "workspace");
  fs.mkdirSync(workspaceDir, { recursive: true });
  const env = {
    ...process.env,
    HOME: path.join(tempRoot, "home"),
    OPENCODE_CONFIG_DIR: path.join(tempRoot, "opencode-config"),
    OPENCODE_CACHE_DIR: path.join(tempRoot, "opencode-cache"),
    CODEX_HOME: path.join(tempRoot, "codex-home"),
    CLAUDECODE_HOME: path.join(tempRoot, "claudecode-home"),
    AMPCLI_HOME: path.join(tempRoot, "ampcli-home"),
    AMP_CLI_HOME: path.join(tempRoot, "amp-home"),
    [INSTALL_AUTOSTART_SKIP_ENV_VAR]: "1"
  };
  fs.mkdirSync(env.HOME, { recursive: true });
  fs.mkdirSync(env.OPENCODE_CONFIG_DIR, { recursive: true });
  fs.mkdirSync(env.OPENCODE_CACHE_DIR, { recursive: true });
  fs.mkdirSync(env.CODEX_HOME, { recursive: true });
  fs.mkdirSync(env.CLAUDECODE_HOME, { recursive: true });
  fs.mkdirSync(env.AMPCLI_HOME, { recursive: true });
  fs.mkdirSync(env.AMP_CLI_HOME, { recursive: true });

  const matrix = loadSkillRuntimeMatrix();
  const packIds = matrix.canonicalPacks.map((entry) => entry.packId);
  const bundledSkillDir = path.join(ROOT, "skills");
  const bundledEntries = fs.readdirSync(bundledSkillDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(bundledSkillDir, entry.name, "SKILL.md")))
    .map((entry) => entry.name)
    .sort();

  const report = {
    id: "skill-discovery",
    label: SKILL_RUNTIME_SHARED_LANES["skill-discovery"].label,
    startedAt: new Date().toISOString(),
    bundledEntries,
    canonicalPackIds: packIds,
    steps: []
  };

  try {
    const globalInstall = runCliAtCwd([
      "install",
      "--global",
      "--with-config",
      "--skills-global",
      "--no-prompt"
    ], {
      cwd: workspaceDir,
      env,
      allowFailure: true,
      timeoutMs: 180_000
    });
    report.steps.push({
      id: "global-install",
      status: globalInstall.status === 0 ? "pass" : "fail",
      detail: globalInstall.status === 0 ? null : globalInstall.detail
    });

    const localInstall = runCliAtCwd([
      "install",
      "--local",
      "--with-config",
      "--skills-local",
      "--no-prompt"
    ], {
      cwd: workspaceDir,
      env,
      allowFailure: true,
      timeoutMs: 180_000
    });
    report.steps.push({
      id: "local-install",
      status: localInstall.status === 0 ? "pass" : "fail",
      detail: localInstall.status === 0 ? null : localInstall.detail
    });

    const targets = [
      ...expectedGlobalTargets(env),
      ...expectedLocalTargets(workspaceDir)
    ];
    const targetChecks = targets.map((target) => {
      const missing = packIds.filter((packId) => !fs.existsSync(path.join(target.dir, packId, "SKILL.md")));
      return {
        id: target.id,
        dir: target.dir,
        missing
      };
    });
    report.targets = targetChecks;

    const loadChecks = packIds.map((packId) => {
      const globalPath = path.join(env.OPENCODE_CONFIG_DIR, "skill", packId, "SKILL.md");
      const localPath = path.join(workspaceDir, ".opencode", "skill", packId, "SKILL.md");
      return {
        packId,
        globalExists: fs.existsSync(globalPath),
        localExists: fs.existsSync(localPath),
        globalName: fs.existsSync(globalPath) ? readFrontmatterName(globalPath) : null,
        localName: fs.existsSync(localPath) ? readFrontmatterName(localPath) : null
      };
    });
    report.loadChecks = loadChecks;

    const missingBundled = packIds.filter((packId) => !bundledEntries.includes(packId));
    const missingInstalled = targetChecks.flatMap((entry) =>
      entry.missing.map((packId) => `${entry.id}:${packId}`)
    );
    const loadFailures = loadChecks.filter((entry) =>
      !entry.globalExists
      || !entry.localExists
      || entry.globalName !== entry.packId
      || entry.localName !== entry.packId
    );

    const failed = globalInstall.status !== 0
      || localInstall.status !== 0
      || missingBundled.length > 0
      || missingInstalled.length > 0
      || loadFailures.length > 0;

    report.finishedAt = new Date().toISOString();
    report.ok = !failed;
    report.missingBundled = missingBundled;
    report.missingInstalled = missingInstalled;
    report.loadFailures = loadFailures;
    ensureDir(artifactPath);
    writeJson(artifactPath, report);

    return {
      id: "skill-discovery",
      label: SKILL_RUNTIME_SHARED_LANES["skill-discovery"].label,
      status: failed ? "fail" : "pass",
      detail: failed
        ? [
          globalInstall.status !== 0 ? "global_install_failed" : null,
          localInstall.status !== 0 ? "local_install_failed" : null,
          missingBundled.length > 0 ? `missing_bundled=${missingBundled.join(",")}` : null,
          missingInstalled.length > 0 ? `missing_installed=${missingInstalled.join(",")}` : null,
          loadFailures.length > 0 ? `load_failures=${loadFailures.map((entry) => entry.packId).join(",")}` : null
        ].filter(Boolean).join(" | ")
        : null,
      artifactPath,
      counts: {
        pass: failed ? 0 : 1,
        fail: failed ? 1 : 0,
        env_limited: 0,
        expected_timeout: 0,
        skipped: 0
      },
      data: report
    };
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function classifyResearchResult(result) {
  const data = result.json?.data ?? {};
  const records = Array.isArray(data.records) ? data.records : [];
  const failures = Array.isArray(data.meta?.failures) ? data.meta.failures : [];
  const classified = classifyRecords(records.length, failures);
  return {
    classified,
    artifactPath: typeof data.artifact_path === "string" ? data.artifact_path : null,
    reasonCodes: normalizedCodesFromFailures(failures),
    records: records.length,
    failures: failures.length
  };
}

async function runResearchLane(options, reportOut) {
  const artifactPath = laneArtifactPath(reportOut, "research-live");
  const report = {
    id: "research-live",
    label: SKILL_RUNTIME_SHARED_LANES["research-live"].label,
    startedAt: new Date().toISOString()
  };

  return await withTempHarness("odb-research-live", async ({ env, tempRoot }) => {
    const outputDir = path.join(tempRoot, "research-output");
    const result = runCliAtCwd([
      "research",
      "run",
      "--topic",
      "browser automation",
      "--days",
      options.smoke ? "7" : "14",
      "--source-selection",
      "auto",
      "--mode",
      "json",
      "--output-dir",
      outputDir,
      "--timeout-ms",
      options.smoke ? "90000" : "120000"
    ], {
      env,
      allowFailure: true,
      timeoutMs: options.smoke ? 180_000 : 240_000
    });

    const { classified, artifactPath: workflowArtifactPath, reasonCodes, records, failures } = classifyResearchResult(result);
    report.finishedAt = new Date().toISOString();
    report.ok = classified.status === "pass" || classified.status === "env_limited";
    report.result = {
      status: result.status,
      detail: result.detail,
      workflowStatus: classified.status,
      workflowDetail: classified.detail,
      records,
      failures,
      reasonCodes,
      artifactPath: workflowArtifactPath
    };
    ensureDir(artifactPath);
    writeJson(artifactPath, report);

    return {
      id: "research-live",
      label: SKILL_RUNTIME_SHARED_LANES["research-live"].label,
      status: result.status === 0 ? classified.status : (classified.status === "env_limited" ? "env_limited" : "fail"),
      detail: result.status === 0 ? classified.detail : result.detail,
      artifactPath,
      counts: {
        pass: result.status === 0 && classified.status === "pass" ? 1 : 0,
        fail: result.status !== 0 && classified.status !== "env_limited"
          ? 1
          : (result.status === 0 && classified.status === "fail" ? 1 : 0),
        env_limited: classified.status === "env_limited" ? 1 : 0,
        expected_timeout: 0,
        skipped: 0
      },
      data: report
    };
  });
}

async function runValidatorForPack(pack, options, laneArtifacts) {
  const validators = [];
  for (const command of pack.validatorCommands ?? []) {
    logProgress(options, `validator ${pack.packId}: ${command}`);
    const artifactPath = path.join(path.dirname(laneArtifacts.base), "validators", `${pack.packId}.json`);
    const result = runShell(command, {
      cwd: ROOT,
      allowFailure: true,
      timeoutMs: 180_000
    });
    const payload = normalizeTextLane(`${pack.packId}.validator`, `${pack.packId} validator`, result, artifactPath);
    ensureDir(artifactPath);
    writeJson(artifactPath, payload);
    validators.push(payload);
  }
  return validators;
}

async function runSharedLane(laneId, options, reportOut) {
  const artifactPath = laneArtifactPath(reportOut, laneId);
  switch (laneId) {
    case "docs-drift": {
      logProgress(options, "lane docs-drift");
      const child = runNodeAtCwd([path.join(ROOT, "scripts", "docs-drift-check.mjs")], {
        allowFailure: true,
        timeoutMs: 180_000
      });
      const payload = normalizeTextLane(laneId, SKILL_RUNTIME_SHARED_LANES[laneId].label, child, artifactPath);
      ensureDir(artifactPath);
      writeJson(artifactPath, payload);
      return payload;
    }
    case "best-practices-robustness": {
      logProgress(options, "lane best-practices-robustness");
      const child = runShell("./skills/opendevbrowser-best-practices/scripts/run-robustness-audit.sh", {
        allowFailure: true,
        timeoutMs: 180_000
      });
      const payload = normalizeTextLane(laneId, SKILL_RUNTIME_SHARED_LANES[laneId].label, child, artifactPath);
      ensureDir(artifactPath);
      writeJson(artifactPath, payload);
      return payload;
    }
    case "cli-smoke": {
      logProgress(options, "lane cli-smoke");
      const child = runNodeAtCwd([path.join(ROOT, "scripts", "cli-smoke-test.mjs")], {
        allowFailure: true,
        timeoutMs: 600_000
      });
      const payload = normalizeTextLane(laneId, SKILL_RUNTIME_SHARED_LANES[laneId].label, child, artifactPath);
      ensureDir(artifactPath);
      writeJson(artifactPath, payload);
      return payload;
    }
    case "provider-direct": {
      logProgress(options, `lane provider-direct (${options.mode})`);
      const laneJsonPath = artifactPath;
      const runLane = async ({ env }) => {
        const child = runNodeAtCwd([
          path.join(ROOT, "scripts", "provider-direct-runs.mjs"),
          ...(options.smoke ? ["--smoke"] : ["--use-global-env", "--include-auth-gated", "--include-high-friction"]),
          "--out",
          laneJsonPath,
          ...(options.quiet ? ["--quiet"] : [])
        ], {
          env,
          allowFailure: true,
          timeoutMs: options.smoke ? 900_000 : 1_800_000
        });
        const laneJson = readJsonIfExists(laneJsonPath);
        return summarizeJsonLane(
          laneId,
          SKILL_RUNTIME_SHARED_LANES[laneId].label,
          laneJson ?? {
            ok: false,
            counts: { pass: 0, fail: 1, env_limited: 0, expected_timeout: 0, skipped: 0 },
            detail: child.detail
          },
          laneJsonPath
        );
      };
      return shouldUseConfiguredAuditEnv(laneId, options)
        ? await withConfiguredDaemon(runLane)
        : await withTempHarness("odb-provider-direct-audit", runLane);
    }
    case "live-regression": {
      logProgress(options, `lane live-regression (${options.mode})`);
      const laneJsonPath = artifactPath;
      const runLane = async ({ env }) => {
        const child = runNodeAtCwd([
          path.join(ROOT, "scripts", "live-regression-direct.mjs"),
          "--out",
          laneJsonPath,
          ...(options.quiet ? ["--quiet"] : [])
        ], {
          env,
          allowFailure: true,
          timeoutMs: 1_800_000
        });
        const laneJson = readJsonIfExists(laneJsonPath);
        return summarizeJsonLane(
          laneId,
          SKILL_RUNTIME_SHARED_LANES[laneId].label,
          laneJson ?? {
            ok: false,
            counts: { pass: 0, fail: 1, env_limited: 0, expected_timeout: 0, skipped: 0 },
            detail: child.detail
          },
          laneJsonPath
        );
      };
      return shouldUseConfiguredAuditEnv(laneId, options)
        ? await withConfiguredDaemon(runLane)
        : await withTempHarness("odb-live-regression-audit", runLane);
    }
    case "canvas-competitive": {
      logProgress(options, "lane canvas-competitive");
      const laneJsonPath = artifactPath;
      const child = runNodeAtCwd([
        path.join(ROOT, "scripts", "canvas-competitive-validation.mjs"),
        "--out",
        laneJsonPath
      ], {
        allowFailure: true,
        timeoutMs: options.smoke ? 900_000 : 1_500_000
      });
      const laneJson = readJsonIfExists(laneJsonPath);
      return summarizeJsonLane(
        laneId,
        SKILL_RUNTIME_SHARED_LANES[laneId].label,
        laneJson ?? {
          ok: false,
          counts: { pass: 0, fail: 1, env_limited: 0, expected_timeout: 0, skipped: 0 },
          detail: child.detail
        },
        laneJsonPath
      );
    }
    case "login-fixture": {
      logProgress(options, "lane login-fixture");
      const laneJsonPath = artifactPath;
      runNodeAtCwd([
        path.join(ROOT, "scripts", "login-fixture-live-probe.mjs"),
        "--out",
        laneJsonPath,
        ...(options.quiet ? ["--quiet"] : [])
      ], {
        allowFailure: true,
        timeoutMs: 600_000
      });
      return summarizeJsonLane(
        laneId,
        SKILL_RUNTIME_SHARED_LANES[laneId].label,
        readJsonIfExists(laneJsonPath),
        laneJsonPath
      );
    }
    case "product-video-fixture": {
      logProgress(options, "lane product-video-fixture");
      const laneJsonPath = artifactPath;
      runNodeAtCwd([
        path.join(ROOT, "scripts", "product-video-fixture-live-probe.mjs"),
        "--out",
        laneJsonPath,
        ...(options.quiet ? ["--quiet"] : [])
      ], {
        allowFailure: true,
        timeoutMs: 900_000
      });
      return summarizeJsonLane(
        laneId,
        SKILL_RUNTIME_SHARED_LANES[laneId].label,
        readJsonIfExists(laneJsonPath),
        laneJsonPath
      );
    }
    case "research-live":
      logProgress(options, "lane research-live");
      return await runResearchLane(options, reportOut);
    case "skill-discovery":
      logProgress(options, "lane skill-discovery");
      return await runSkillDiscoveryLane(options, reportOut);
    default:
      throw new Error(`Unsupported shared lane: ${laneId}`);
  }
}

function collectPackChecks(pack, sharedLaneResults, discoveryLane, validatorResults) {
  const checks = [discoveryLane];
  checks.push(...(validatorResults.get(pack.packId) ?? []));
  for (const laneId of pack.sharedEvidenceIds ?? []) {
    const lane = sharedLaneResults.get(laneId);
    if (lane) {
      checks.push(lane);
    }
  }
  if (pack.probeId) {
    const lane = sharedLaneResults.get(pack.probeId);
    if (lane) {
      checks.push(lane);
    }
  }

  const seen = new Set();
  return checks.filter((entry) => {
    const key = `${entry.id}:${entry.artifactPath ?? ""}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function syntheticCheckFromPack(pack) {
  const detail = pack.repoDefects[0]?.detail
    ?? pack.externalConstraints[0]?.detail
    ?? pack.observedExternalConstraints[0]?.detail
    ?? pack.skipped[0]?.detail
    ?? null;

  return {
    id: `pack:${pack.packId}`,
    status: pack.status,
    detail,
    artifactPath: null,
    counts: {
      pass: pack.status === "pass" ? 1 : 0,
      fail: pack.status === "fail" ? 1 : 0,
      env_limited: pack.status === "env_limited" ? 1 : 0,
      expected_timeout: 0,
      skipped: pack.status === "skipped" ? 1 : 0
    }
  };
}

export function derivePackStatus(pack, checks) {
  const repoDefects = checks
    .filter((entry) => entry.status === "fail")
    .map((entry) => ({ id: entry.id, detail: entry.detail ?? null, artifactPath: entry.artifactPath ?? null }));
  const externalConstraints = checks
    .filter((entry) => entry.status === "env_limited")
    .map(summarizeConstraintEntry)
    .filter(Boolean);
  const observedExternalConstraints = checks
    .filter((entry) => entry.status === "pass" && countObservedExternalConstraints(entry.counts) > 0)
    .map(summarizeConstraintEntry)
    .filter(Boolean);
  const skipped = checks
    .filter((entry) => entry.status === "skipped")
    .map((entry) => ({ id: entry.id, detail: entry.detail ?? null, artifactPath: entry.artifactPath ?? null }));

  let status = "pass";
  if (repoDefects.length > 0) {
    status = "fail";
  } else if (externalConstraints.length > 0) {
    status = pack.allowsEnvLimited ? "env_limited" : "fail";
  } else if (skipped.length > 0 && !pack.docOnly) {
    status = "skipped";
  }

  return {
    status,
    repoDefects,
    externalConstraints,
    observedExternalConstraints,
    skipped
  };
}

export function deriveAuditDomainStatus(domain, sharedLaneResults, packResults) {
  const checks = [
    ...(domain.proofLanes ?? []).map((laneId) => sharedLaneResults.get(laneId)).filter(Boolean),
    ...(domain.packIds ?? []).map((packId) => packResults.get(packId)).filter(Boolean).map(syntheticCheckFromPack)
  ];
  const derived = derivePackStatus({ allowsEnvLimited: true, docOnly: false }, checks);

  return {
    id: domain.id,
    label: domain.label,
    priority: domain.priority,
    proofLanes: domain.proofLanes ?? [],
    packIds: domain.packIds ?? [],
    contractTests: domain.contractTests ?? [],
    sourceSeams: domain.sourceSeams ?? [],
    targetedRerunCommands: domain.targetedRerunCommands ?? [],
    status: derived.status,
    repoDefects: derived.repoDefects,
    externalConstraints: derived.externalConstraints,
    observedExternalConstraints: derived.observedExternalConstraints,
    skipped: derived.skipped
  };
}

function deriveRuntimeFamilyStatus(family, sharedLaneResults) {
  const laneChecks = family.proofLanes.map((laneId) => sharedLaneResults.get(laneId)).filter(Boolean);
  const hasPass = laneChecks.some((entry) => entry.status === "pass");
  const hasFail = laneChecks.some((entry) => entry.status === "fail");
  const hasEnvLimited = laneChecks.some((entry) => entry.status === "env_limited");
  const hasSkipped = laneChecks.some((entry) => entry.status === "skipped");

  const status = hasFail
    ? "fail"
    : hasPass
      ? "pass"
      : hasEnvLimited
        ? "env_limited"
        : hasSkipped
          ? "skipped"
          : "skipped";

  return {
    id: family.id,
    label: family.label,
    proofLanes: laneChecks.map((entry) => ({
      id: entry.id,
      status: entry.status,
      detail: entry.detail ?? null,
      artifactPath: entry.artifactPath ?? null
    })),
    status
  };
}

function countPackStatuses(packs) {
  const counts = {
    pass: 0,
    env_limited: 0,
    fail: 0,
    skipped: 0
  };
  for (const pack of packs) {
    counts[pack.status] += 1;
  }
  return counts;
}

export function buildFixQueue(domainResults) {
  const severityRank = {
    fail: 0,
    env_limited: 1,
    skipped: 2,
    pass: 3
  };

  return [...domainResults]
    .filter((entry) => entry.status !== "pass")
    .sort((left, right) => {
      const severityDelta = severityRank[left.status] - severityRank[right.status];
      if (severityDelta !== 0) {
        return severityDelta;
      }
      const priorityDelta = left.priority - right.priority;
      if (priorityDelta !== 0) {
        return priorityDelta;
      }
      return left.id.localeCompare(right.id);
    })
    .map((entry) => ({
      id: entry.id,
      label: entry.label,
      status: entry.status,
      priority: entry.priority,
      rerunCommands: entry.targetedRerunCommands,
      repoDefectCount: entry.repoDefects.length,
      externalConstraintCount: entry.externalConstraints.reduce(
        (count, item) => count + (item.constraintCount ?? 0),
        0
      ),
      sourceSeams: entry.sourceSeams
    }));
}

export function buildTargetedRerunCommands(domainResults) {
  const commands = [];
  const seen = new Set();
  for (const entry of buildFixQueue(domainResults)) {
    for (const command of entry.rerunCommands) {
      if (seen.has(command)) {
        continue;
      }
      seen.add(command);
      commands.push(command);
    }
  }
  return commands;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  ensureCliBuilt();

  const matrix = loadSkillRuntimeMatrix();
  const report = {
    startedAt: new Date().toISOString(),
    mode: options.mode,
    out: options.out,
    inventory: {
      canonicalPackCount: matrix.canonicalPacks.length,
      canonicalPackIds: canonicalPackIds(),
      auditDomainCount: matrix.auditDomains.length,
      auditDomainIds: matrix.auditDomains.map((entry) => entry.id),
      runtimeFamilyCount: matrix.runtimeFamilies.length,
      runtimeFamilyIds: matrix.runtimeFamilies.map((entry) => entry.id)
    },
    sharedLanes: [],
    packs: [],
    auditDomains: [],
    runtimeFamilies: []
  };

  const allLaneIds = new Set(["skill-discovery"]);
  for (const pack of matrix.canonicalPacks) {
    for (const laneId of pack.sharedEvidenceIds ?? []) {
      allLaneIds.add(laneId);
    }
    if (pack.probeId) {
      allLaneIds.add(pack.probeId);
    }
  }
  for (const family of matrix.runtimeFamilies) {
    for (const laneId of family.proofLanes ?? []) {
      allLaneIds.add(laneId);
    }
  }

  const sharedLaneResults = new Map();
  for (const laneId of allLaneIds) {
    const result = await runSharedLane(laneId, options, options.out);
    sharedLaneResults.set(laneId, result);
    report.sharedLanes.push(result);
  }

  const validatorResults = new Map();
  for (const pack of getCanonicalSkillRuntimePacks()) {
    const validators = await runValidatorForPack(pack, options, { base: options.out });
    validatorResults.set(pack.packId, validators);
  }

  const discoveryLane = sharedLaneResults.get("skill-discovery");
  const packResults = new Map();
  for (const pack of getCanonicalSkillRuntimePacks()) {
    const checks = collectPackChecks(pack, sharedLaneResults, discoveryLane, validatorResults);
    const derived = derivePackStatus(pack, checks);
    const packReport = {
      packId: pack.packId,
      packType: pack.packType,
      docOnly: pack.docOnly,
      status: derived.status,
      checks: checks.map((entry) => ({
        id: entry.id,
        status: entry.status,
        detail: entry.detail ?? null,
        artifactPath: entry.artifactPath ?? null
      })),
      repoDefects: derived.repoDefects,
      externalConstraints: derived.externalConstraints,
      observedExternalConstraints: derived.observedExternalConstraints,
      skipped: derived.skipped
    };
    report.packs.push(packReport);
    packResults.set(pack.packId, packReport);
  }

  for (const domain of getAuditDomains()) {
    report.auditDomains.push(
      deriveAuditDomainStatus(domain, sharedLaneResults, packResults)
    );
  }

  for (const family of getRuntimeFamilies()) {
    report.runtimeFamilies.push(deriveRuntimeFamilyStatus(family, sharedLaneResults));
  }

  report.packCounts = countPackStatuses(report.packs);
  report.domainCounts = countPackStatuses(report.auditDomains);
  report.familyCounts = countPackStatuses(report.runtimeFamilies);
  report.targetedRerunCommands = buildTargetedRerunCommands(report.auditDomains);
  report.fixQueue = buildFixQueue(report.auditDomains);
  report.summary = {
    repoDefectCount: report.packs.reduce((sum, pack) => sum + pack.repoDefects.length, 0),
    externalConstraintCount: report.packs.reduce(
      (sum, pack) => sum + pack.externalConstraints.reduce((count, entry) => count + (entry.constraintCount ?? 0), 0),
      0
    ),
    observedExternalConstraintCount: report.packs.reduce(
      (sum, pack) => sum + pack.observedExternalConstraints.reduce((count, entry) => count + (entry.constraintCount ?? 0), 0),
      0
    ),
    failingDomainCount: report.auditDomains.filter((entry) => entry.status === "fail").length,
    failingFamilyCount: report.runtimeFamilies.filter((entry) => entry.status === "fail").length
  };
  report.finishedAt = new Date().toISOString();
  report.ok = report.packCounts.fail === 0 && report.domainCounts.fail === 0 && report.familyCounts.fail === 0;

  ensureDir(options.out);
  writeJson(options.out, report);
  console.log(JSON.stringify({
    ok: report.ok,
    mode: options.mode,
    out: options.out,
    packCounts: report.packCounts,
    domainCounts: report.domainCounts,
    familyCounts: report.familyCounts,
    summary: report.summary,
    targetedRerunCommands: report.targetedRerunCommands
  }, null, 2));

  if (!report.ok) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
