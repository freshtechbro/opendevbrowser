#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function extractCountFromSource(pattern, source, label) {
  const match = source.match(pattern);
  if (!match) {
    throw new Error(`Unable to parse ${label}.`);
  }
  const values = [...match[1].matchAll(/"([^"]+)"/g)];
  return values.length;
}

export function getSurfaceCounts() {
  const argsSource = read("src/cli/args.ts");
  const toolsSource = read("src/tools/index.ts");
  const opsSource = read("extension/src/ops/ops-runtime.ts");
  const canvasSource = read("src/browser/canvas-manager.ts");

  const commandCount = extractCountFromSource(/export const CLI_COMMANDS = \[(.*?)\] as const;/s, argsSource, "CLI commands");
  const toolCount = [...toolsSource.matchAll(/\s(opendevbrowser_[a-z_]+):/g)].length;
  const opsCommandNames = [...opsSource.matchAll(/case "([^"]+)":/g)].map((match) => match[1]);
  const canvasCommandCount = extractCountFromSource(/export const PUBLIC_CANVAS_COMMANDS = \[(.*?)\] as const;/s, canvasSource, "public canvas commands");

  return {
    commandCount,
    toolCount,
    opsCommandCount: opsCommandNames.length,
    canvasCommandCount,
    opsCommandNames
  };
}

function parseDocCount(regex, source, label) {
  const match = source.match(regex);
  if (!match) {
    throw new Error(`Unable to parse ${label}.`);
  }
  return Number.parseInt(match[1], 10);
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

export function runDocsDriftChecks() {
  const packageJson = JSON.parse(read("package.json"));
  const version = String(packageJson.version ?? "");
  if (!version) {
    throw new Error("package.json version is missing.");
  }

  const cliDoc = read("docs/CLI.md");
  const docsReadme = read("docs/README.md");
  const onboardingDoc = read("docs/FIRST_RUN_ONBOARDING.md");
  const surfaceDoc = read("docs/SURFACE_REFERENCE.md");
  const architectureDoc = read("docs/ARCHITECTURE.md");
  const annotateDoc = read("docs/ANNOTATE.md");
  const extensionDoc = read("docs/EXTENSION.md");
  const troubleshootingDoc = read("docs/TROUBLESHOOTING.md");
  const bestPracticesSkill = read("skills/opendevbrowser-best-practices/SKILL.md");
  const commandChannelReference = read("skills/opendevbrowser-best-practices/artifacts/command-channel-reference.md");
  const surfaceAuditChecklist = JSON.parse(read("skills/opendevbrowser-best-practices/assets/templates/surface-audit-checklist.json"));
  const designSkill = read("skills/opendevbrowser-design-agent/SKILL.md");
  const loginSkill = read("skills/opendevbrowser-login-automation/SKILL.md");
  const formSkill = read("skills/opendevbrowser-form-testing/SKILL.md");
  const researchSkill = read("skills/opendevbrowser-research/SKILL.md");
  const shoppingSkill = read("skills/opendevbrowser-shopping/SKILL.md");

  const { commandCount, toolCount, opsCommandCount, canvasCommandCount, opsCommandNames } = getSurfaceCounts();

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
    id: "doc.readme.mirrored_help_inputs_documented",
    ok: docsReadme.includes("src/cli/help.ts")
      && docsReadme.includes("src/tools/surface.ts")
      && docsReadme.includes("skills/opendevbrowser-best-practices/SKILL.md"),
    detail: "docs/README.md must reference mirrored help inputs and the canonical direct-run policy owner."
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
