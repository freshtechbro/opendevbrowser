import type { Plugin } from "@opencode-ai/plugin";
import { createOpenDevBrowserCore } from "./core";
import {
  buildSkillNudgeMessage,
  clearSkillNudge,
  consumeSkillNudge,
  createSkillNudgeState,
  extractTextFromParts,
  markSkillNudge,
  shouldTriggerSkillNudge,
  SKILL_NUDGE_MARKER
} from "./skills/skill-nudge";
import {
  buildContinuityNudgeMessage,
  clearContinuityNudge,
  consumeContinuityNudge,
  createContinuityNudgeState,
  markContinuityNudge,
  shouldTriggerContinuityNudge,
  CONTINUITY_NUDGE_MARKER
} from "./skills/continuity-nudge";
import { createTools } from "./tools";
import { extractExtension } from "./extension-extractor";

const OpenDevBrowserPlugin: Plugin = async ({ directory, worktree }) => {
  const core = createOpenDevBrowserCore({ directory, worktree });
  const { config, configStore, manager, runner, skills, relay, ensureRelay, cleanup, getExtensionPath } = core;
  const skillNudgeState = createSkillNudgeState();
  const continuityNudgeState = createContinuityNudgeState();

  // Minimal startup signal for local testing/debugging.
  // Avoid logging secrets (relayToken can be a string).
  console.info(
    `[opendevbrowser] loaded (cacheRoot=${core.cacheRoot}, relay=${config.relayToken === false ? "disabled" : "enabled"})`
  );

  try {
    extractExtension();
  } catch (error) {
    // Extension extraction is best-effort; keep plugin usable if it fails.
    console.warn("Extension extraction failed:", error instanceof Error ? error.message : error);
  }

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
  process.on("beforeExit", cleanup);

  await ensureRelay(config.relayPort);

  return {
    tool: createTools({ manager, runner, config: configStore, skills, relay, getExtensionPath }),
    "chat.message": async (_input, output) => {
      const config = configStore.get();
      if (output.message.role !== "user") return;

      const text = extractTextFromParts(output.parts);
      if (!text) return;

      if (config.skills.nudge.enabled && shouldTriggerSkillNudge(text, config.skills.nudge.keywords)) {
        markSkillNudge(skillNudgeState, Date.now());
      }

      if (config.continuity.enabled && config.continuity.nudge.enabled) {
        if (shouldTriggerContinuityNudge(text, config.continuity.nudge.keywords)) {
          markContinuityNudge(continuityNudgeState, Date.now());
        }
      }
    },
    "experimental.chat.system.transform": async (_input, output) => {
      const config = configStore.get();
      const systemEntries = output.system ?? [];
      let nextEntries = systemEntries;
      let changed = false;

      if (config.skills.nudge.enabled) {
        if (systemEntries.some((entry) => entry.includes(SKILL_NUDGE_MARKER))) {
          clearSkillNudge(skillNudgeState);
        } else if (consumeSkillNudge(skillNudgeState, Date.now(), config.skills.nudge.maxAgeMs)) {
          nextEntries = [...nextEntries, buildSkillNudgeMessage()];
          changed = true;
        }
      }

      if (config.continuity.enabled && config.continuity.nudge.enabled) {
        if (systemEntries.some((entry) => entry.includes(CONTINUITY_NUDGE_MARKER))) {
          clearContinuityNudge(continuityNudgeState);
        } else if (consumeContinuityNudge(
          continuityNudgeState,
          Date.now(),
          config.continuity.nudge.maxAgeMs
        )) {
          nextEntries = [...nextEntries, buildContinuityNudgeMessage(config.continuity.filePath)];
          changed = true;
        }
      }

      if (changed) {
        output.system = nextEntries;
      }
    }
  };
};

export default OpenDevBrowserPlugin;
