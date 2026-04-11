import type { Plugin } from "@opencode-ai/plugin";
import { createOpenDevBrowserCore } from "./core";
import { ScriptRunner } from "./browser/script-runner";
import { startDaemon } from "./cli/daemon";
import { DaemonClient } from "./cli/daemon-client";
import { RemoteManager } from "./cli/remote-manager";
import { RemoteCanvasManager } from "./cli/remote-canvas-manager";
import { RemoteDesktopRuntime } from "./cli/remote-desktop-runtime";
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
import { AGENT_INBOX_SYSTEM_MARKER } from "./annotate/agent-inbox";
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
import { createCoreRuntimeAssemblies } from "./core";
import { createAutomationCoordinator } from "./automation/coordinator";

const OpenDevBrowserPlugin: Plugin = async ({ directory, worktree }) => {
  const core = createOpenDevBrowserCore({ directory, worktree });
  const { config, configStore, skills, ensureRelay, cleanup, getExtensionPath, agentInbox } = core;
  let relay: RelayLike = core.relay;
  let manager = core.manager;
  let canvasManager = core.canvasManager;
  let runner = core.runner;
  let annotationManager = core.annotationManager;
  let desktopRuntime = core.desktopRuntime;
  let automationCoordinator = core.automationCoordinator;
  let providerRuntime = core.providerRuntime;
  let browserFallbackPort = core.browserFallbackPort;
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
    canvasManager,
    annotationManager,
    runner,
    config: configStore,
    skills,
    desktopRuntime,
    automationCoordinator,
    providerRuntime,
    browserFallbackPort,
    relay,
    getExtensionPath
  };

  const bindRemote = () => {
    if (!daemonClient) {
      daemonClient = new DaemonClient({ autoRenew: true });
    }
    manager = new RemoteManager(daemonClient);
    canvasManager = new RemoteCanvasManager(daemonClient);
    desktopRuntime = new RemoteDesktopRuntime(daemonClient);
    relay = new RemoteRelay(daemonClient);
    annotationManager.setRelay(relay);
    annotationManager.setBrowserManager(manager);
    runner = new ScriptRunner(manager);
    ({
      providerRuntime,
      browserFallbackPort
    } = createCoreRuntimeAssemblies({
      cacheRoot: core.cacheRoot,
      config: configStore.get(),
      manager
    }));
    automationCoordinator = createAutomationCoordinator({
      manager,
      desktopRuntime
    });
    toolDeps.manager = manager;
    toolDeps.canvasManager = canvasManager;
    toolDeps.relay = relay;
    toolDeps.runner = runner;
    toolDeps.desktopRuntime = desktopRuntime;
    toolDeps.automationCoordinator = automationCoordinator;
    toolDeps.providerRuntime = providerRuntime;
    toolDeps.browserFallbackPort = browserFallbackPort;
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

  const registerAgentInboxScope = (sessionID?: string, registration?: {
    messageId?: string | null;
    agent?: string | null;
    model?: {
      providerID: string;
      modelID: string;
    } | null;
    variant?: string | null;
  }) => {
    if (!sessionID) {
      return;
    }
    try {
      agentInbox.registerScope(sessionID, registration);
    } catch (error) {
      console.warn(
        "[opendevbrowser] Failed to register agent inbox scope:",
        error instanceof Error ? error.message : String(error)
      );
    }
  };

  return {
    tool: createTools(toolDeps),
    "chat.message": async (input, output) => {
      const config = configStore.get();
      if (output.message.role !== "user") return;

      registerAgentInboxScope(input.sessionID, {
        messageId: input.messageID ?? null,
        agent: input.agent ?? null,
        model: input.model ?? null,
        variant: input.variant ?? null
      });

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
    "experimental.chat.system.transform": async (input, output) => {
      const config = configStore.get();
      const systemEntries = output.system ?? [];
      let nextEntries = systemEntries;
      let changed = false;

      registerAgentInboxScope(input.sessionID, {
        model: null
      });
      if (
        input.sessionID
        && !systemEntries.some((entry) => entry.includes(AGENT_INBOX_SYSTEM_MARKER))
      ) {
        const injection = agentInbox.buildSystemInjection(input.sessionID);
        if (injection) {
          nextEntries = [...nextEntries, injection.systemBlock];
          agentInbox.acknowledge(injection.receiptIds);
          changed = true;
        }
      }

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
