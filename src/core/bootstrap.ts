import { BrowserManager } from "../browser/browser-manager";
import { OpsBrowserManager } from "../browser/ops-browser-manager";
import { AnnotationManager } from "../browser/annotation-manager";
import { CanvasManager } from "../browser/canvas-manager";
import { ScriptRunner } from "../browser/script-runner";
import { AgentInbox } from "../annotate/agent-inbox";
import {
  ConfigStore,
  loadGlobalConfig,
  requireChallengeOrchestrationConfig,
  resolveConfig
} from "../config";
import { getExtensionPath } from "../extension-extractor";
import { RelayServer } from "../relay/relay-server";
import { SkillLoader } from "../skills/skill-loader";
import { ChallengeOrchestrator } from "../challenges";
import type { CoreOptions, OpenDevBrowserCore } from "./types";
import { createCoreRuntimeAssemblies } from "./runtime-assemblies";

export function createOpenDevBrowserCore(options: CoreOptions): OpenDevBrowserCore {
  const config = typeof options.config === "undefined"
    ? loadGlobalConfig()
    : resolveConfig(options.config);
  const configStore = new ConfigStore(config);
  const cacheRoot = options.worktree ?? options.directory;
  const challengeConfig = requireChallengeOrchestrationConfig(config);
  const baseManager = new BrowserManager(cacheRoot, config);
  const manager = new OpsBrowserManager(baseManager, config, cacheRoot);
  const challengeOrchestrator = new ChallengeOrchestrator(challengeConfig);
  baseManager.setChallengeOrchestrator(challengeOrchestrator);
  manager.setChallengeOrchestrator(challengeOrchestrator);
  const runner = new ScriptRunner(manager);
  const skills = new SkillLoader(cacheRoot, config.skillPaths);
  const agentInbox = new AgentInbox(cacheRoot);
  const {
    providerRuntime,
    browserFallbackPort,
    desktopRuntime,
    automationCoordinator
  } = createCoreRuntimeAssemblies({
    cacheRoot,
    config,
    manager,
    challengeConfig,
    challengeOrchestrator
  });
  const relay = new RelayServer();
  relay.setToken(config.relayToken);
  relay.setStoreAgentPayloadHandler(async (command) => {
    if (!command.payload) {
      return {
        version: 1,
        requestId: command.requestId,
        status: "error",
        error: { code: "invalid_request", message: "Annotation payload required for store_agent_payload." }
      };
    }
    const receipt = agentInbox.enqueue({
      payload: command.payload,
      source: command.source ?? "popup_all",
      label: command.label ?? "",
      explicitChatScopeKey: null
    });
    return {
      version: 1,
      requestId: command.requestId,
      status: "ok",
      receipt
    };
  });
  const annotationManager = new AnnotationManager(relay, config, manager, agentInbox);
  const canvasManager = new CanvasManager({
    worktree: cacheRoot,
    browserManager: manager,
    config,
    relay
  });

  const ensureRelay = async (port = config.relayPort): Promise<void> => {
    if (port <= 0 || config.relayToken === false) {
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
    }
  };

  const cleanup = () => {
    relay.stop();
    baseManager.closeAll().catch(() => {});
  };

  const observeDesktopAndVerify: OpenDevBrowserCore["observeDesktopAndVerify"] = async (input) => {
    const {
      browserSessionId,
      targetId,
      maxChars,
      cursor,
      ...request
    } = input;
    const observation = await automationCoordinator.requestDesktopObservation({
      ...request,
      browserSessionId
    });
    const verification = await automationCoordinator.verifyAfterDesktopObservation({
      browserSessionId,
      targetId,
      observationId: observation.observationId,
      maxChars,
      ...(typeof cursor === "string" ? { cursor } : {})
    });

    return {
      observation,
      verification
    };
  };

  return {
    cacheRoot,
    config,
    parallelismPolicy: config.parallelism,
    configStore,
    manager,
    agentInbox,
    canvasManager,
    annotationManager,
    runner,
    skills,
    desktopRuntime,
    automationCoordinator,
    observeDesktopAndVerify,
    providerRuntime,
    ...(browserFallbackPort ? { browserFallbackPort } : {}),
    relay,
    ensureRelay,
    cleanup,
    getExtensionPath
  };
}
