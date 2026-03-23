import { BrowserManager } from "../browser/browser-manager";
import { OpsBrowserManager } from "../browser/ops-browser-manager";
import { AnnotationManager } from "../browser/annotation-manager";
import { CanvasManager } from "../browser/canvas-manager";
import { ScriptRunner } from "../browser/script-runner";
import { AgentInbox } from "../annotate/agent-inbox";
import { ConfigStore, loadGlobalConfig } from "../config";
import { getExtensionPath } from "../extension-extractor";
import { RelayServer } from "../relay/relay-server";
import { SkillLoader } from "../skills/skill-loader";
import {
  createBrowserFallbackPort,
  createConfiguredProviderRuntime
} from "../providers/runtime-factory";
import { ChallengeOrchestrator } from "../challenges";
import type { CoreOptions, OpenDevBrowserCore } from "./types";

export function createOpenDevBrowserCore(options: CoreOptions): OpenDevBrowserCore {
  const config = options.config ?? loadGlobalConfig();
  const configStore = new ConfigStore(config);
  const cacheRoot = options.worktree ?? options.directory;
  const baseManager = new BrowserManager(cacheRoot, config);
  const manager = new OpsBrowserManager(baseManager, config);
  const challengeOrchestrator = config.providers?.challengeOrchestration
    ? new ChallengeOrchestrator(config.providers.challengeOrchestration)
    : undefined;
  if (challengeOrchestrator) {
    baseManager.setChallengeOrchestrator(challengeOrchestrator);
    manager.setChallengeOrchestrator(challengeOrchestrator);
  }
  const runner = new ScriptRunner(manager);
  const skills = new SkillLoader(cacheRoot, config.skillPaths);
  const agentInbox = new AgentInbox(cacheRoot);
  const browserFallbackPort = createBrowserFallbackPort(
    manager,
    {},
    config.relayPort > 0 && config.relayToken !== false
      ? { extensionWsEndpoint: `ws://127.0.0.1:${config.relayPort}` }
      : {},
    challengeOrchestrator,
    config.providers?.challengeOrchestration?.mode ?? "browser_with_helper",
    config.providers?.challengeOrchestration?.optionalComputerUseBridge.enabled ?? true
  );
  const providerRuntime = createConfiguredProviderRuntime({
    config,
    manager,
    browserFallbackPort,
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
    providerRuntime,
    ...(browserFallbackPort ? { browserFallbackPort } : {}),
    relay,
    ensureRelay,
    cleanup,
    getExtensionPath
  };
}
