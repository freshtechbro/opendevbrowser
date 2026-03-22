#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parse as parseJsonc } from "jsonc-parser";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VITEST_BIN = path.join(ROOT, "node_modules", "vitest", "vitest.mjs");
const DEFAULT_OUT_PATH = path.join(ROOT, "artifacts", "canvas-competitive-validation-report.json");
const MAX_BUFFER = 32 * 1024 * 1024;

export const CANVAS_VALIDATION_GROUPS = [
  {
    id: "send-to-agent",
    name: "Send-to-agent delivery",
    covers: ["send_to_agent"],
    files: [
      "tests/agent-inbox.test.ts",
      "tests/annotation-manager.test.ts",
      "tests/extension-background.test.ts",
      "tests/tools-annotate.test.ts"
    ]
  },
  {
    id: "feedback-history",
    name: "Feedback stream and editor history",
    covers: ["feedback_stream", "editor_history"],
    files: [
      "tests/canvas-manager.test.ts",
      "tests/cli-canvas.test.ts",
      "tests/extension-canvas-editor.test.ts"
    ]
  },
  {
    id: "framework-fixtures",
    name: "Framework and library fixtures",
    covers: ["framework_fixtures"],
    files: [
      "tests/canvas-framework-adapters.test.ts",
      "tests/canvas-library-adapters.test.ts"
    ]
  },
  {
    id: "inventory-starters",
    name: "Inventory insertion and starter seeding",
    covers: ["inventory_insertion", "starter_application"],
    files: [
      "tests/canvas-inventory.test.ts",
      "tests/canvas-kits-catalog.test.ts",
      "tests/canvas-starters.test.ts"
    ]
  },
  {
    id: "token-roundtrip",
    name: "Token round-trip",
    covers: ["token_roundtrip"],
    files: [
      "tests/canvas-token-roundtrip.test.ts",
      "tests/canvas-export.test.ts",
      "tests/canvas-code-sync-manager.test.ts",
      "tests/canvas-code-sync-primitives.test.ts",
      "tests/canvas-code-sync-transform.test.ts",
      "tests/extension-canvas-editor.test.ts",
      "tests/extension-canvas-runtime.test.ts"
    ]
  },
  {
    id: "adapter-conformance",
    name: "Shared adapter conformance",
    covers: ["adapter_conformance"],
    files: ["tests/canvas-adapter-conformance.test.ts"],
    testNamePattern: "built-in adapter conformance"
  },
  {
    id: "plugin-packaging-negatives",
    name: "Plugin packaging and negative cases",
    covers: ["plugin_packaging_negatives", "migration_fallbacks", "unsupported_fragment_fallback", "lifecycle_cleanup"],
    files: [
      "tests/canvas-byo-adapter-plugin.test.ts",
      "tests/canvas-code-sync-manager.test.ts",
      "tests/canvas-code-sync-transform.test.ts"
    ]
  },
  {
    id: "configured-plugin-fixtures",
    name: "Configured BYO plugin fixtures",
    covers: ["configured_plugin_fixtures"],
    files: ["tests/canvas-adapter-conformance.test.ts"],
    testNamePattern: "configured plugin fixtures",
    requiresConfiguredPlugins: true
  },
  {
    id: "surface-parity",
    name: "Managed, extension, and CDP surface parity",
    covers: ["managed_extension_cdp_parity", "surface_inventory"],
    files: [
      "tests/canvas-command-inventory.test.ts",
      "tests/cli-help-parity.test.ts",
      "tests/parity-matrix.test.ts"
    ]
  },
  {
    id: "figma-fixtures",
    name: "Figma fixture-backed import",
    covers: ["figma_fixture_import"],
    files: ["tests/canvas-figma-import.test.ts"]
  },
  {
    id: "figma-live-smoke",
    name: "Optional live Figma smoke",
    covers: ["figma_live_smoke"],
    files: ["tests/canvas-figma-live-smoke.test.ts"],
    kind: "figma_live_smoke"
  }
];

