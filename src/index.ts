import type { Plugin } from "@opencode-ai/plugin";
import { loadGlobalConfig, ConfigStore } from "./config";
import { BrowserManager } from "./browser/browser-manager";
import { ScriptRunner } from "./browser/script-runner";
import { SkillLoader } from "./skills/skill-loader";
import { RelayServer } from "./relay/relay-server";
import { createTools } from "./tools";
import { extractExtension, getExtensionPath } from "./extension-extractor";

export const OpenDevBrowserPlugin: Plugin = async ({ directory, worktree }) => {
  const initialConfig = loadGlobalConfig();
  const configStore = new ConfigStore(initialConfig);
  const cacheRoot = worktree || directory;
  const manager = new BrowserManager(cacheRoot, initialConfig);
  const runner = new ScriptRunner(manager);
  const skills = new SkillLoader(directory);
  const relay = new RelayServer();
  relay.setToken(initialConfig.relayToken);

  try {
    await extractExtension();
  } catch (error) {
    // Extension extraction is best-effort; keep plugin usable if it fails.
    void error;
  }

  const ensureRelay = async (port: number) => {
    if (port <= 0) {
      relay.stop();
      return;
    }
    const status = relay.status();
    if (status.running && status.port === port) {
      return;
    }
    relay.stop();
    await relay.start(port);
  };

  await ensureRelay(initialConfig.relayPort);

  return {
    tool: createTools({ manager, runner, config: configStore, skills, relay, getExtensionPath })
  };
};

export default OpenDevBrowserPlugin;
