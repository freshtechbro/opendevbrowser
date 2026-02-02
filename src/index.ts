import type { Plugin } from "@opencode-ai/plugin";
import { createOpenDevBrowserCore } from "./core";
import { ScriptRunner } from "./browser/script-runner";
import { startDaemon } from "./cli/daemon";
import { DaemonClient } from "./cli/daemon-client";
import { RemoteManager } from "./cli/remote-manager";
import { RemoteRelay } from "./cli/remote-relay";
import { fetchDaemonStatusFromMetadata } from "./cli/daemon-status";
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
import { isHubEnabled } from "./utils/hub-enabled";
import type { RelayLike } from "./relay/relay-types";
import type { ToolDeps } from "./tools/deps";

const OpenDevBrowserPlugin: Plugin = async ({ directory, worktree }) => {
  const core = createOpenDevBrowserCore({ directory, worktree });
  const { config, configStore, skills, ensureRelay, cleanup, getExtensionPath } = core;
  let relay: RelayLike = core.relay;
  let manager = core.manager;
  let runner = core.runner;
  let annotationManager = core.annotationManager;
  let hubStop: (() => Promise<void>) | null = null;
  let daemonClient: DaemonClient | null = null;
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

  const toolDeps: ToolDeps = {
    manager,
    annotationManager,
    runner,
    config: configStore,
    skills,
    relay,
    getExtensionPath
  };

  const bindRemote = () => {
    if (!daemonClient) {
      daemonClient = new DaemonClient({ autoRenew: true });
    }
    manager = new RemoteManager(daemonClient);
    relay = new RemoteRelay(daemonClient);
    annotationManager.setRelay(relay);
    annotationManager.setBrowserManager(manager);
    runner = new ScriptRunner(manager);
    toolDeps.manager = manager;
    toolDeps.relay = relay;
    toolDeps.runner = runner;
  };

  const ensureHub = async (): Promise<void> => {
    const currentConfig = configStore.get();
    if (!isHubEnabled(currentConfig)) {
      return;
    }
    if (!daemonClient) {
      daemonClient = new DaemonClient({ autoRenew: true });
    }

    const deadline = Date.now() + 2000;
    let attempt = 0;
    let lastError: Error | null = null;

    while (attempt < 2 && Date.now() < deadline) {
      attempt += 1;
      const status = await fetchDaemonStatusFromMetadata(currentConfig);
      if (status?.ok) {
        bindRemote();
        await relay?.refresh?.();
        return;
      }
      try {
        const { stop } = await startDaemon({ config: currentConfig, directory, worktree });
        hubStop = stop;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
      if (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    if (lastError) {
      throw lastError;
    }
    throw new Error("Hub daemon unavailable.");
  };

  toolDeps.ensureHub = ensureHub;

  const hubEnabled = isHubEnabled(config);
  if (hubEnabled) {
    bindRemote();
    try {
      await ensureHub();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[opendevbrowser] Hub daemon unavailable: ${message}`);
    }
  } else {
    await ensureRelay(config.relayPort);
  }

  const cleanupAll = () => {
    if (hubStop) {
      hubStop().catch(() => {});
    }
    daemonClient?.releaseBinding().catch(() => {});
    cleanup();
  };

  process.on("SIGINT", cleanupAll);
  process.on("SIGTERM", cleanupAll);
  process.on("beforeExit", cleanupAll);

  return {
    tool: createTools(toolDeps),
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
