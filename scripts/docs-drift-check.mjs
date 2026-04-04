#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPublicSurfaceCounts } from "./shared/public-surface-manifest.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

export function getSurfaceCounts() {
  const opsSource = read("extension/src/ops/ops-runtime.ts");
  const canvasSource = read("src/browser/canvas-manager.ts");
  const publicSurface = getPublicSurfaceCounts(ROOT);

  const opsCommandNames = [...opsSource.matchAll(/case "([^"]+)":/g)].map((match) => match[1]);
  const canvasCommandMatch = canvasSource.match(/export const PUBLIC_CANVAS_COMMANDS = \[(.*?)\] as const;/s);
  if (!canvasCommandMatch) {
    throw new Error("Unable to parse public canvas commands.");
  }
  const canvasCommandNames = [...canvasCommandMatch[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);

  return {
    commandCount: publicSurface.commandCount,
    toolCount: publicSurface.toolCount,
    opsCommandCount: opsCommandNames.length,
    canvasCommandCount: canvasCommandNames.length,
    commandNames: publicSurface.commandNames,
    toolNames: publicSurface.toolNames,
    opsCommandNames,
    canvasCommandNames
  };
}

function parseDocCount(regex, source, label) {
  const match = source.match(regex);
  if (!match) {
    throw new Error(`Unable to parse ${label}.`);
  }
  return Number.parseInt(match[1], 10);
}

function pushRequiredForbiddenTermsCheck(checks, { id, source, required, forbidden, detail }) {
  checks.push({
    id,
    ok: required.every((term) => source.includes(term))
      && forbidden.every((term) => !source.includes(term)),
    detail
  });
}

function extractCommandNamesFromDocSection(source, startHeading, endHeading, label) {
  const start = source.indexOf(startHeading);
  if (start < 0) {
    throw new Error(`Unable to locate ${label} start heading.`);
  }
  const end = source.indexOf(endHeading, start);
  const section = source.slice(start, end >= 0 ? end : undefined);
  const envelopeIndex = section.indexOf("Envelope contract:");
  const commandSection = section.slice(0, envelopeIndex >= 0 ? envelopeIndex : undefined);
  return [...commandSection.matchAll(/^- `([^`]+)`$/gm)].map((match) => match[1]);
}

function extractBacktickedNamesFromDocSection(source, startHeading, endHeading, label) {
  const start = source.indexOf(startHeading);
  if (start < 0) {
    throw new Error(`Unable to locate ${label} start heading.`);
  }
  const end = source.indexOf(endHeading, start);
  const section = source.slice(start, end >= 0 ? end : undefined);
  return [...section.matchAll(/^- `([^`]+)`(?:[^\n]*)$/gm)].map((match) => match[1]);
}

export function runDocsDriftChecks() {
  const packageJson = JSON.parse(read("package.json"));
  const version = String(packageJson.version ?? "");
  if (!version) {
    throw new Error("package.json version is missing.");
  }

  const cliDoc = read("docs/CLI.md");
  const publicReadme = read("README.md");
  const docsReadme = read("docs/README.md");
  const onboardingDoc = read("docs/FIRST_RUN_ONBOARDING.md");
  const surfaceDoc = read("docs/SURFACE_REFERENCE.md");
  const architectureDoc = read("docs/ARCHITECTURE.md");
  const onboardingMetadata = JSON.parse(read("src/cli/onboarding-metadata.json"));
  const annotateDoc = read("docs/ANNOTATE.md");
  const extensionDoc = read("docs/EXTENSION.md");
  const troubleshootingDoc = read("docs/TROUBLESHOOTING.md");
  const privacyDoc = read("docs/privacy.md");
  const dependenciesDoc = read("docs/DEPENDENCIES.md");
  const cutoverDoc = read("docs/CUTOVER_CHECKLIST.md");
  const bestPracticesSkill = read("skills/opendevbrowser-best-practices/SKILL.md");
  const commandChannelReference = read("skills/opendevbrowser-best-practices/artifacts/command-channel-reference.md");
  const surfaceAuditChecklist = JSON.parse(read("skills/opendevbrowser-best-practices/assets/templates/surface-audit-checklist.json"));
  const designSkill = read("skills/opendevbrowser-design-agent/SKILL.md");
  const continuitySkill = read("skills/opendevbrowser-continuity-ledger/SKILL.md");
  const dataExtractionSkill = read("skills/opendevbrowser-data-extraction/SKILL.md");
  const loginSkill = read("skills/opendevbrowser-login-automation/SKILL.md");
  const formSkill = read("skills/opendevbrowser-form-testing/SKILL.md");
  const productPresentationAssetSkill = read("skills/opendevbrowser-product-presentation-asset/SKILL.md");
  const researchSkill = read("skills/opendevbrowser-research/SKILL.md");
  const shoppingSkill = read("skills/opendevbrowser-shopping/SKILL.md");

  const { commandCount, toolCount, opsCommandCount, canvasCommandCount, commandNames, toolNames, opsCommandNames } = getSurfaceCounts();

  const checks = [];

  checks.push({
    id: "doc.cli.no_stale_tgz_ref",
    ok: !/opendevbrowser-0\.0\.15\.tgz/.test(cliDoc),
    detail: "docs/CLI.md must not reference old local package artifacts."
  });

  checks.push({
    id: "doc.onboarding.no_stale_tgz_ref",
    ok: !/opendevbrowser-0\.0\.15\.tgz/.test(onboardingDoc),
    detail: "docs/FIRST_RUN_ONBOARDING.md must not reference old local package artifacts."
  });

  const surfaceCommandCount = parseDocCount(/## CLI Command Inventory \((\d+)\)/, surfaceDoc, "surface CLI command count");
  const surfaceToolCount = parseDocCount(/## Tool Inventory \((\d+)\)/, surfaceDoc, "surface tool count");
  checks.push({
    id: "doc.surface.command_count_matches_source",
    ok: surfaceCommandCount === commandCount,
    detail: `docs/SURFACE_REFERENCE.md command count=${surfaceCommandCount}, source=${commandCount}`
  });
  checks.push({
    id: "doc.surface.tool_count_matches_source",
    ok: surfaceToolCount === toolCount,
    detail: `docs/SURFACE_REFERENCE.md tool count=${surfaceToolCount}, source=${toolCount}`
  });
  const surfaceCommandNames = extractBacktickedNamesFromDocSection(
    surfaceDoc,
    "## CLI Command Inventory",
    "## Tool Inventory",
    "surface CLI commands"
  );
  const sourceCommandSet = new Set(commandNames);
  const docCommandSet = new Set(surfaceCommandNames);
  const missingCommands = commandNames.filter((command) => !docCommandSet.has(command));
  const extraCommands = surfaceCommandNames.filter((command) => !sourceCommandSet.has(command));
  checks.push({
    id: "doc.surface.command_listing_matches_source",
    ok: surfaceCommandNames.length === commandCount && missingCommands.length === 0 && extraCommands.length === 0,
    detail: `docs/SURFACE_REFERENCE.md commands listed=${surfaceCommandNames.length}, source=${commandCount}, missing=${missingCommands.join(",") || "none"}, extra=${extraCommands.join(",") || "none"}`
  });
  const surfaceToolNames = extractBacktickedNamesFromDocSection(
    surfaceDoc,
    "## Tool Inventory",
    "## Relay Channel Inventory",
    "surface tools"
  );
  const sourceToolSet = new Set(toolNames);
  const docToolSet = new Set(surfaceToolNames);
  const missingTools = toolNames.filter((tool) => !docToolSet.has(tool));
  const extraTools = surfaceToolNames.filter((tool) => !sourceToolSet.has(tool));
  checks.push({
    id: "doc.surface.tool_listing_matches_source",
    ok: surfaceToolNames.length === toolCount && missingTools.length === 0 && extraTools.length === 0,
    detail: `docs/SURFACE_REFERENCE.md tools listed=${surfaceToolNames.length}, source=${toolCount}, missing=${missingTools.join(",") || "none"}, extra=${extraTools.join(",") || "none"}`
  });

  const surfaceOpsCount = parseDocCount(/### `\/ops` command names \((\d+)\)/, surfaceDoc, "surface /ops count");
  const surfaceOpsCommandNames = extractCommandNamesFromDocSection(
    surfaceDoc,
    "### `/ops` command names",
    "### `/canvas` command names",
    "surface /ops commands"
  );
  const sourceOpsSet = new Set(opsCommandNames);
  const docOpsSet = new Set(surfaceOpsCommandNames);
  const missingOpsCommands = opsCommandNames.filter((command) => !docOpsSet.has(command));
  const extraOpsCommands = surfaceOpsCommandNames.filter((command) => !sourceOpsSet.has(command));
  checks.push({
    id: "doc.surface.ops_command_count_matches_source",
    ok: surfaceOpsCount === opsCommandCount,
    detail: `docs/SURFACE_REFERENCE.md /ops count=${surfaceOpsCount}, source=${opsCommandCount}`
  });
  checks.push({
    id: "doc.surface.ops_command_listing_matches_source",
    ok: surfaceOpsCommandNames.length === opsCommandCount && missingOpsCommands.length === 0 && extraOpsCommands.length === 0,
    detail: `docs/SURFACE_REFERENCE.md /ops listed=${surfaceOpsCommandNames.length}, source=${opsCommandCount}, missing=${missingOpsCommands.join(",") || "none"}, extra=${extraOpsCommands.join(",") || "none"}`
  });
  const surfaceCanvasCount = parseDocCount(/### `\/canvas` command names \((\d+)\)/, surfaceDoc, "surface /canvas count");
  checks.push({
    id: "doc.surface.canvas_command_count_matches_source",
    ok: surfaceCanvasCount === canvasCommandCount,
    detail: `docs/SURFACE_REFERENCE.md /canvas count=${surfaceCanvasCount}, source=${canvasCommandCount}`
  });

  const cliCommandsCount = parseDocCount(/- Total commands: `([0-9]+)`\./, cliDoc, "CLI docs command count");
  const cliToolsCount = parseDocCount(/- Total tools: `([0-9]+)`/, cliDoc, "CLI docs tool count");
  checks.push({
    id: "doc.cli.command_count_matches_source",
    ok: cliCommandsCount === commandCount,
    detail: `docs/CLI.md command count=${cliCommandsCount}, source=${commandCount}`
  });
  checks.push({
    id: "doc.cli.tool_count_matches_source",
    ok: cliToolsCount === toolCount,
    detail: `docs/CLI.md tool count=${cliToolsCount}, source=${toolCount}`
  });

  checks.push({
    id: "doc.cli.no_stale_help_inventory_counts",
    ok: !cliDoc.includes("All CLI commands (61)")
      && !cliDoc.includes("All `opendevbrowser_*` tools (54)"),
    detail: "docs/CLI.md must not carry stale inline help inventory counts."
  });

  checks.push({
    id: "doc.cli.onboarding_help_path_documented",
    ok: cliDoc.includes("Generated help is the primary first-contact inventory and onboarding surface.")
      && cliDoc.includes(onboardingMetadata.quickStartCommands.promptingGuide)
      && cliDoc.includes(onboardingMetadata.quickStartCommands.skillLoad)
      && cliDoc.includes("node scripts/cli-onboarding-smoke.mjs"),
    detail: "docs/CLI.md must point first-contact agents to generated help, the canonical quick-start path, and the onboarding smoke lane."
  });

  const cliOpsCount = parseDocCount(/- `\/ops` \(default extension channel\): .* all `([0-9]+)` command names\./, cliDoc, "CLI docs /ops count");
  checks.push({
    id: "doc.cli.ops_command_count_matches_source",
    ok: cliOpsCount === opsCommandCount,
    detail: `docs/CLI.md /ops count=${cliOpsCount}, source=${opsCommandCount}`
  });

  const architectureOpsCount = parseDocCount(/- `\/ops` command names: `([0-9]+)`/, architectureDoc, "architecture /ops count");
  checks.push({
    id: "doc.architecture.ops_command_count_matches_source",
    ok: architectureOpsCount === opsCommandCount,
    detail: `docs/ARCHITECTURE.md /ops count=${architectureOpsCount}, source=${opsCommandCount}`
  });

  checks.push({
    id: "doc.surface.canvas_history_event_documented",
    ok: surfaceDoc.includes("canvas_history_requested")
      && surfaceDoc.includes("not be treated as a separate `/canvas` command"),
    detail: "docs/SURFACE_REFERENCE.md must document canvas_history_requested as an internal event, not a public /canvas command."
  });

  checks.push({
    id: "doc.surface.annotation_send_path_documented",
    ok: surfaceDoc.includes("annotation:sendPayload")
      && surfaceDoc.includes("store_agent_payload")
      && surfaceDoc.includes("AgentInbox"),
    detail: "docs/SURFACE_REFERENCE.md must document annotation:sendPayload -> store_agent_payload -> AgentInbox."
  });

  checks.push({
    id: "doc.onboarding.session_reuse_matrix_documented",
    ok: onboardingDoc.includes("Reuses the attached live tab or profile state.")
      && onboardingDoc.includes("Attempts readable system Chrome-family cookie bootstrap before first navigation.")
      && onboardingDoc.includes("explicit cookie add/override behavior"),
    detail: "docs/FIRST_RUN_ONBOARDING.md must document extension reuse, managed/cdpConnect bootstrap, and cookie-import override behavior."
  });

  checks.push({
    id: "doc.onboarding.help_led_quick_start_documented",
    ok: onboardingDoc.includes("Validate the help-led quick-start path")
      && onboardingDoc.includes(onboardingMetadata.quickStartCommands.promptingGuide)
      && onboardingDoc.includes(onboardingMetadata.quickStartCommands.skillLoad)
      && onboardingDoc.includes(onboardingMetadata.referencePaths.skillDoc),
    detail: "docs/FIRST_RUN_ONBOARDING.md must document the generated-help quick-start path and canonical skill runbook."
  });

  checks.push({
    id: "doc.readme.mirrored_help_inputs_documented",
    ok: docsReadme.includes("src/cli/help.ts")
      && docsReadme.includes("src/cli/onboarding-metadata.json")
      && docsReadme.includes("src/tools/surface.ts")
      && docsReadme.includes("skills/opendevbrowser-best-practices/SKILL.md"),
    detail: "docs/README.md must reference mirrored help inputs and the canonical direct-run policy owner."
  });

  checks.push({
    id: "doc.readme.onboarding_owner_boundaries_documented",
    ok: docsReadme.includes("generated help as the canonical first-contact discovery surface")
      && docsReadme.includes("docs/FIRST_RUN_ONBOARDING.md")
      && docsReadme.includes("skills/opendevbrowser-best-practices/SKILL.md")
      && docsReadme.includes("node scripts/cli-onboarding-smoke.mjs"),
    detail: "docs/README.md must define the onboarding ownership split and include the onboarding smoke lane."
  });

  checks.push({
    id: "doc.readme.challenge_override_contract_documented",
    ok: publicReadme.includes("challengeAutomationMode")
      && publicReadme.includes("browser_with_helper")
      && publicReadme.includes("run > session > config")
      && publicReadme.includes("browser-scoped")
      && publicReadme.includes("not a desktop agent"),
    detail: "README.md must document challengeAutomationMode, enum values, precedence, and the browser-scoped helper boundary."
  });

  checks.push({
    id: "doc.readme.skill_discovery_fallback_documented",
    ok: publicReadme.includes("Bundled package fallback")
      && publicReadme.includes("after `skillPaths`")
      && publicReadme.includes("when no installed copy matches"),
    detail: "README.md must document the bundled skill fallback after skillPaths."
  });

  checks.push({
    id: "doc.readme.skill_inventory_split_documented",
    ok: publicReadme.includes("copy all 11 bundled directories")
      && publicReadme.includes("9 canonical `opendevbrowser-*` packs")
      && publicReadme.includes("`research/` and `shopping/`")
      && publicReadme.includes("Only directories with `SKILL.md` are discoverable at runtime"),
    detail: "README.md must explain copied-versus-discoverable skill inventory."
  });

  checks.push({
    id: "doc.cli.challenge_override_contract_documented",
    ok: cliDoc.includes("challengeAutomationMode")
      && cliDoc.includes("browser_with_helper")
      && cliDoc.includes("run > session > config")
      && cliDoc.includes("browser-scoped")
      && cliDoc.includes("not a desktop agent"),
    detail: "docs/CLI.md must document challengeAutomationMode, enum values, precedence, and the browser-scoped helper boundary."
  });

  checks.push({
    id: "doc.cli.skill_discovery_fallback_documented",
    ok: cliDoc.includes("Bundled package fallback")
      && cliDoc.includes("after `skillPaths`")
      && cliDoc.includes("when no installed copy matches"),
    detail: "docs/CLI.md must document the bundled skill fallback after skillPaths."
  });

  checks.push({
    id: "doc.cli.skill_inventory_split_documented",
    ok: cliDoc.includes("copy all 11 bundled directories")
      && cliDoc.includes("9 canonical `opendevbrowser-*` packs")
      && cliDoc.includes("`research/` and `shopping/`")
      && cliDoc.includes("Only directories with `SKILL.md` are discoverable at runtime"),
    detail: "docs/CLI.md must explain copied-versus-discoverable skill inventory."
  });

  pushRequiredForbiddenTermsCheck(checks, {
    id: "doc.cli.workflow_key_contract_documented",
    source: cliDoc,
    required: ["meta.primaryConstraintSummary", "meta.metrics.reasonCodeDistribution", "meta.reasonCodeDistribution"],
    forbidden: ["primary_constraint_summary", "reason_code_distribution"],
    detail: "docs/CLI.md must document camelCase workflow summary and reason-code distribution keys without the removed snake_case aliases."
  });

  checks.push({
    id: "doc.architecture.canvas_history_event_documented",
    ok: architectureDoc.includes("canvas_history_requested")
      && architectureDoc.includes("canvas.history.undo")
      && architectureDoc.includes("canvas.history.redo"),
    detail: "docs/ARCHITECTURE.md must document the canvas history event boundary and public undo/redo commands."
  });

  checks.push({
    id: "doc.architecture.annotation_send_path_documented",
    ok: architectureDoc.includes("annotation:sendPayload")
      && architectureDoc.includes("store_agent_payload")
      && architectureDoc.includes("AgentInbox"),
    detail: "docs/ARCHITECTURE.md must document annotation:sendPayload -> store_agent_payload -> AgentInbox."
  });

  checks.push({
    id: "doc.architecture.challenge_override_contract_documented",
    ok: architectureDoc.includes("challengeAutomationMode")
      && architectureDoc.includes("browser_with_helper")
      && architectureDoc.includes("run > session > config")
      && architectureDoc.includes("browser-scoped")
      && architectureDoc.includes("not a desktop agent")
      && architectureDoc.includes("roadmap-only"),
    detail: "docs/ARCHITECTURE.md must document the challenge override contract, browser-only helper boundary, and roadmap-only desktop section."
  });

  checks.push({
    id: "doc.architecture.onboarding_owner_documented",
    ok: architectureDoc.includes("src/cli/onboarding-metadata.json")
      && architectureDoc.includes("first-contact skill, topic, quick-start commands, and onboarding doc pointers"),
    detail: "docs/ARCHITECTURE.md must document the onboarding metadata owner."
  });

  checks.push({
    id: "doc.architecture.onboarding_proof_lane_documented",
    ok: architectureDoc.includes("CLI onboarding proof lane")
      && architectureDoc.includes("node scripts/cli-onboarding-smoke.mjs"),
    detail: "docs/ARCHITECTURE.md must document the onboarding proof lane."
  });

  checks.push({
    id: "doc.surface.challenge_override_contract_documented",
    ok: surfaceDoc.includes("challengeAutomationMode")
      && surfaceDoc.includes("browser_with_helper")
      && surfaceDoc.includes("run > session > config")
      && surfaceDoc.includes("browser-scoped")
      && surfaceDoc.includes("standDownReason"),
    detail: "docs/SURFACE_REFERENCE.md must document workflow challenge override flags, precedence, and surfaced stand-down metadata."
  });

  pushRequiredForbiddenTermsCheck(checks, {
    id: "doc.surface.workflow_key_contract_documented",
    source: surfaceDoc,
    required: ["meta.primaryConstraintSummary", "meta.metrics.reasonCodeDistribution", "meta.reasonCodeDistribution"],
    forbidden: ["primary_constraint_summary", "reason_code_distribution"],
    detail: "docs/SURFACE_REFERENCE.md must document the camelCase workflow summary and reason-code distribution keys without the removed snake_case aliases."
  });

  checks.push({
    id: "doc.annotate.shared_inbox_delivery_documented",
    ok: annotateDoc.includes("annotation:sendPayload")
      && annotateDoc.includes("store_agent_payload")
      && annotateDoc.includes("AgentInbox")
      && annotateDoc.includes("Stored only; fetch with annotate --stored"),
    detail: "docs/ANNOTATE.md must document the annotation send bridge, AgentInbox receipt path, and stored-only fallback."
  });

  checks.push({
    id: "doc.extension.annotation_and_canvas_registration_documented",
    ok: extensionDoc.includes("annotation:sendPayload")
      && extensionDoc.includes("store_agent_payload")
      && extensionDoc.includes("AgentInbox")
      && extensionDoc.includes("targets.registerCanvas")
      && extensionDoc.includes("targets.use"),
    detail: "docs/EXTENSION.md must document annotation send bridging and canvas target registration."
  });

  checks.push({
    id: "doc.troubleshooting.session_reuse_and_policy_pointer_documented",
    ok: troubleshootingDoc.includes("canvas_history_requested")
      && troubleshootingDoc.includes("AgentInbox")
      && troubleshootingDoc.includes("Chrome-family cookie bootstrap")
      && troubleshootingDoc.includes("skills/opendevbrowser-best-practices/SKILL.md"),
    detail: "docs/TROUBLESHOOTING.md must document history event wording, AgentInbox send fallback, cookie bootstrap, and the canonical direct-run policy pointer."
  });

  pushRequiredForbiddenTermsCheck(checks, {
    id: "doc.troubleshooting.workflow_key_contract_documented",
    source: troubleshootingDoc,
    required: ["meta.primaryConstraintSummary", "meta.metrics.reasonCodeDistribution", "meta.reasonCodeDistribution"],
    forbidden: ["primary_constraint_summary", "reason_code_distribution"],
    detail: "docs/TROUBLESHOOTING.md must document camelCase workflow summary and reason-code distribution keys without the removed snake_case aliases."
  });

  checks.push({
    id: "doc.privacy.challenge_override_boundary_documented",
    ok: privacyDoc.includes("challengeAutomationMode")
      && privacyDoc.includes("browser-scoped")
      && privacyDoc.includes("not a desktop agent"),
    detail: "docs/privacy.md must document that challengeAutomationMode stays local and the helper bridge remains browser-scoped only."
  });

  checks.push({
    id: "doc.dependencies.challenge_override_config_audit_documented",
    ok: dependenciesDoc.includes("No package.json, tsconfig.json, eslint.config.js, or vitest.config.ts changes were required")
      && dependenciesDoc.includes("No Vite config exists in the public repo")
      && dependenciesDoc.includes("No new package dependencies were required for")
      && dependenciesDoc.includes("challengeAutomationMode"),
    detail: "docs/DEPENDENCIES.md must record the no-new-dependencies and no-config-drift audit for the challenge override rollout."
  });

  checks.push({
    id: "doc.cutover.challenge_override_sync_documented",
    ok: cutoverDoc.includes("challengeAutomationMode")
      && cutoverDoc.includes("run > session > config")
      && cutoverDoc.includes("docs/privacy.md")
      && cutoverDoc.includes("docs/DEPENDENCIES.md")
      && cutoverDoc.includes("docs/CUTOVER_CHECKLIST.md"),
    detail: "docs/CUTOVER_CHECKLIST.md must include challenge override doc-sync and config-audit steps."
  });

  checks.push({
    id: "skill.best_practices.direct_run_policy_owner_documented",
    ok: bestPracticesSkill.includes("canonical owner of direct-run release evidence policy"),
    detail: "skills/opendevbrowser-best-practices/SKILL.md must own direct-run release evidence policy."
  });
  checks.push({
    id: "skill.best_practices.surface_counts_match_source",
    ok: bestPracticesSkill.includes(`${commandCount} CLI commands, ${toolCount} tools, ${opsCommandCount} \`/ops\` commands, ${canvasCommandCount} \`/canvas\` commands`),
    detail: `skills/opendevbrowser-best-practices/SKILL.md must mirror source counts ${commandCount}/${toolCount}/${opsCommandCount}/${canvasCommandCount}.`
  });

  checks.push({
    id: "skill.command_channel_reference.canvas_and_annotation_markers_documented",
    ok: commandChannelReference.includes("canvas_history_requested")
      && commandChannelReference.includes("annotation:sendPayload")
      && commandChannelReference.includes("AgentInbox"),
    detail: "command-channel-reference must document canvas history events and the annotation AgentInbox path."
  });
  const commandChannelCliCount = parseDocCount(/- CLI commands: `([0-9]+)`/, commandChannelReference, "best-practices CLI count");
  const commandChannelToolCount = parseDocCount(/- Plugin tools: `([0-9]+)`/, commandChannelReference, "best-practices tool count");
  const commandChannelOpsCount = parseDocCount(/- `\/ops` command names: `([0-9]+)`/, commandChannelReference, "best-practices /ops count");
  const commandChannelCanvasCount = parseDocCount(/- `\/canvas` command names: `([0-9]+)`/, commandChannelReference, "best-practices /canvas count");
  checks.push({
    id: "skill.command_channel_reference.surface_counts_match_source",
    ok: commandChannelCliCount === commandCount
      && commandChannelToolCount === toolCount
      && commandChannelOpsCount === opsCommandCount
      && commandChannelCanvasCount === canvasCommandCount,
    detail: `command-channel-reference counts cli=${commandChannelCliCount}/${commandCount}, tools=${commandChannelToolCount}/${toolCount}, ops=${commandChannelOpsCount}/${opsCommandCount}, canvas=${commandChannelCanvasCount}/${canvasCommandCount}`
  });
  checks.push({
    id: "skill.surface_audit_checklist.counts_match_source",
    ok: surfaceAuditChecklist?.expectedCounts?.cliCommands === commandCount
      && surfaceAuditChecklist?.expectedCounts?.tools === toolCount
      && surfaceAuditChecklist?.expectedCounts?.opsCommands === opsCommandCount
      && surfaceAuditChecklist?.expectedCounts?.canvasCommands === canvasCommandCount,
    detail: `surface-audit-checklist counts cli=${surfaceAuditChecklist?.expectedCounts?.cliCommands ?? "missing"}/${commandCount}, tools=${surfaceAuditChecklist?.expectedCounts?.tools ?? "missing"}/${toolCount}, ops=${surfaceAuditChecklist?.expectedCounts?.opsCommands ?? "missing"}/${opsCommandCount}, canvas=${surfaceAuditChecklist?.expectedCounts?.canvasCommands ?? "missing"}/${canvasCommandCount}`
  });

  checks.push({
    id: "skill.design_agent.canvas_validation_markers_documented",
    ok: designSkill.includes("canvas.history.undo")
      && designSkill.includes("canvas.history.redo")
      && designSkill.includes("canvas_history_requested")
      && designSkill.includes("Delivered to agent")
      && designSkill.includes("Stored only; fetch with annotate --stored"),
    detail: "design-agent skill must document history control validation and annotation send receipts."
  });

  checks.push({
    id: "skill.continuity_ledger.core_markers_documented",
    ok: continuitySkill.includes("CONTINUITY.md")
      && continuitySkill.includes("sub_continuity.md")
      && continuitySkill.includes("Reply Pattern"),
    detail: "continuity-ledger skill must document ledger files and the reply pattern."
  });

  checks.push({
    id: "skill.data_extraction.core_markers_documented",
    ok: dataExtractionSkill.includes("source_url")
      && dataExtractionSkill.includes("assets/templates/quality-gates.json")
      && dataExtractionSkill.includes("ISSUE-09"),
    detail: "data-extraction skill must document provenance, quality gates, and pagination drift coverage."
  });

  checks.push({
    id: "skill.login_and_form_session_reuse_documented",
    ok: loginSkill.includes("Chrome-family cookie bootstrap")
      && loginSkill.toLowerCase().includes("direct-run release evidence policy")
      && formSkill.includes("Chrome-family cookie bootstrap")
      && formSkill.toLowerCase().includes("direct-run release evidence policy"),
    detail: "login/form skills must document session reuse rules and the canonical direct-run policy pointer."
  });

  checks.push({
    id: "skill.research_and_shopping_policy_pointers_documented",
    ok: researchSkill.includes("canonical direct-run evidence policy")
      && shoppingSkill.includes("canonical direct-run evidence policy"),
    detail: "research/shopping skills must point to the canonical direct-run policy."
  });

  checks.push({
    id: "skill.product_presentation_asset.core_markers_documented",
    ok: productPresentationAssetSkill.includes("metadata-first")
      && productPresentationAssetSkill.includes("scripts/render-video-brief.sh")
      && productPresentationAssetSkill.includes("claims-evidence-map.md"),
    detail: "product-presentation-asset skill must document metadata-first output handling and generated evidence maps."
  });

  checks.push({
    id: "doc.cli.current_package_version_ref",
    ok: cliDoc.includes(`opendevbrowser-${version}.tgz`),
    detail: `docs/CLI.md should reference opendevbrowser-${version}.tgz`
  });

  checks.push({
    id: "doc.onboarding.current_package_version_ref",
    ok: onboardingDoc.includes(`opendevbrowser-${version}.tgz`),
    detail: `docs/FIRST_RUN_ONBOARDING.md should reference opendevbrowser-${version}.tgz`
  });

  const failed = checks.filter((check) => !check.ok);

  return {
    ok: failed.length === 0,
    version,
    source: {
      commandCount,
      toolCount,
      opsCommandCount,
      canvasCommandCount
    },
    checks,
    failed
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = runDocsDriftChecks();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exitCode = 1;
  }
}
