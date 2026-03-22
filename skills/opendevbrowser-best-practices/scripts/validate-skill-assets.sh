#!/usr/bin/env bash
set -euo pipefail

skill_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
skill_file="$skill_root/SKILL.md"

node - "$skill_root" "$skill_file" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const [skillRoot, skillFile] = process.argv.slice(2);
const repoRoot = path.resolve(skillRoot, "../..");

const requiredPaths = [
  "artifacts/provider-workflows.md",
  "artifacts/parity-gates.md",
  "artifacts/debug-trace-playbook.md",
  "artifacts/fingerprint-tiers.md",
  "artifacts/macro-workflows.md",
  "artifacts/browser-agent-known-issues-matrix.md",
  "artifacts/command-channel-reference.md",
  "artifacts/canvas-governance-playbook.md",
  "artifacts/skill-runtime-surface-matrix.md",
  "assets/templates/mode-flag-matrix.json",
  "assets/templates/ops-request-envelope.json",
  "assets/templates/cdp-forward-envelope.json",
  "assets/templates/robustness-checklist.json",
  "assets/templates/surface-audit-checklist.json",
  "assets/templates/skill-runtime-pack-matrix.json",
  "assets/templates/canvas-handshake-example.json",
  "assets/templates/canvas-generation-plan.v1.json",
  "assets/templates/canvas-feedback-eval.json",
  "assets/templates/canvas-blocker-checklist.json",
  "scripts/odb-workflow.sh",
  "scripts/run-robustness-audit.sh",
  "scripts/validate-skill-assets.sh"
];

const internalPaths = [
  "scripts/resolve-odb-cli.sh"
];

const jsonTemplates = [
  "assets/templates/mode-flag-matrix.json",
  "assets/templates/ops-request-envelope.json",
  "assets/templates/cdp-forward-envelope.json",
  "assets/templates/robustness-checklist.json",
  "assets/templates/surface-audit-checklist.json",
  "assets/templates/skill-runtime-pack-matrix.json",
  "assets/templates/canvas-handshake-example.json",
  "assets/templates/canvas-generation-plan.v1.json",
  "assets/templates/canvas-feedback-eval.json",
  "assets/templates/canvas-blocker-checklist.json"
];

const executableScripts = [
  "scripts/odb-workflow.sh",
  "scripts/run-robustness-audit.sh",
  "scripts/validate-skill-assets.sh",
  "scripts/resolve-odb-cli.sh"
];

const workflowMarkers = [
  "canvas-preflight",
  "canvas-feedback-eval",
  "release-direct-gates",
  "skill-runtime-audit",
  "resolve-odb-cli.sh",
  "CLI_PREFIX"
];

const parityGatePath = "artifacts/parity-gates.md";
const parityGateMarkers = [
  "Contract gates vs live release proof",
  "`tests/parity-matrix.test.ts` is contract coverage",
  "node scripts/provider-direct-runs.mjs --release-gate --out artifacts/release/vX.Y.Z/provider-direct-runs.json",
  "node scripts/live-regression-direct.mjs --release-gate --out artifacts/release/vX.Y.Z/live-regression-direct.json",
  "docs/RELEASE_RUNBOOK.md"
];

const providerWorkflowPath = "artifacts/provider-workflows.md";
const providerWorkflowMarkers = [
  "## Release evidence lane",
  "node scripts/provider-direct-runs.mjs --release-gate --out artifacts/release/vX.Y.Z/provider-direct-runs.json",
  "node scripts/live-regression-direct.mjs --release-gate --out artifacts/release/vX.Y.Z/live-regression-direct.json",
  "contract coverage, not live release proof"
];

const canvasPlaybookMarkers = [
  "canvas.session.open",
  "canvas.plan.set",
  "canvas.feedback.poll",
  "CANVAS-01",
  "CANVAS-07"
];

const canvasTemplateMarkers = [
  "CANVAS-01",
  "CANVAS-02",
  "CANVAS-03",
  "CANVAS-04",
  "CANVAS-05",
  "CANVAS-06",
  "CANVAS-07"
];

const templateMarkerPaths = [
  "assets/templates/canvas-feedback-eval.json",
  "assets/templates/canvas-blocker-checklist.json",
  "assets/templates/robustness-checklist.json"
];

const surfaceAuditPath = "assets/templates/surface-audit-checklist.json";

const failures = [];

