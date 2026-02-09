import { BrowserManager } from "../browser/browser-manager";
import { OpsBrowserManager } from "../browser/ops-browser-manager";
import { AnnotationManager } from "../browser/annotation-manager";
import { ScriptRunner } from "../browser/script-runner";
import { ConfigStore, loadGlobalConfig } from "../config";
import { getExtensionPath } from "../extension-extractor";
import { RelayServer } from "../relay/relay-server";
import { SkillLoader } from "../skills/skill-loader";
import type { CoreOptions, OpenDevBrowserCore } from "./types";

export function createOpenDevBrowserCore(options: CoreOptions): OpenDevBrowserCore {
  const config = options.config ?? loadGlobalConfig();
  const configStore = new ConfigStore(config);
  const cacheRoot = options.worktree ?? options.directory;
  const baseManager = new BrowserManager(cacheRoot, config);
  const manager = new OpsBrowserManager(baseManager, config);
  const runner = new ScriptRunner(manager);
  const skills = new SkillLoader(cacheRoot, config.skillPaths);
  const relay = new RelayServer();
  relay.setToken(config.relayToken);
  const annotationManager = new AnnotationManager(relay, config, manager);

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
    configStore,
    manager,
    annotationManager,
    runner,
    skills,
    relay,
    ensureRelay,
    cleanup,
    getExtensionPath
  };
}
