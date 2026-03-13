/* c8 ignore file */
import type { BrowserManager } from "./browser-manager";
import type {
  RuntimePreviewBridgeInput,
  RuntimePreviewBridgeResult
} from "./canvas-runtime-preview-bridge";

export type BrowserManagerLike = Pick<BrowserManager,
  | "launch"
  | "connect"
  | "disconnect"
  | "status"
  | "withPage"
  | "cookieImport"
  | "cookieList"
  | "goto"
  | "waitForLoad"
  | "waitForRef"
  | "snapshot"
  | "click"
  | "hover"
  | "press"
  | "check"
  | "uncheck"
  | "type"
  | "select"
  | "scroll"
  | "scrollIntoView"
  | "domGetHtml"
  | "domGetText"
  | "domGetAttr"
  | "domGetValue"
  | "domIsVisible"
  | "domIsEnabled"
  | "domIsChecked"
  | "clonePage"
  | "cloneComponent"
  | "perfMetrics"
  | "screenshot"
  | "consolePoll"
  | "networkPoll"
  | "listPages"
  | "page"
  | "closePage"
  | "listTargets"
  | "useTarget"
  | "newTarget"
  | "closeTarget"
> & {
  connectRelay: (
    wsEndpoint: string,
    options?: { startUrl?: string }
  ) => ReturnType<BrowserManager["connectRelay"]>;
  registerCanvasTarget?: (
    sessionId: string,
    targetId: string
  ) => Promise<{ targetId: string; url?: string; title?: string; adopted?: boolean }>;
  applyRuntimePreviewBridge?: (
    sessionId: string,
    targetId: string | null,
    input: RuntimePreviewBridgeInput
  ) => Promise<RuntimePreviewBridgeResult>;
};