const readUtf8 = (relPath) => fs.readFileSync(path.join(skillRoot, relPath), "utf8");
const hasMarker = (content, marker) => content.includes(marker);
(async () => {
  const { getSurfaceCounts } = await import(pathToFileURL(path.join(repoRoot, "scripts", "docs-drift-check.mjs")).href);
  const { commandCount, toolCount, opsCommandCount, canvasCommandCount } = getSurfaceCounts();

  const skillDocMarkers = [
    "npx opendevbrowser --help",
    "npx opendevbrowser help",
    `${commandCount} CLI commands, ${toolCount} tools, ${opsCommandCount} \`/ops\` commands, ${canvasCommandCount} \`/canvas\` commands`,
    "Treat `tests/parity-matrix.test.ts` as contract coverage only.",
    "canonical owner of direct-run release evidence policy",
    "Skill Runtime Audit and Realignment",
    "artifacts/skill-runtime-surface-matrix.md",
    "assets/templates/skill-runtime-pack-matrix.json",
    "mutationPolicy.allowedBeforePlan",
    "canvas.code.bind",
    "canvas.code.resolve",
    "bound_app_runtime",
    "annotate --stored"
  ];

  const commandRefMarkers = [
    `CLI commands: \`${commandCount}\``,
    `Plugin tools: \`${toolCount}\``,
    `\`/ops\` command names: \`${opsCommandCount}\``,
    `\`/canvas\` command names: \`${canvasCommandCount}\``,
    "docs/SURFACE_REFERENCE.md",
    "npx opendevbrowser help",
    "pointer-move",
    "pointer.*",
    "canvas.applyRuntimePreviewBridge",
    "canvas.session.open",
    "canvas.session.attach",
    "canvas.feedback.poll",
    "canvas.feedback.next",
    "canvas.feedback.unsubscribe",
    "canvas.code.bind",
    "canvas.code.resolve",
    "canvas_history_requested",
    "canvas.tab.sync",
    "canvas.overlay.sync",
    "feedback.heartbeat",
    "governanceRequirements",
    "generationPlanRequirements",
    "mutationPolicy",
    "code-sync",
    "parity",
    "plan_required",
    "annotation:sendPayload",
    "AgentInbox",
    "annotate --stored",
    "storage",
    "opencode",
    "codex",
    "claudecode",
    "ampcli"
  ];

  const surfaceAuditMarkers = [
    `"cliCommands": ${commandCount}`,
    `"tools": ${toolCount}`,
    `"opsCommands": ${opsCommandCount}`,
    `"canvasCommands": ${canvasCommandCount}`,
    "Pointer controls documented",
    "Ops pointer and preview namespaces documented",
    "Canvas command names documented",
    "Canvas code-sync surface documented",
    "Annotation send/copy semantics documented"
  ];

  for (const relPath of requiredPaths) {
    if (!fs.existsSync(path.join(skillRoot, relPath))) {
      failures.push(`Missing required asset: ${relPath}`);
    }
  }

  for (const relPath of internalPaths) {
    if (!fs.existsSync(path.join(skillRoot, relPath))) {
      failures.push(`Missing internal helper: ${relPath}`);
    }
  }

  for (const relPath of executableScripts) {
    const fullPath = path.join(skillRoot, relPath);
    if (!fs.existsSync(fullPath)) continue;
    const mode = fs.statSync(fullPath).mode & 0o111;
    if (mode === 0) {
      failures.push(`Script is not executable: ${relPath}`);
    }
  }

  for (const relPath of jsonTemplates) {
    const fullPath = path.join(skillRoot, relPath);
    if (!fs.existsSync(fullPath)) continue;
    try {
      JSON.parse(fs.readFileSync(fullPath, "utf8"));
    } catch {
      failures.push(`Invalid JSON template: ${relPath}`);
    }
  }

  const packMatrixPath = path.join(skillRoot, "assets/templates/skill-runtime-pack-matrix.json");
  if (fs.existsSync(packMatrixPath)) {
    const packMatrix = JSON.parse(fs.readFileSync(packMatrixPath, "utf8"));
    const packIds = Array.isArray(packMatrix.canonicalPacks)
      ? packMatrix.canonicalPacks.map((entry) => entry?.packId).filter((value) => typeof value === "string")
      : [];
    const uniquePackIds = new Set(packIds);
    if (packIds.length !== 9 || uniquePackIds.size !== 9) {
      failures.push(`Skill runtime pack matrix must contain 9 unique canonical packs; found ${uniquePackIds.size}.`);
    }
    if (!Array.isArray(packMatrix.runtimeFamilies) || packMatrix.runtimeFamilies.length === 0) {
      failures.push("Skill runtime pack matrix missing runtimeFamilies.");
    }
  }

  const skillDoc = fs.readFileSync(skillFile, "utf8");
  for (const relPath of requiredPaths) {
    if (!hasMarker(skillDoc, relPath)) {
      failures.push(`SKILL.md missing reference: ${relPath}`);
    }
  }
  for (const marker of skillDocMarkers) {
    if (!hasMarker(skillDoc, marker)) {
      failures.push(`SKILL.md missing marker: ${marker}`);
    }
  }

  const runtimeMatrixPath = "artifacts/skill-runtime-surface-matrix.md";
  if (fs.existsSync(path.join(skillRoot, runtimeMatrixPath))) {
    const runtimeMatrix = readUtf8(runtimeMatrixPath);
    for (const marker of [
      "opendevbrowser-best-practices",
      "opendevbrowser-continuity-ledger",
      "opendevbrowser-data-extraction",
      "opendevbrowser-design-agent",
      "opendevbrowser-form-testing",
      "opendevbrowser-login-automation",
      "opendevbrowser-product-presentation-asset",
      "opendevbrowser-research",
      "opendevbrowser-shopping",
      "Shared runtime families"
    ]) {
      if (!hasMarker(runtimeMatrix, marker)) {
        failures.push(`Skill runtime surface matrix missing marker: ${marker}`);
      }
    }
  }

  const commandRefPath = "artifacts/command-channel-reference.md";
  if (fs.existsSync(path.join(skillRoot, commandRefPath))) {
    const commandRef = readUtf8(commandRefPath);
    for (const marker of commandRefMarkers) {
      if (!hasMarker(commandRef, marker)) {
        failures.push(`Command/channel reference missing marker: ${marker}`);
      }
    }
  }

  const workflowPath = "scripts/odb-workflow.sh";
  if (fs.existsSync(path.join(skillRoot, workflowPath))) {
    const workflow = readUtf8(workflowPath);
    for (const marker of workflowMarkers) {
      if (!hasMarker(workflow, marker)) {
        failures.push(`Workflow router missing marker: ${marker}`);
      }
    }
  }

  if (fs.existsSync(path.join(skillRoot, parityGatePath))) {
    const parityGateDoc = readUtf8(parityGatePath);
    for (const marker of parityGateMarkers) {
      if (!hasMarker(parityGateDoc, marker)) {
        failures.push(`Parity gates doc missing marker: ${marker}`);
      }
    }
  }

  if (fs.existsSync(path.join(skillRoot, providerWorkflowPath))) {
    const providerWorkflowDoc = readUtf8(providerWorkflowPath);
    for (const marker of providerWorkflowMarkers) {
      if (!hasMarker(providerWorkflowDoc, marker)) {
        failures.push(`Provider workflows doc missing marker: ${marker}`);
      }
    }
  }

  const canvasPlaybookPath = "artifacts/canvas-governance-playbook.md";
  if (fs.existsSync(path.join(skillRoot, canvasPlaybookPath))) {
    const canvasPlaybook = readUtf8(canvasPlaybookPath);
    for (const marker of canvasPlaybookMarkers) {
      if (!hasMarker(canvasPlaybook, marker)) {
        failures.push(`Canvas playbook missing marker: ${marker}`);
      }
    }
  }

  if (fs.existsSync(path.join(skillRoot, surfaceAuditPath))) {
    const surfaceAudit = readUtf8(surfaceAuditPath);
    for (const marker of surfaceAuditMarkers) {
      if (!hasMarker(surfaceAudit, marker)) {
        failures.push(`Surface audit checklist missing marker: ${marker}`);
      }
    }
  }

  for (const relPath of templateMarkerPaths) {
    const fullPath = path.join(skillRoot, relPath);
    if (!fs.existsSync(fullPath)) continue;
    const content = fs.readFileSync(fullPath, "utf8");
    for (const marker of canvasTemplateMarkers) {
      if (!hasMarker(content, marker)) {
        failures.push(`Canvas template missing marker (${marker}): ${relPath}`);
      }
    }
  }

  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(failure);
    }
    process.exit(1);
  }

  console.log(`Skill assets validated: ${requiredPaths.length} files referenced/present, ${jsonTemplates.length} JSON templates parsed.`);
})().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
NODE
