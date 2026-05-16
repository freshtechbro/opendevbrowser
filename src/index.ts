import type { Plugin } from "@opencode-ai/plugin";
import { createOpenDevBrowserCore } from "./core";
import { ScriptRunner } from "./browser/script-runner";
import {
  createDaemonStopHeaders,
  isCurrentDaemonFingerprint,
  readDaemonMetadata,
  startDaemon
} from "./cli/daemon";
import { DaemonClient } from "./cli/daemon-client";
import { RemoteManager } from "./cli/remote-manager";
import { RemoteCanvasManager } from "./cli/remote-canvas-manager";
import { RemoteDesktopRuntime } from "./cli/remote-desktop-runtime";
import { RemoteRelay } from "./cli/remote-relay";
import { fetchDaemonStatus, fetchDaemonStatusFromMetadata, type DaemonStatusPayload } from "./cli/daemon-status";
import { DEFAULT_DAEMON_STATUS_FETCH_OPTIONS } from "./cli/daemon-status-policy";
import { fetchWithTimeout } from "./cli/utils/http";
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
import { requireChallengeOrchestrationConfig } from "./config";

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
    workspaceRoot: core.cacheRoot,
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
    const currentConfig = configStore.get();
    const challengeConfig = requireChallengeOrchestrationConfig(currentConfig);
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
      config: currentConfig,
      manager,
      challengeConfig
    }));
    automationCoordinator = createAutomationCoordinator({
      manager,
      desktopRuntime,
      challengeMode: challengeConfig.mode,
      governedLanes: challengeConfig.governed,
      helperBridgeEnabled: challengeConfig.optionalComputerUseBridge.enabled,
      snapshotMaxChars: currentConfig.snapshot.maxChars
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

  const readEnsureHubBudgetMs = (deadlineMs: number): number | null => {
    const remainingMs = deadlineMs - Date.now();
    return remainingMs > 0 ? remainingMs : null;
  };

  const stopTimeoutMs = (deadlineMs: number): number => {
    return Math.max(1, Math.min(500, readEnsureHubBudgetMs(deadlineMs) ?? 1));
  };

  const resolveHubStopConnection = (
    currentConfig: { daemonPort: number; daemonToken: string },
    status: DaemonStatusPayload
  ) => {
    const metadata = readDaemonMetadata();
    if (metadata?.pid === status.pid) {
      return { port: metadata.port, token: metadata.token };
    }
    return { port: currentConfig.daemonPort, token: currentConfig.daemonToken };
  };

  const isConfiguredHubConnection = (
    currentConfig: { daemonPort: number; daemonToken: string },
    connection: { port: number; token: string }
  ): boolean => {
    return connection.port === currentConfig.daemonPort && connection.token === currentConfig.daemonToken;
  };

  const waitForHubDaemonShutdown = async (
    connection: { port: number; token: string },
    deadlineMs: number
  ): Promise<boolean> => {
    while (readEnsureHubBudgetMs(deadlineMs)) {
      const status = await fetchDaemonStatus(connection.port, connection.token, {
        timeoutMs: stopTimeoutMs(deadlineMs)
      });
      if (!status?.ok) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, Math.min(100, stopTimeoutMs(deadlineMs))));
    }
    return false;
  };

  const stopMismatchedHubDaemon = async (
    currentConfig: ReturnType<typeof configStore.get>,
    status: DaemonStatusPayload,
    deadlineMs: number
  ): Promise<void> => {
    const connection = resolveHubStopConnection(currentConfig, status);
    const configuredConnection = isConfiguredHubConnection(currentConfig, connection);
    let response: Response;
    try {
      response = await fetchWithTimeout(`http://127.0.0.1:${connection.port}/stop`, {
        method: "POST",
        headers: createDaemonStopHeaders(connection.token, "plugin.ensureHub.upgrade")
      }, stopTimeoutMs(deadlineMs));
    } catch (error) {
      if (!configuredConnection) {
        return;
      }
      throw error instanceof Error ? error : new Error(String(error));
    }
    if (response.status === 409) {
      if (!configuredConnection) {
        return;
      }
      throw new Error(`Hub daemon on 127.0.0.1:${connection.port} pid=${status.pid} is protected by a different opendevbrowser build.`);
    }
    if (!response.ok) {
      if (!configuredConnection) {
        return;
      }
      throw new Error(`Hub daemon stop failed with status ${response.status}.`);
    }
    if (!(await waitForHubDaemonShutdown(connection, deadlineMs))) {
      if (!configuredConnection) {
        return;
      }
      throw new Error(`Timed out waiting for hub daemon on 127.0.0.1:${connection.port} to stop.`);
    }
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
      const statusTimeoutMs = readEnsureHubBudgetMs(deadline);
      if (!statusTimeoutMs) {
        break;
      }
      const status = await fetchDaemonStatusFromMetadata(currentConfig, {
        ...DEFAULT_DAEMON_STATUS_FETCH_OPTIONS,
        timeoutMs: statusTimeoutMs
      });
      if (status?.ok) {
        if (isCurrentDaemonFingerprint(status.fingerprint)) {
          bindRemote();
          await relay?.refresh?.();
          return;
        }
        await stopMismatchedHubDaemon(currentConfig, status, deadline);
      }
      if (!readEnsureHubBudgetMs(deadline)) {
        break;
      }
      try {
        const { stop } = await startDaemon({ config: currentConfig, directory, worktree });
        hubStop = stop;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
      const refreshedTimeoutMs = readEnsureHubBudgetMs(deadline);
      if (!refreshedTimeoutMs) {
        break;
      }
      const refreshedStatus = await fetchDaemonStatusFromMetadata(currentConfig, {
        ...DEFAULT_DAEMON_STATUS_FETCH_OPTIONS,
        timeoutMs: refreshedTimeoutMs
      });
      if (refreshedStatus?.ok) {
        if (isCurrentDaemonFingerprint(refreshedStatus.fingerprint)) {
          bindRemote();
          await relay?.refresh?.();
          return;
        }
        await stopMismatchedHubDaemon(currentConfig, refreshedStatus, deadline);
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
