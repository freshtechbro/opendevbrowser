import type { Plugin } from "@opencode-ai/plugin";
import { createOpenDevBrowserCore } from "./core";
import { ScriptRunner } from "./browser/script-runner";
import { readDaemonMetadata, startDaemon } from "./cli/daemon";
import { DaemonClient } from "./cli/daemon-client";
import { RemoteManager } from "./cli/remote-manager";
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
  const { config, configStore, skills, relay, ensureRelay, cleanup, getExtensionPath } = core;
  let manager = core.manager;
  let runner = core.runner;
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

  const hubEnabled = config.relayToken !== false && config.relayPort > 0;
  if (hubEnabled) {
    const metadata = readDaemonMetadata();
    const status = metadata ? await fetchDaemonStatus(metadata.port, metadata.token) : null;
    if (status?.ok) {
      daemonClient = new DaemonClient({ autoRenew: true });
      manager = new RemoteManager(daemonClient);
      runner = new ScriptRunner(manager);
    } else {
      try {
        const { stop } = await startDaemon({ config, directory, worktree });
        hubStop = stop;
        daemonClient = new DaemonClient({ autoRenew: true });
        manager = new RemoteManager(daemonClient);
        runner = new ScriptRunner(manager);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[opendevbrowser] Hub daemon start failed; falling back to local relay: ${message}`);
        await ensureRelay(config.relayPort);
      }
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

type DaemonStatus = { ok: boolean };

async function fetchDaemonStatus(port: number, token: string): Promise<DaemonStatus | null> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/status`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) return null;
    return await response.json() as DaemonStatus;
  } catch {
    return null;
  }
}

export default OpenDevBrowserPlugin;
