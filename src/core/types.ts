import type { BrowserManagerLike } from "../browser/manager-types";
import type { ScriptRunner } from "../browser/script-runner";
import type { OpenDevBrowserConfig, ConfigStore } from "../config";
import type { RelayServer } from "../relay/relay-server";
import type { SkillLoader } from "../skills/skill-loader";

export type CoreOptions = {
  directory: string;
  worktree?: string | null;
  config?: OpenDevBrowserConfig;
};

export type OpenDevBrowserCore = {
  cacheRoot: string;
  config: OpenDevBrowserConfig;
  configStore: ConfigStore;
  manager: BrowserManagerLike;
  runner: ScriptRunner;
  skills: SkillLoader;
  relay: RelayServer;
  ensureRelay: (port?: number) => Promise<void>;
  cleanup: () => void;
  getExtensionPath: () => string | null;
};
