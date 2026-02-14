import type { BrowserManagerLike } from "../browser/manager-types";
import type { ConnectOptions, LaunchOptions } from "../browser/browser-manager";
import type { TargetInfo } from "../browser/target-manager";
import type { ReactExport } from "../export/react-emitter";
import type { ConsoleTracker } from "../devtools/console-tracker";
import type { NetworkTracker } from "../devtools/network-tracker";
import { DaemonClient } from "./daemon-client";

type BrowserManagerMethodKey = {
  [K in keyof BrowserManagerLike]: BrowserManagerLike[K] extends (...args: never[]) => unknown ? K : never;
}[keyof BrowserManagerLike];

type CallResult<K extends BrowserManagerMethodKey> = Awaited<ReturnType<BrowserManagerLike[K]>>;

function isLegacyRelayEndpoint(wsEndpoint: string): boolean {
  try {
    const url = new URL(wsEndpoint);
    const path = url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname;
    return path === "/cdp";
  } catch {
    return false;
  }
}

export class RemoteManager implements BrowserManagerLike {
  private client: DaemonClient;

  constructor(client: DaemonClient) {
    this.client = client;
  }

  launch(options: LaunchOptions): ReturnType<BrowserManagerLike["launch"]> {
    return this.client.call<CallResult<"launch">>("session.launch", options as Record<string, unknown>);
  }

  connect(options: ConnectOptions): ReturnType<BrowserManagerLike["connect"]> {
    return this.client.call<CallResult<"connect">>("session.connect", options as Record<string, unknown>);
  }

  connectRelay(wsEndpoint: string): ReturnType<BrowserManagerLike["connectRelay"]> {
    return this.client.call<CallResult<"connectRelay">>(
      "session.connect",
      isLegacyRelayEndpoint(wsEndpoint) ? { wsEndpoint, extensionLegacy: true } : { wsEndpoint }
    );
  }

  disconnect(sessionId: string, closeBrowser = false): ReturnType<BrowserManagerLike["disconnect"]> {
    return this.client.call<CallResult<"disconnect">>("session.disconnect", { sessionId, closeBrowser });
  }

  status(sessionId: string): ReturnType<BrowserManagerLike["status"]> {
    return this.client.call<CallResult<"status">>("session.status", { sessionId });
  }

  goto(
    sessionId: string,
    url: string,
    waitUntil: "domcontentloaded" | "load" | "networkidle" = "load",
    timeoutMs = 30000
  ): ReturnType<BrowserManagerLike["goto"]> {
    return this.client.call<CallResult<"goto">>("nav.goto", { sessionId, url, waitUntil, timeoutMs });
  }

  waitForLoad(
    sessionId: string,
    until: "domcontentloaded" | "load" | "networkidle",
    timeoutMs = 30000
  ): ReturnType<BrowserManagerLike["waitForLoad"]> {
    return this.client.call<CallResult<"waitForLoad">>("nav.wait", { sessionId, until, timeoutMs });
  }

  waitForRef(
    sessionId: string,
    ref: string,
    state: "attached" | "visible" | "hidden" = "attached",
    timeoutMs = 30000
  ): ReturnType<BrowserManagerLike["waitForRef"]> {
    return this.client.call<CallResult<"waitForRef">>("nav.wait", { sessionId, ref, state, timeoutMs });
  }

  snapshot(sessionId: string, mode: "outline" | "actionables", maxChars: number, cursor?: string): ReturnType<BrowserManagerLike["snapshot"]> {
    return this.client.call<CallResult<"snapshot">>("nav.snapshot", { sessionId, mode, maxChars, cursor });
  }

  click(sessionId: string, ref: string): ReturnType<BrowserManagerLike["click"]> {
    return this.client.call<CallResult<"click">>("interact.click", { sessionId, ref });
  }

  hover(sessionId: string, ref: string): ReturnType<BrowserManagerLike["hover"]> {
    return this.client.call<CallResult<"hover">>("interact.hover", { sessionId, ref });
  }

  press(sessionId: string, key: string, ref?: string): ReturnType<BrowserManagerLike["press"]> {
    return this.client.call<CallResult<"press">>("interact.press", { sessionId, key, ref });
  }

  check(sessionId: string, ref: string): ReturnType<BrowserManagerLike["check"]> {
    return this.client.call<CallResult<"check">>("interact.check", { sessionId, ref });
  }

  uncheck(sessionId: string, ref: string): ReturnType<BrowserManagerLike["uncheck"]> {
    return this.client.call<CallResult<"uncheck">>("interact.uncheck", { sessionId, ref });
  }

  type(sessionId: string, ref: string, text: string, clear = false, submit = false): ReturnType<BrowserManagerLike["type"]> {
    return this.client.call<CallResult<"type">>("interact.type", { sessionId, ref, text, clear, submit });
  }

  select(sessionId: string, ref: string, values: string[]): ReturnType<BrowserManagerLike["select"]> {
    return this.client.call<CallResult<"select">>("interact.select", { sessionId, ref, values });
  }

  scroll(sessionId: string, dy: number, ref?: string): ReturnType<BrowserManagerLike["scroll"]> {
    return this.client.call<CallResult<"scroll">>("interact.scroll", { sessionId, dy, ref });
  }

