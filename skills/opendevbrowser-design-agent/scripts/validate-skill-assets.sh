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
  "artifacts/design-agent-work-products.md",
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
  "assets/templates/canvas-patch.request.v1.json",
  "assets/templates/inspiredesign-advanced-brief.v1.json",
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
  "assets/templates/canvas-patch.request.v1.json",
  "assets/templates/inspiredesign-advanced-brief.v1.json",
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
  "artifacts/design-agent-work-products.md",
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
  "assets/templates/canvas-patch.request.v1.json",
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
  "nextStepGuidance.readiness",
  "productSuccess=true",
  "artifactAuthority=product_ready",
  "evidenceAuthority=pin_media_ready",
  "pin-media-index.json",
  "social/pinterest",
  "canvas.plan.set",
  "canvas.starter.list",
  "canvas.starter.apply",
  "canvas.inventory.list",
  "canvas.inventory.insert",
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

const researchHarvestMarkers = [
  "canonical Pinterest pin-media harvests",
  "evidenceAuthority=pin_media_ready",
  "ranked-references.json` is non-empty",
  "pin-media-index.json` is manifest-backed",
  "persisted first-party pin-media file"
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
  "canvas.document.export",
  "exportTarget",
  "canvas.starter.list",
  "canvas.inventory.list",
  "\"itemId\":\"<inventory-item-id>\"",
  "\"prototypeId\":\"<prototype-id>\"",
  "handshake_read",
  "plan_invalid",
  "plan_accepted",
  "recommendedNextCommands",
  "guidance.nextStepGuidance",
  "guidance.paramsExamples",
  "requiredBeforeSave",
  "canvas-patch.request.v1.json",
  ".tmp/canvas-session.open.json > .tmp/canvas-plan.request.json",
  ".tmp/canvas-patch.request.json"
];

