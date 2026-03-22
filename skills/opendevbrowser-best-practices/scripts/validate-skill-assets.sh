#!/usr/bin/env bash
set -euo pipefail

skill_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
skill_file="$skill_root/SKILL.md"

node - "$skill_root" "$skill_file" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const [skillRoot, skillFile] = process.argv.slice(2);

const requiredPaths = [
  "artifacts/provider-workflows.md",
  "artifacts/parity-gates.md",
  "artifacts/debug-trace-playbook.md",
  "artifacts/fingerprint-tiers.md",
  "artifacts/macro-workflows.md",
  "artifacts/browser-agent-known-issues-matrix.md",
  "artifacts/command-channel-reference.md",
  "artifacts/canvas-governance-playbook.md",
  "assets/templates/mode-flag-matrix.json",
  "assets/templates/ops-request-envelope.json",
  "assets/templates/cdp-forward-envelope.json",
  "assets/templates/robustness-checklist.json",
  "assets/templates/surface-audit-checklist.json",
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

const skillDocMarkers = [
  "npx opendevbrowser --help",
  "npx opendevbrowser help",
  "56 CLI commands, 49 tools, 44 `/ops` commands, 35 `/canvas` commands",
  "Treat `tests/parity-matrix.test.ts` as contract coverage only.",
  "canonical owner of direct-run release evidence policy",
  "mutationPolicy.allowedBeforePlan",
  "canvas.code.bind",
  "canvas.code.resolve",
  "bound_app_runtime",
  "annotate --stored"
];

const commandRefMarkers = [
  "CLI commands: `56`",
  "Plugin tools: `49`",
  "`/ops` command names: `44`",
  "`/canvas` command names: `35`",
  "docs/SURFACE_REFERENCE.md",
  "npx opendevbrowser help",
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

const workflowMarkers = [
  "canvas-preflight",
  "canvas-feedback-eval",
  "release-direct-gates",
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
const surfaceAuditMarkers = [
  "\"cliCommands\": 56",
  "\"tools\": 49",
  "\"opsCommands\": 44",
  "\"canvasCommands\": 35",
  "Canvas command names documented",
  "Canvas code-sync surface documented",
  "Annotation send/copy semantics documented"
];

const failures = [];

const readUtf8 = (relPath) => fs.readFileSync(path.join(skillRoot, relPath), "utf8");
const hasMarker = (content, marker) => content.includes(marker);

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
NODE