  scrollIntoView(sessionId: string, ref: string): ReturnType<BrowserManagerLike["scrollIntoView"]> {
    return this.client.call<CallResult<"scrollIntoView">>("interact.scrollIntoView", { sessionId, ref });
  }

  domGetHtml(sessionId: string, ref: string, maxChars = 8000): ReturnType<BrowserManagerLike["domGetHtml"]> {
    return this.client.call<CallResult<"domGetHtml">>("dom.getHtml", { sessionId, ref, maxChars });
  }

  domGetText(sessionId: string, ref: string, maxChars = 8000): ReturnType<BrowserManagerLike["domGetText"]> {
    return this.client.call<CallResult<"domGetText">>("dom.getText", { sessionId, ref, maxChars });
  }

  domGetAttr(sessionId: string, ref: string, name: string): ReturnType<BrowserManagerLike["domGetAttr"]> {
    return this.client.call<CallResult<"domGetAttr">>("dom.getAttr", { sessionId, ref, name });
  }

  domGetValue(sessionId: string, ref: string): ReturnType<BrowserManagerLike["domGetValue"]> {
    return this.client.call<CallResult<"domGetValue">>("dom.getValue", { sessionId, ref });
  }

  domIsVisible(sessionId: string, ref: string): ReturnType<BrowserManagerLike["domIsVisible"]> {
    return this.client.call<CallResult<"domIsVisible">>("dom.isVisible", { sessionId, ref });
  }

  domIsEnabled(sessionId: string, ref: string): ReturnType<BrowserManagerLike["domIsEnabled"]> {
    return this.client.call<CallResult<"domIsEnabled">>("dom.isEnabled", { sessionId, ref });
  }

  domIsChecked(sessionId: string, ref: string): ReturnType<BrowserManagerLike["domIsChecked"]> {
    return this.client.call<CallResult<"domIsChecked">>("dom.isChecked", { sessionId, ref });
  }

  clonePage(sessionId: string): Promise<ReactExport> {
    return this.client.call("export.clonePage", { sessionId }) as Promise<ReactExport>;
  }

  cloneComponent(sessionId: string, ref: string): Promise<ReactExport> {
    return this.client.call("export.cloneComponent", { sessionId, ref }) as Promise<ReactExport>;
  }

  perfMetrics(sessionId: string): ReturnType<BrowserManagerLike["perfMetrics"]> {
    return this.client.call<CallResult<"perfMetrics">>("devtools.perf", { sessionId });
  }

  screenshot(sessionId: string, path?: string): ReturnType<BrowserManagerLike["screenshot"]> {
    return this.client.call<CallResult<"screenshot">>("page.screenshot", { sessionId, path });
  }

  consolePoll(sessionId: string, sinceSeq?: number, max = 50): Promise<{ events: ReturnType<ConsoleTracker["poll"]>["events"]; nextSeq: number }> {
    return this.client.call("devtools.consolePoll", { sessionId, sinceSeq, max }) as Promise<{
      events: ReturnType<ConsoleTracker["poll"]>["events"];
      nextSeq: number;
    }>;
  }

  networkPoll(sessionId: string, sinceSeq?: number, max = 50): Promise<{ events: ReturnType<NetworkTracker["poll"]>["events"]; nextSeq: number }> {
    return this.client.call("devtools.networkPoll", { sessionId, sinceSeq, max }) as Promise<{
      events: ReturnType<NetworkTracker["poll"]>["events"];
      nextSeq: number;
    }>;
  }

  listTargets(sessionId: string, includeUrls = false): Promise<{ activeTargetId: string | null; targets: TargetInfo[] }> {
    return this.client.call("targets.list", { sessionId, includeUrls }) as Promise<{
      activeTargetId: string | null;
      targets: TargetInfo[];
    }>;
  }

  useTarget(sessionId: string, targetId: string): Promise<{ activeTargetId: string; url?: string; title?: string }> {
    return this.client.call("targets.use", { sessionId, targetId }) as Promise<{
      activeTargetId: string;
      url?: string;
      title?: string;
    }>;
  }

  newTarget(sessionId: string, url?: string): Promise<{ targetId: string }> {
    return this.client.call("targets.new", { sessionId, url }) as Promise<{ targetId: string }>;
  }

  closeTarget(sessionId: string, targetId: string): Promise<void> {
    return this.client.call("targets.close", { sessionId, targetId }) as Promise<void>;
  }

  page(sessionId: string, name: string, url?: string): Promise<{ targetId: string; created: boolean; url?: string; title?: string }> {
    return this.client.call("page.open", { sessionId, name, url }) as Promise<{
      targetId: string;
      created: boolean;
      url?: string;
      title?: string;
    }>;
  }

  listPages(sessionId: string): Promise<{ pages: Array<{ name: string; targetId: string; url?: string; title?: string }> }> {
    return this.client.call("page.list", { sessionId }) as Promise<{
      pages: Array<{ name: string; targetId: string; url?: string; title?: string }>;
    }>;
  }

  closePage(sessionId: string, name: string): Promise<void> {
    return this.client.call("page.close", { sessionId, name }) as Promise<void>;
  }

  async withPage<T>(_sessionId: string, _targetId: string | null, _fn: (page: never) => Promise<T>): Promise<T> {
    throw new Error("Direct annotate is unavailable via daemon-managed sessions.");
  }
}
