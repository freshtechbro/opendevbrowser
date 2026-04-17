#!/usr/bin/env bash
set -euo pipefail

skill_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
skill_file="$skill_root/SKILL.md"

node - "$skill_root" "$skill_file" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const [skillRoot, skillFile] = process.argv.slice(2);

const requiredPaths = [
  "artifacts/design-workflows.md",
  "artifacts/design-contract-playbook.md",
  "artifacts/frontend-evaluation-rubric.md",
  "artifacts/external-pattern-synthesis.md",
  "artifacts/component-pattern-index.md",
  "artifacts/existing-surface-adaptation.md",
  "artifacts/app-shell-and-state-wiring.md",
  "artifacts/state-ownership-matrix.md",
  "artifacts/async-search-state-ownership.md",
  "artifacts/loading-and-feedback-surfaces.md",
  "artifacts/theming-and-token-ownership.md",
  "artifacts/isolated-preview-validation.md",
  "artifacts/performance-audit-playbook.md",
  "artifacts/scroll-reveal-surface-planning.md",
  "artifacts/research-harvest-workflow.md",
  "artifacts/design-release-gate.md",
  "artifacts/opendevbrowser-ui-example-map.md",
  "artifacts/implementation-anti-patterns.md",
  "assets/templates/design-brief.v1.md",
  "assets/templates/design-audit-report.v1.md",
  "assets/templates/design-contract.v1.json",
  "assets/templates/canvas-generation-plan.design.v1.json",
  "assets/templates/design-review-checklist.json",
  "assets/templates/real-surface-design-matrix.json",
  "assets/templates/reference-pattern-board.v1.json",
  "assets/templates/design-release-gate.v1.json",
  "scripts/design-workflow.sh",
  "scripts/extract-canvas-plan.sh",
  "scripts/validate-skill-assets.sh"
];

const jsonTemplates = [
  "assets/templates/design-contract.v1.json",
  "assets/templates/canvas-generation-plan.design.v1.json",
  "assets/templates/design-review-checklist.json",
  "assets/templates/real-surface-design-matrix.json",
  "assets/templates/reference-pattern-board.v1.json",
  "assets/templates/design-release-gate.v1.json"
];

const executableScripts = [
  "scripts/design-workflow.sh",
  "scripts/extract-canvas-plan.sh",
  "scripts/validate-skill-assets.sh"
];

const workflowResolverMarkers = [
  "resolve-odb-cli.sh",
  "CLI_PREFIX"
];

const skillDocMarkers = [
  "artifacts/design-workflows.md",
  "artifacts/design-contract-playbook.md",
  "artifacts/frontend-evaluation-rubric.md",
  "artifacts/external-pattern-synthesis.md",
  "artifacts/component-pattern-index.md",
  "artifacts/existing-surface-adaptation.md",
  "artifacts/app-shell-and-state-wiring.md",
  "artifacts/state-ownership-matrix.md",
  "artifacts/async-search-state-ownership.md",
  "artifacts/loading-and-feedback-surfaces.md",
  "artifacts/theming-and-token-ownership.md",
  "artifacts/isolated-preview-validation.md",
  "artifacts/performance-audit-playbook.md",
  "artifacts/scroll-reveal-surface-planning.md",
  "artifacts/research-harvest-workflow.md",
  "artifacts/design-release-gate.md",
  "artifacts/opendevbrowser-ui-example-map.md",
  "artifacts/implementation-anti-patterns.md",
  "assets/templates/design-audit-report.v1.md",
  "assets/templates/design-contract.v1.json",
  "assets/templates/canvas-generation-plan.design.v1.json",
  "assets/templates/reference-pattern-board.v1.json",
  "assets/templates/design-release-gate.v1.json",
  "scripts/extract-canvas-plan.sh",
  "canvas.session.open",
  "canvas.plan.get",
  "generationPlanIssues",
  "canvas.document.patch",
  "canvas.preview.render",
  "canvas.document.save",
  "handshake_read",
  "plan_invalid",
  "plan_accepted",
  "recommendedNextCommands",
  "canvas.plan.set",
  "canvas.history.undo",
  "canvas.history.redo",
  "canvas_history_requested",
  "research-harvest",
  "release-gate",
  "performance-audit",
  "Delivered to agent",
  "Stored only; fetch with annotate --stored",
  "ISSUE-01",
  "ISSUE-07",
  "ISSUE-08",
  "ISSUE-12",
  "v0.dev/docs/prompting/text",
  "docs.lovable.dev/prompting/prompting-best-practices"
];

const designWorkflowMarkers = [
  "canvas.session.open",
  "canvas.plan.set",
  "canvas.plan.get",
  "generationPlanIssues",
  "canvas.document.patch",
  "canvas.preview.render",
  "canvas.feedback.poll",
  "canvas.document.save",
  "handshake_read",
  "plan_invalid",
  "plan_accepted",
  "recommendedNextCommands"
];

