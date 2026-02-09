import type { BrowserManagerLike } from "../browser/manager-types";
import type { AnnotationManager } from "../browser/annotation-manager";
import type { ScriptRunner } from "../browser/script-runner";
import type { ConfigStore } from "../config";
import type { RelayLike } from "../relay/relay-types";
import type { SkillLoader } from "../skills/skill-loader";

export type ToolDeps = {
  manager: BrowserManagerLike;
  annotationManager: AnnotationManager;
  runner: ScriptRunner;
  config: ConfigStore;
  skills: SkillLoader;
  relay?: RelayLike;
  getExtensionPath?: () => string | null;
  ensureHub?: () => Promise<void>;
};
