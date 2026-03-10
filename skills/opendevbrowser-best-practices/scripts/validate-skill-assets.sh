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
  "scripts/validate-skill-assets.sh"
];

const commandRefMarkers = [
  "CLI commands: `56`",
  "Plugin tools: `49`",
  "`/ops` command names: `38`",
  "`/canvas` command names: `19`",
  "docs/SURFACE_REFERENCE.md",
  "canvas.session.open",
  "canvas.feedback.poll",
  "feedback.heartbeat",
  "plan_required",
  "opencode",
  "codex",
  "claudecode",
  "ampcli"
];

const workflowMarkers = [
  "canvas-preflight",
  "canvas-feedback-eval"
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

const failures = [];

const readUtf8 = (relPath) => fs.readFileSync(path.join(skillRoot, relPath), "utf8");
const hasMarker = (content, marker) => content.includes(marker);

for (const relPath of requiredPaths) {
  if (!fs.existsSync(path.join(skillRoot, relPath))) {
    failures.push(`Missing required asset: ${relPath}`);
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

const canvasPlaybookPath = "artifacts/canvas-governance-playbook.md";
if (fs.existsSync(path.join(skillRoot, canvasPlaybookPath))) {
  const canvasPlaybook = readUtf8(canvasPlaybookPath);
  for (const marker of canvasPlaybookMarkers) {
    if (!hasMarker(canvasPlaybook, marker)) {
      failures.push(`Canvas playbook missing marker: ${marker}`);
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