const workflowOutputMarkers = {
  "canvas-contract": [
    "mkdir -p .tmp",
    ".opendevbrowser/design-agent/",
    "canvas.session.open",
    "canvas.plan.set",
    "canvas.plan.get",
    "generationPlanIssues",
    "canvas.document.patch",
    "canvas.preview.render",
    "canvas.feedback.poll",
    "canvas.document.save",
    "canvas.document.export",
    "exportTarget",
    "canvas.starter.list",
    "canvas.starter.apply",
    "canvas.inventory.list",
    "canvas.inventory.insert",
    "\"itemId\":\"<inventory-item-id>\"",
    "\"prototypeId\":\"<prototype-id>\"",
    "handshake_read",
    "plan_invalid",
    "plan_accepted",
    "recommendedNextCommands",
    "guidance.nextStepGuidance",
    "guidance.paramsExamples",
    "requiredBeforeSave",
    ".tmp/canvas-session.open.json > .tmp/canvas-plan.request.json",
    "cp skills/opendevbrowser-design-agent/assets/templates/canvas-patch.request.v1.json .tmp/canvas-patch.request.json",
    "Fill .tmp/canvas-patch.request.json"
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

const storagePolicyMarkers = [
  ".opendevbrowser/design-agent/<run-id>/",
  "`.tmp/` is disposable scratch",
  "canvas.document.save",
  ".opendevbrowser/canvas/...",
  "canvas-patch.request.json",
  "canvas-starter-inventory-notes.json",
  "validation-evidence.md"
];

const storageSplitMarkers = [
  ".opendevbrowser/design-agent/<run-id>/",
  ".tmp/",
  "canvas.document.save",
  ".opendevbrowser/canvas/..."
];

const planRequiredPaths = [
  "targetOutcome.mode",
  "targetOutcome.summary",
  "visualDirection.profile",
  "visualDirection.themeStrategy",
  "layoutStrategy.approach",
  "layoutStrategy.navigationModel",
  "contentStrategy.source",
  "componentStrategy.mode",
  "componentStrategy.interactionStates",
  "motionPosture.level",
  "motionPosture.reducedMotion",
  "responsivePosture.primaryViewport",
  "responsivePosture.requiredViewports",
  "accessibilityPosture.target",
  "accessibilityPosture.keyboardNavigation",
  "validationTargets.blockOn",
  "validationTargets.requiredThemes",
  "validationTargets.browserValidation",
  "validationTargets.maxInteractionLatencyMs"
];

const allowedPatchOperations = new Set([
  "page.create",
  "page.update",
  "node.insert",
  "node.update",
  "node.remove",
  "node.reparent",
  "node.reorder",
  "node.duplicate",
  "node.visibility.set",
  "variant.patch",
  "token.set",
  "tokens.merge",
  "tokens.replace",
  "governance.update",
  "asset.attach",
  "binding.set",
  "binding.remove",
  "prototype.upsert",
  "inventory.promote",
  "inventory.update",
  "inventory.upsert",
  "inventory.remove",
  "starter.apply"
]);

const requiredSmokeOperations = [
  "governance.update",
  "page.update",
  "node.insert",
  "node.update"
];

const failures = [];
const parsedJson = new Map();
const fullPath = (relPath) => path.join(skillRoot, relPath);
const staleScratchMarkers = [
  "./tmp/",
  ["./", "tmp/design-contract.json"].join(""),
  ["./", "tmp/canvas-plan.json"].join(""),
  ["./", "tmp/canvas-patch.json"].join(""),
  "canvas-plan.json",
  "canvas-patch.json"
];

function parseJsonTemplate(relPath) {
  if (parsedJson.has(relPath)) return parsedJson.get(relPath);
  const parsed = JSON.parse(fs.readFileSync(fullPath(relPath), "utf8"));
  parsedJson.set(relPath, parsed);
  return parsed;
}

function valueAt(record, dottedPath) {
  return dottedPath.split(".").reduce((value, key) => {
    if (!value || typeof value !== "object") return undefined;
    return value[key];
  }, record);
}

function validateGenerationPlanShape(plan, label) {
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
    failures.push(`${label} generationPlan must be a non-empty object`);
    return;
  }

  for (const requiredPath of planRequiredPaths) {
    const value = valueAt(plan, requiredPath);
    if (value === undefined || value === null || value === "") {
      failures.push(`${label} generationPlan missing ${requiredPath}`);
      continue;
    }
    if (Array.isArray(value) && value.length === 0) {
      failures.push(`${label} generationPlan ${requiredPath} must be a non-empty array`);
    }
  }

  const primaryViewport = valueAt(plan, "responsivePosture.primaryViewport");
  const requiredViewports = valueAt(plan, "responsivePosture.requiredViewports");
  if (Array.isArray(requiredViewports) && !requiredViewports.includes(primaryViewport)) {
    failures.push(`${label} generationPlan responsivePosture.requiredViewports must include responsivePosture.primaryViewport`);
  }

  const maxInteractionLatencyMs = valueAt(plan, "validationTargets.maxInteractionLatencyMs");
  if (typeof maxInteractionLatencyMs !== "number" || !Number.isFinite(maxInteractionLatencyMs) || maxInteractionLatencyMs <= 0) {
    failures.push(`${label} generationPlan validationTargets.maxInteractionLatencyMs must be a positive number`);
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireString(value, message) {
  if (typeof value !== "string" || value.trim().length === 0) {
    failures.push(message);
  }
}

function requireObject(value, message) {
  if (!isPlainObject(value) || Object.keys(value).length === 0) {
    failures.push(message);
  }
}

function validatePatchOperationShape(patch, label, index) {
  if (patch.op === "governance.update") {
    requireString(patch.block, `${label} governance.update at index ${index} missing block`);
    requireObject(patch.changes, `${label} governance.update at index ${index} missing changes`);
    return;
  }
  if (patch.op === "page.update") {
    requireString(patch.pageId, `${label} page.update at index ${index} missing pageId`);
    requireObject(patch.changes, `${label} page.update at index ${index} missing changes`);
    return;
  }
  if (patch.op === "node.insert") {
    requireString(patch.pageId, `${label} node.insert at index ${index} missing pageId`);
    requireString(patch.parentId, `${label} node.insert at index ${index} missing parentId`);
    requireObject(patch.node, `${label} node.insert at index ${index} missing node`);
    if (isPlainObject(patch.node)) {
      requireString(patch.node.id, `${label} node.insert at index ${index} missing node.id`);
      requireString(patch.node.kind, `${label} node.insert at index ${index} missing node.kind`);
    }
    return;
  }
  if (patch.op === "node.update") {
    requireString(patch.nodeId, `${label} node.update at index ${index} missing nodeId`);
    requireObject(patch.changes, `${label} node.update at index ${index} missing changes`);
  }
}

function validatePatchTemplate() {
  const label = "assets/templates/canvas-patch.request.v1.json";
  const patchTemplate = parseJsonTemplate(label);
  for (const key of ["canvasSessionId", "leaseId", "baseRevision", "patches"]) {
    if (!(key in patchTemplate)) {
      failures.push(`${label} missing required key: ${key}`);
    }
  }
  if (!Array.isArray(patchTemplate.patches) || patchTemplate.patches.length === 0) {
    failures.push(`${label} patches must be a non-empty array`);
    return;
  }
  if (typeof patchTemplate.baseRevision !== "number" || !Number.isInteger(patchTemplate.baseRevision)) {
    failures.push(`${label} baseRevision must be a numeric placeholder`);
  }
  if (patchTemplate.patches.length !== requiredSmokeOperations.length) {
    failures.push(`${label} should stay a minimal smoke payload with exactly these operations: ${requiredSmokeOperations.join(", ")}`);
  }
  const operations = patchTemplate.patches.map((patch, index) => {
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
      failures.push(`${label} patch at index ${index} must be an object`);
      return null;
    }
    if (typeof patch.op !== "string") {
      failures.push(`${label} patch at index ${index} missing op`);
      return null;
    }
    if (!allowedPatchOperations.has(patch.op)) {
      failures.push(`${label} uses unsupported patch operation: ${patch.op}`);
    }
    validatePatchOperationShape(patch, label, index);
    return patch.op;
  }).filter(Boolean);

  for (const op of requiredSmokeOperations) {
    if (!operations.includes(op)) {
      failures.push(`${label} missing smoke operation: ${op}`);
    }
  }
  for (let index = 0; index < requiredSmokeOperations.length; index += 1) {
    if (operations[index] !== requiredSmokeOperations[index]) {
      failures.push(`${label} smoke operation at index ${index} must be ${requiredSmokeOperations[index]}`);
    }
  }
}

function validateStoragePolicyMarkers() {
  const docMarkerSets = new Map([
    ["SKILL.md", storageSplitMarkers],
    ["artifacts/design-workflows.md", storageSplitMarkers],
    ["artifacts/design-agent-work-products.md", storagePolicyMarkers]
  ]);
  for (const [relPath, markers] of docMarkerSets.entries()) {
    const filePath = relPath === "SKILL.md" ? skillFile : fullPath(relPath);
    const content = fs.readFileSync(filePath, "utf8");
    for (const marker of markers) {
      if (!content.includes(marker)) {
        failures.push(`${relPath} storage policy missing marker: ${marker}`);
      }
    }
  }
}

function validateStaleGuidance() {
  const filesToScan = ["SKILL.md", ...requiredPaths].filter((relPath) => relPath !== "scripts/validate-skill-assets.sh");
  const stalePreviewProjectionPattern = /canvas\.preview\.render[\s\S]{0,300}"projection"\s*:/;
  for (const relPath of filesToScan) {
    const filePath = relPath === "SKILL.md" ? skillFile : fullPath(relPath);
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) continue;
    const content = fs.readFileSync(filePath, "utf8");
    for (const marker of staleScratchMarkers) {
      if (content.includes(marker)) {
        failures.push(`Stale scratch guidance marker ${marker} in ${relPath}`);
      }
    }
    if (content.includes("inventoryItemId")) {
      failures.push(`Stale inventory insert param inventoryItemId in ${relPath}`);
    }
    if (stalePreviewProjectionPattern.test(content)) {
      failures.push(`Stale canvas.preview.render projection param in ${relPath}`);
    }
  }
}

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
    parseJsonTemplate(relPath);
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

const researchHarvestDoc = fs.readFileSync(fullPath("artifacts/research-harvest-workflow.md"), "utf8");
for (const marker of researchHarvestMarkers) {
  if (!researchHarvestDoc.includes(marker)) {
    failures.push(`research-harvest-workflow missing marker: ${marker}`);
  }
}

if (parsedJson.has("assets/templates/design-contract.v1.json")) {
  validateGenerationPlanShape(
    parseJsonTemplate("assets/templates/design-contract.v1.json").generationPlan,
    "assets/templates/design-contract.v1.json"
  );
}

if (parsedJson.has("assets/templates/canvas-generation-plan.design.v1.json")) {
  validateGenerationPlanShape(
    parseJsonTemplate("assets/templates/canvas-generation-plan.design.v1.json").generationPlan,
    "assets/templates/canvas-generation-plan.design.v1.json"
  );
}

if (parsedJson.has("assets/templates/canvas-patch.request.v1.json")) {
  validatePatchTemplate();
}

validateStoragePolicyMarkers();
validateStaleGuidance();

const extractScript = fullPath("scripts/extract-canvas-plan.sh");
for (const relPath of [
  "assets/templates/design-contract.v1.json",
  "assets/templates/canvas-generation-plan.design.v1.json"
]) {
  const extractResult = spawnSync(extractScript, [fullPath(relPath)], { encoding: "utf8" });
  if (extractResult.status !== 0) {
    failures.push(`extract-canvas-plan.sh failed on ${relPath}: ${extractResult.stderr.trim() || extractResult.stdout.trim()}`);
    continue;
  }
  try {
    const output = JSON.parse(extractResult.stdout);
    const requiredWrapperKeys = ["requestId", "canvasSessionId", "leaseId", "documentId", "generationPlan"];
    for (const key of requiredWrapperKeys) {
      if (!(key in output)) {
        failures.push(`extract-canvas-plan output for ${relPath} missing wrapper key: ${key}`);
      }
    }
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
        failures.push(`extract-canvas-plan output for ${relPath} missing key: ${key}`);
      }
    }
    if (relPath === "assets/templates/canvas-generation-plan.design.v1.json") {
      const wrappedInput = parseJsonTemplate(relPath);
      for (const key of ["requestId", "canvasSessionId", "leaseId", "documentId"]) {
        if (output[key] !== wrappedInput[key]) {
          failures.push(`extract-canvas-plan output for ${relPath} did not preserve wrapper key: ${key}`);
        }
      }
    }
    validateGenerationPlanShape(output.generationPlan, `extract-canvas-plan output for ${relPath}`);
  } catch {
    failures.push(`extract-canvas-plan.sh produced invalid JSON output for ${relPath}`);
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