const workflowOutputMarkers = {
  "canvas-contract": [
    "canvas.session.open",
    "canvas.plan.set",
    "canvas.plan.get",
    "generationPlanIssues",
    "canvas.document.patch",
    "canvas.preview.render",
    "canvas.feedback.poll",
    "canvas.document.save",
    "handshake_read",
    "plan_invalid",
    "plan_accepted",
    "recommendedNextCommands"
  ]
};

const patternMarkers = [
  "Anthropic",
  "Vercel v0",
  "Lovable",
  "iannuttall/claude-agents",
  "Dimillian",
  "OpenDevBrowser-Specific Adaptation"
];

const failures = [];
const fullPath = (relPath) => path.join(skillRoot, relPath);

for (const relPath of requiredPaths) {
  if (!fs.existsSync(fullPath(relPath))) {
    failures.push(`Missing required asset: ${relPath}`);
  }
}

for (const relPath of executableScripts) {
  if (!fs.existsSync(fullPath(relPath))) continue;
  const mode = fs.statSync(fullPath(relPath)).mode & 0o111;
  if (mode === 0) {
    failures.push(`Script is not executable: ${relPath}`);
  }
}

for (const relPath of jsonTemplates) {
  if (!fs.existsSync(fullPath(relPath))) continue;
  try {
    JSON.parse(fs.readFileSync(fullPath(relPath), "utf8"));
  } catch {
    failures.push(`Invalid JSON template: ${relPath}`);
  }
}

const skillDoc = fs.readFileSync(skillFile, "utf8");
for (const marker of skillDocMarkers) {
  if (!skillDoc.includes(marker)) {
    failures.push(`SKILL.md missing marker: ${marker}`);
  }
}

const patternDoc = fs.readFileSync(fullPath("artifacts/external-pattern-synthesis.md"), "utf8");
for (const marker of patternMarkers) {
  if (!patternDoc.includes(marker)) {
    failures.push(`external-pattern-synthesis missing marker: ${marker}`);
  }
}

const designWorkflowDoc = fs.readFileSync(fullPath("artifacts/design-workflows.md"), "utf8");
for (const marker of designWorkflowMarkers) {
  if (!designWorkflowDoc.includes(marker)) {
    failures.push(`design-workflows missing marker: ${marker}`);
  }
}

const extractScript = fullPath("scripts/extract-canvas-plan.sh");
const contractTemplate = fullPath("assets/templates/design-contract.v1.json");
const extractResult = spawnSync(extractScript, [contractTemplate], { encoding: "utf8" });
if (extractResult.status !== 0) {
  failures.push(`extract-canvas-plan.sh failed on template: ${extractResult.stderr.trim() || extractResult.stdout.trim()}`);
} else {
  try {
    const output = JSON.parse(extractResult.stdout);
    const requiredPlanKeys = [
      "targetOutcome",
      "visualDirection",
      "layoutStrategy",
      "contentStrategy",
      "componentStrategy",
      "motionPosture",
      "responsivePosture",
      "accessibilityPosture",
      "validationTargets"
    ];
    for (const key of requiredPlanKeys) {
      if (!(key in (output.generationPlan ?? {}))) {
        failures.push(`extract-canvas-plan output missing key: ${key}`);
      }
    }
  } catch {
    failures.push("extract-canvas-plan.sh produced invalid JSON output");
  }
}

const workflowScript = fullPath("scripts/design-workflow.sh");
const workflowSource = fs.readFileSync(workflowScript, "utf8");
for (const marker of workflowResolverMarkers) {
  if (!workflowSource.includes(marker)) {
    failures.push(`design-workflow.sh missing resolver marker: ${marker}`);
  }
}

for (const workflow of [
  "list",
  "contract-first",
  "research-harvest",
  "screenshot-audit",
  "canvas-contract",
  "real-surface-validation",
  "performance-audit",
  "release-gate",
  "ship-audit"
]) {
  const result = spawnSync(workflowScript, [workflow], { encoding: "utf8" });
  if (result.status !== 0) {
    failures.push(`design-workflow.sh failed for mode ${workflow}: ${result.stderr.trim() || result.stdout.trim()}`);
    continue;
  }
  if ((result.stdout ?? "").trim().length === 0) {
    failures.push(`design-workflow.sh produced empty output for mode ${workflow}`);
  }
  const requiredOutputMarkers = workflowOutputMarkers[workflow];
  if (requiredOutputMarkers) {
    for (const marker of requiredOutputMarkers) {
      if (!(result.stdout ?? "").includes(marker)) {
        failures.push(`design-workflow.sh output for ${workflow} missing marker: ${marker}`);
      }
    }
  }
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(failure);
  }
  process.exit(1);
}

console.log("Design-agent skill assets validated.");
NODE
