import type { Plugin } from "@opencode-ai/plugin";
import { loadGlobalConfig, ConfigStore } from "./config";
import { BrowserManager } from "./browser/browser-manager";
import { ScriptRunner } from "./browser/script-runner";
import { SkillLoader } from "./skills/skill-loader";
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
import { RelayServer } from "./relay/relay-server";
import { createTools } from "./tools";
import { extractExtension, getExtensionPath } from "./extension-extractor";

const OpenDevBrowserPlugin: Plugin = async ({ directory, worktree }) => {
  const initialConfig = loadGlobalConfig();
  const configStore = new ConfigStore(initialConfig);
  const cacheRoot = worktree || directory;
  const manager = new BrowserManager(cacheRoot, initialConfig);
  const runner = new ScriptRunner(manager);
  const skills = new SkillLoader(cacheRoot, initialConfig.skillPaths);
  const relay = new RelayServer();
  const skillNudgeState = createSkillNudgeState();
  const continuityNudgeState = createContinuityNudgeState();
  relay.setToken(initialConfig.relayToken);

  // Minimal startup signal for local testing/debugging.
  // Avoid logging secrets (relayToken can be a string).
  console.info(
    `[opendevbrowser] loaded (cacheRoot=${cacheRoot}, relay=${initialConfig.relayToken === false ? "disabled" : "enabled"})`
  );

  try {
    extractExtension();
  } catch (error) {
    // Extension extraction is best-effort; keep plugin usable if it fails.
    console.warn("Extension extraction failed:", error instanceof Error ? error.message : error);
  }

  const ensureRelay = async (port: number) => {
    if (port <= 0 || initialConfig.relayToken === false) {
      relay.stop();
      return;
    }
    const status = relay.status();
    if (status.running && status.port === port) {
      return;
    }
    relay.stop();
    try {
      await relay.start(port);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("EADDRINUSE") || message.includes("in use")) {
        console.warn(`[opendevbrowser] Relay server port ${port} is already in use. Extension pairing will be unavailable.`);
        console.warn(`[opendevbrowser] To fix: kill the process using port ${port} or change relayPort in config.`);
      } else {
        console.warn(`[opendevbrowser] Failed to start relay server: ${message}`);
      }
      // Security: we explicitly allow the plugin to continue without the relay server
      // to ensure core functionality remains available even if the port is blocked.
    }
  };

  // Necessary: clean up all browser sessions and the relay server on exit
  // to prevent zombie processes and locked ports.
  const cleanup = () => {
    relay.stop();
    manager.closeAll().catch(() => {});
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
  process.on("beforeExit", cleanup);

  await ensureRelay(initialConfig.relayPort);

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
