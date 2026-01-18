import type { BrowserManagerLike } from "../browser/manager-types";
import type { ScriptRunner } from "../browser/script-runner";
import type { ConfigStore } from "../config";
import type { RelayServer } from "../relay/relay-server";
import type { SkillLoader } from "../skills/skill-loader";

export type ToolDeps = {
  manager: BrowserManagerLike;
  runner: ScriptRunner;
  config: ConfigStore;
  skills: SkillLoader;
  relay?: RelayServer;
  getExtensionPath?: () => string | null;
};
