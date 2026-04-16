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
  "scripts/resolve-odb-cli.sh",
  "scripts/validator-fixture-cli.sh"
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
  "scripts/resolve-odb-cli.sh",
  "scripts/validator-fixture-cli.sh"
];

const workflowMarkers = [
  "inspiredesign)",
  "inspiredesign run",
  "--include-prototype-guidance",
  "canvas-preflight",
  "canvas-feedback-eval",
  "release-direct-gates",
  "skill-runtime-audit",
  "tests/skill-loader.test.ts",
  "tests/skill-list-tool.test.ts",
  "tests/cli-skills-installer.test.ts",
  "tests/cli-help-parity.test.ts",
  "npx opendevbrowser --help",
  "npx opendevbrowser help",
  "./skills/opendevbrowser-continuity-ledger/scripts/validate-skill-assets.sh",
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
  "guidance.recommendedNextCommands",
  "generationPlanIssues",
  "plan_invalid",
  "generation_plan_invalid",
  "CANVAS-01",
  "CANVAS-07"
];

const canvasHandshakeMarkers = [
  "\"planStatus\": \"missing\"",
  "\"allowedValues\"",
  "\"warningClasses\"",
  "\"generationPlanIssues\"",
  "\"mutationPolicy\"",
  "\"recommendedNextCommands\"",
  "\"reason\": \"Handshake is complete. Submit a complete generationPlan before mutation.\""
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
  const { getBundledSkillDirectoryPackIds } = await import(pathToFileURL(path.join(repoRoot, "scripts", "skill-runtime-scenarios.mjs")).href);
  const { commandCount, toolCount, opsCommandCount, canvasCommandCount } = getSurfaceCounts();

  const skillDocMarkers = [
    "npx opendevbrowser --help",
    "npx opendevbrowser help",
    "npx opendevbrowser inspiredesign run",
    "./skills/opendevbrowser-best-practices/scripts/odb-workflow.sh inspiredesign",
    `${commandCount} CLI commands, ${toolCount} tools, ${opsCommandCount} \`/ops\` commands, ${canvasCommandCount} \`/canvas\` commands`,
    "Treat `tests/parity-matrix.test.ts` as contract coverage only.",
    "canonical owner of direct-run release evidence policy",
    "Skill Runtime Audit and Realignment",
    "artifacts/skill-runtime-surface-matrix.md",
    "assets/templates/skill-runtime-pack-matrix.json",
    "mutationPolicy.allowedBeforePlan",
    "planStatus",
    "plan_invalid",
    "generationPlanIssues",
    "guidance.recommendedNextCommands",
    "generation_plan_invalid",
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
    "allowedValues",
    "mutationPolicy",
    "planStatus",
    "plan_invalid",
    "generationPlanIssues",
    "warningClasses",
    "recommendedNextCommands",
    "generation_plan_invalid",
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
    "\"docs/README.md\"",
    "\"docs/FIRST_RUN_ONBOARDING.md\"",
    "\"firstContactOwners\"",
    "Pointer controls documented",
    "Ops pointer and preview namespaces documented",
    "Canvas command names documented",
    "Canvas code-sync surface documented",
    "Annotation send/copy semantics documented",
    "Generated help first-contact owners documented",
    "Onboarding metadata owner documented",
    "First-run onboarding proof owner documented"
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
    const bundledSkillNames = getBundledSkillDirectoryPackIds();
    const bundledSkillNameSet = new Set(bundledSkillNames);
    const auditDomainIds = Array.isArray(packMatrix.auditDomains)
      ? packMatrix.auditDomains.map((entry) => entry?.id).filter((value) => typeof value === "string")
      : [];
    const uniqueAuditDomainIds = new Set(auditDomainIds);
    if (packIds.length === 0 || uniquePackIds.size !== packIds.length) {
      failures.push(`Skill runtime pack matrix must contain non-empty unique canonical packs; found ${uniquePackIds.size}/${packIds.length}.`);
    }
    if (bundledSkillNames.length === 0) {
      failures.push("Bundled skill registry did not expose any canonical pack names.");
    }
    if (packIds.some((packId) => !bundledSkillNameSet.has(packId)) || bundledSkillNames.some((packId) => !uniquePackIds.has(packId))) {
      failures.push("Skill runtime pack matrix canonical packs must match src/skills/bundled-skill-directories.ts.");
    }
    if (auditDomainIds.length === 0 || uniqueAuditDomainIds.size !== auditDomainIds.length) {
      failures.push(`Skill runtime pack matrix must contain non-empty unique audit domains; found ${uniqueAuditDomainIds.size}/${auditDomainIds.length}.`);
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
    const packMatrix = JSON.parse(fs.readFileSync(path.join(skillRoot, "assets/templates/skill-runtime-pack-matrix.json"), "utf8"));
    const runtimeMatrixMarkers = [
      ...packMatrix.canonicalPacks.map((entry) => entry.packId),
      "Shared runtime families",
      ...packMatrix.runtimeFamilies.map((entry) => entry.label),
      "Audit domains",
      ...packMatrix.auditDomains.map((entry) => entry.id)
    ];
    for (const marker of runtimeMatrixMarkers) {
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

  const canvasHandshakePath = "assets/templates/canvas-handshake-example.json";
  if (fs.existsSync(path.join(skillRoot, canvasHandshakePath))) {
    const canvasHandshake = readUtf8(canvasHandshakePath);
    for (const marker of canvasHandshakeMarkers) {
      if (!hasMarker(canvasHandshake, marker)) {
        failures.push(`Canvas handshake example missing marker: ${marker}`);
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