function normalizePluginDeclaration(value) {
  if (typeof value === "string" && value.trim().length > 0) {
    return { ref: value.trim(), enabled: true };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const ref = typeof value.ref === "string" && value.ref.trim().length > 0
    ? value.ref.trim()
    : null;
  if (!ref) {
    return null;
  }
  return {
    ref,
    enabled: value.enabled !== false,
    ...(Array.isArray(value.trustedWorkspaceRoots) ? { trustedWorkspaceRoots: value.trustedWorkspaceRoots } : {}),
    ...(Array.isArray(value.capabilityOverrides) ? { capabilityOverrides: value.capabilityOverrides } : {})
  };
}

function mergePluginDeclarations(params) {
  const merged = new Map();
  for (const declarations of [params.packageDeclarations, params.repoDeclarations, params.configDeclarations]) {
    for (const raw of declarations) {
      const normalized = normalizePluginDeclaration(raw);
      if (!normalized) {
        continue;
      }
      merged.set(normalized.ref, normalized);
    }
  }
  return [...merged.values()].filter((entry) => entry.enabled !== false);
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readJsoncIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const content = fs.readFileSync(filePath, "utf8");
  const errors = [];
  const parsed = parseJsonc(content, errors, { allowTrailingComma: true });
  if (errors.length > 0) {
    const first = errors[0];
    throw new Error(`Invalid JSONC in ${filePath}: parse error at offset ${first?.offset ?? 0}`);
  }
  return parsed;
}

function readCanvasConfigDeclarations(value) {
  return value && typeof value === "object" && !Array.isArray(value) && Array.isArray(value.adapterPlugins)
    ? value.adapterPlugins
    : [];
}

function defaultConfigPathForEnv(env, homeDir = os.homedir()) {
  const configDir = env.OPENCODE_CONFIG_DIR || path.join(homeDir, ".config", "opencode");
  return path.join(configDir, "opendevbrowser.jsonc");
}

export function readCanvasValidationRuntime(env = process.env, options = {}) {
  const rootDir = options.rootDir ?? ROOT;
  const homeDir = options.homeDir ?? os.homedir();
  const packageJson = readJsonIfExists(path.join(rootDir, "package.json")) ?? {};
  const packageDeclarations = readCanvasConfigDeclarations(packageJson.opendevbrowser?.canvas);
  const repoAdapterFile = path.join(rootDir, ".opendevbrowser", "canvas", "adapters.json");
  const repoConfig = readJsonIfExists(repoAdapterFile) ?? {};
  const repoDeclarations = readCanvasConfigDeclarations(repoConfig);
  const configPath = defaultConfigPathForEnv(env, homeDir);
  const userConfig = readJsoncIfExists(configPath) ?? {};
  const configDeclarations = readCanvasConfigDeclarations(userConfig.canvas);
  const mergedDeclarations = mergePluginDeclarations({
    packageDeclarations,
    repoDeclarations,
    configDeclarations
  });
  const figmaConfigToken = userConfig?.integrations?.figma?.accessToken;
  const figmaAccessToken = [
    env.CANVAS_FIGMA_ACCESS_TOKEN,
    env.FIGMA_ACCESS_TOKEN,
    typeof figmaConfigToken === "string" && figmaConfigToken.trim().length > 0 ? figmaConfigToken.trim() : null
  ].find((value) => typeof value === "string" && value.trim().length > 0) ?? null;
  const figmaSourceUrl = [
    env.CANVAS_FIGMA_LIVE_URL,
    env.FIGMA_FILE_URL
  ].find((value) => typeof value === "string" && value.trim().length > 0) ?? null;

  return {
    packageDeclarations,
    repoDeclarations,
    configDeclarations,
    mergedDeclarations,
    configuredPluginRefs: mergedDeclarations.map((entry) => entry.ref),
    figmaAccessToken,
    figmaSourceUrl,
    configPath
  };
}

export function parseValidationArgs(argv) {
  const options = {
    group: null,
    list: false,
    out: DEFAULT_OUT_PATH
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--list" || arg === "--help") {
      options.list = true;
      continue;
    }
    if (arg === "--group") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("--group requires a validation group id.");
      }
      options.group = next;
      index += 1;
      continue;
    }
    if (arg.startsWith("--group=")) {
      const value = arg.slice("--group=".length);
      if (!value) {
        throw new Error("--group requires a validation group id.");
      }
      options.group = value;
      continue;
    }
    if (arg === "--out") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("--out requires a file path.");
      }
      options.out = path.resolve(ROOT, next);
      index += 1;
      continue;
    }
    if (arg.startsWith("--out=")) {
      const value = arg.slice("--out=".length);
      if (!value) {
        throw new Error("--out requires a file path.");
      }
      options.out = path.resolve(ROOT, value);
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

export function resolveSelectedValidationGroups(options, groups = CANVAS_VALIDATION_GROUPS) {
  if (!options.group) {
    return groups;
  }
  const match = groups.find((group) => group.id === options.group);
  if (!match) {
    throw new Error(`Unknown canvas validation group: ${options.group}`);
  }
  return [match];
}

function printGroupList(groups = CANVAS_VALIDATION_GROUPS) {
  console.log("Canvas competitive validation groups:");
  for (const group of groups) {
    console.log(`- ${group.id}: ${group.name}`);
    console.log(`  covers: ${group.covers.join(", ")}`);
    console.log(`  files: ${group.files.join(", ")}`);
  }
}

function ensureVitestInstalled() {
  if (!fs.existsSync(VITEST_BIN)) {
    throw new Error(`Vitest binary not found at ${VITEST_BIN}. Run npm install first.`);
  }
}

function buildVitestArgs(group) {
  const args = [VITEST_BIN, "run", ...group.files, "--coverage.enabled=false"];
  if (group.testNamePattern) {
    args.push("-t", group.testNamePattern);
  }
  return args;
}

function writeGroupLog(outPath, groupId, stdout, stderr) {
  const logDir = path.join(path.dirname(outPath), "canvas-competitive-validation-logs");
  fs.mkdirSync(logDir, { recursive: true });
  const logPath = path.join(logDir, `${groupId}.log`);
  const content = [
    `# ${groupId}`,
    "",
    "## stdout",
    stdout.trimEnd(),
    "",
    "## stderr",
    stderr.trimEnd(),
    ""
  ].join("\n");
  fs.writeFileSync(logPath, content, "utf8");
  return logPath;
}

function runVitestGroup(group, outPath, env) {
  const startedAt = Date.now();
  const args = buildVitestArgs(group);
  const result = spawnSync(process.execPath, args, {
    cwd: ROOT,
    env,
    encoding: "utf8",
    maxBuffer: MAX_BUFFER
  });
  const durationMs = Date.now() - startedAt;
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const logPath = writeGroupLog(outPath, group.id, stdout, stderr);
  return {
    id: group.id,
    name: group.name,
    covers: [...group.covers],
    status: (result.status ?? 1) === 0 ? "pass" : "fail",
    durationMs,
    files: [...group.files],
    command: [process.execPath, ...args].join(" "),
    logPath,
    detail: (result.status ?? 1) === 0
      ? undefined
      : (stderr.trim() || stdout.trim() || `Vitest group failed: ${group.id}`)
  };
}

export function summarizeValidationResults(results, startedAt, options = {}) {
  const counts = {
    pass: results.filter((entry) => entry.status === "pass").length,
    fail: results.filter((entry) => entry.status === "fail").length,
    skipped: results.filter((entry) => entry.status === "skipped").length,
    skipped_no_figma_token: results.filter((entry) => entry.status === "skipped_no_figma_token").length
  };
  const featureAreas = {};
  for (const result of results) {
    for (const area of result.covers ?? []) {
      const current = featureAreas[area];
      if (!current || current === "pass") {
        featureAreas[area] = result.status;
      }
      if (result.status === "fail") {
        featureAreas[area] = "fail";
      }
    }
  }
  return {
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    ok: counts.fail === 0,
    counts,
    outPath: options.outPath ?? DEFAULT_OUT_PATH,
    configuredPluginRefs: options.configuredPluginRefs ?? [],
    figmaSourceUrl: options.figmaSourceUrl ?? null,
    configPath: options.configPath ?? null,
    featureAreas,
    results
  };
}

function groupEnv(runtime, baseEnv) {
  return {
    ...baseEnv,
    CANVAS_VALIDATION_CONFIG_DECLARATIONS_JSON: JSON.stringify(runtime.configDeclarations),
    CANVAS_VALIDATION_CONFIGURED_PLUGIN_REFS_JSON: JSON.stringify(runtime.configuredPluginRefs),
    ...(runtime.figmaAccessToken ? { FIGMA_ACCESS_TOKEN: runtime.figmaAccessToken } : {}),
    ...(runtime.figmaSourceUrl ? { CANVAS_FIGMA_LIVE_URL: runtime.figmaSourceUrl } : {})
  };
}

function runValidation(options) {
  ensureVitestInstalled();
  const startedAt = Date.now();
  const runtime = readCanvasValidationRuntime(process.env);
  const selectedGroups = resolveSelectedValidationGroups(options);
  const results = [];
  const env = groupEnv(runtime, process.env);

  for (const group of selectedGroups) {
    if (group.requiresConfiguredPlugins && runtime.configuredPluginRefs.length === 0) {
      results.push({
        id: group.id,
        name: group.name,
        covers: [...group.covers],
        status: "skipped",
        durationMs: 0,
        files: [...group.files],
        detail: "No configured canvas adapter plugins were found in package.json, .opendevbrowser/canvas/adapters.json, or opendevbrowser.jsonc."
      });
      continue;
    }
    if (group.kind === "figma_live_smoke") {
      if (!runtime.figmaAccessToken) {
        results.push({
          id: group.id,
          name: group.name,
          covers: [...group.covers],
          status: "skipped_no_figma_token",
          durationMs: 0,
          files: [...group.files],
          detail: "Set FIGMA_ACCESS_TOKEN or integrations.figma.accessToken to enable the live smoke."
        });
        continue;
      }
      if (!runtime.figmaSourceUrl) {
        results.push({
          id: group.id,
          name: group.name,
          covers: [...group.covers],
          status: "skipped",
          durationMs: 0,
          files: [...group.files],
          detail: "Set CANVAS_FIGMA_LIVE_URL (or FIGMA_FILE_URL) to run the live smoke."
        });
        continue;
      }
    }
    results.push(runVitestGroup(group, options.out, env));
  }

  const summary = summarizeValidationResults(results, startedAt, {
    outPath: options.out,
    configuredPluginRefs: runtime.configuredPluginRefs,
    figmaSourceUrl: runtime.figmaSourceUrl,
    configPath: runtime.configPath
  });
  fs.mkdirSync(path.dirname(options.out), { recursive: true });
  fs.writeFileSync(options.out, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(summary, null, 2));
  console.error(`[canvas-validation] report: ${options.out}`);
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const options = parseValidationArgs(process.argv.slice(2));
  if (options.list) {
    printGroupList();
  } else {
    runValidation(options);
  }
}
