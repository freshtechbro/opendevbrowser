import type { BrowserManagerLike } from "../browser/manager-types";
import type { ConnectOptions, LaunchOptions } from "../browser/browser-manager";
import type { TargetInfo } from "../browser/target-manager";
import type { ReactExport } from "../export/react-emitter";
import type { ConsoleTracker } from "../devtools/console-tracker";
import type { NetworkTracker } from "../devtools/network-tracker";
import { DaemonClient } from "./daemon-client";

type CookieImportRecord = {
  name: string;
  value: string;
  url?: string;
  domain?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
};

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

  cookieImport(
    sessionId: string,
    cookies: CookieImportRecord[],
    strict = true,
    requestId?: string
  ): ReturnType<BrowserManagerLike["cookieImport"]> {
    return this.client.call<CallResult<"cookieImport">>("session.cookieImport", {
      sessionId,
      cookies,
      strict,
      requestId
    });
  }

  cookieList(
    sessionId: string,
    urls?: string[],
    requestId?: string
  ): ReturnType<BrowserManagerLike["cookieList"]> {
    return this.client.call<CallResult<"cookieList">>("session.cookieList", {
      sessionId,
      ...(urls && urls.length > 0 ? { urls } : {}),
      requestId
    });
  }

  goto(
    sessionId: string,
    url: string,
    waitUntil: "domcontentloaded" | "load" | "networkidle" = "load",
    timeoutMs = 30000,
    _sessionOverride?: { browser: unknown; context: unknown; targets: unknown },
    targetId?: string | null
  ): ReturnType<BrowserManagerLike["goto"]> {
    return this.client.call<CallResult<"goto">>("nav.goto", {
      sessionId,
      url,
      waitUntil,
      timeoutMs,
      ...(typeof targetId === "string" ? { targetId } : {})
    });
  }

  waitForLoad(
    sessionId: string,
    until: "domcontentloaded" | "load" | "networkidle",
    timeoutMs = 30000,
    targetId?: string | null
  ): ReturnType<BrowserManagerLike["waitForLoad"]> {
    return this.client.call<CallResult<"waitForLoad">>("nav.wait", {
      sessionId,
      until,
      timeoutMs,
      ...(typeof targetId === "string" ? { targetId } : {})
    });
  }

  waitForRef(
    sessionId: string,
    ref: string,
    state: "attached" | "visible" | "hidden" = "attached",
    timeoutMs = 30000,
    targetId?: string | null
  ): ReturnType<BrowserManagerLike["waitForRef"]> {
    return this.client.call<CallResult<"waitForRef">>("nav.wait", {
      sessionId,
      ref,
      state,
      timeoutMs,
      ...(typeof targetId === "string" ? { targetId } : {})
    });
  }

  snapshot(
    sessionId: string,
    mode: "outline" | "actionables",
    maxChars: number,
    cursor?: string,
    targetId?: string | null
  ): ReturnType<BrowserManagerLike["snapshot"]> {
    return this.client.call<CallResult<"snapshot">>("nav.snapshot", {
      sessionId,
      mode,
      maxChars,
      cursor,
      ...(typeof targetId === "string" ? { targetId } : {})
    });
  }

  click(sessionId: string, ref: string, targetId?: string | null): ReturnType<BrowserManagerLike["click"]> {
    return this.client.call<CallResult<"click">>("interact.click", {
      sessionId,
      ref,
      ...(typeof targetId === "string" ? { targetId } : {})
    });
  }

  hover(sessionId: string, ref: string, targetId?: string | null): ReturnType<BrowserManagerLike["hover"]> {
    return this.client.call<CallResult<"hover">>("interact.hover", {
      sessionId,
      ref,
      ...(typeof targetId === "string" ? { targetId } : {})
    });
  }

  press(sessionId: string, key: string, ref?: string, targetId?: string | null): ReturnType<BrowserManagerLike["press"]> {
    return this.client.call<CallResult<"press">>("interact.press", {
      sessionId,
      key,
      ref,
      ...(typeof targetId === "string" ? { targetId } : {})
    });
  }

  check(sessionId: string, ref: string, targetId?: string | null): ReturnType<BrowserManagerLike["check"]> {
    return this.client.call<CallResult<"check">>("interact.check", {
      sessionId,
      ref,
      ...(typeof targetId === "string" ? { targetId } : {})
    });
  }

  uncheck(sessionId: string, ref: string, targetId?: string | null): ReturnType<BrowserManagerLike["uncheck"]> {
    return this.client.call<CallResult<"uncheck">>("interact.uncheck", {
      sessionId,
      ref,
      ...(typeof targetId === "string" ? { targetId } : {})
    });
  }

  type(
    sessionId: string,
    ref: string,
    text: string,
    clear = false,
    submit = false,
    targetId?: string | null
  ): ReturnType<BrowserManagerLike["type"]> {
    return this.client.call<CallResult<"type">>("interact.type", {
      sessionId,
      ref,
      text,
      clear,
      submit,
      ...(typeof targetId === "string" ? { targetId } : {})
    });
  }

  select(sessionId: string, ref: string, values: string[], targetId?: string | null): ReturnType<BrowserManagerLike["select"]> {
    return this.client.call<CallResult<"select">>("interact.select", {
      sessionId,
      ref,
      values,
      ...(typeof targetId === "string" ? { targetId } : {})
    });
  }

  scroll(sessionId: string, dy: number, ref?: string, targetId?: string | null): ReturnType<BrowserManagerLike["scroll"]> {
    return this.client.call<CallResult<"scroll">>("interact.scroll", {
      sessionId,
      dy,
      ref,
      ...(typeof targetId === "string" ? { targetId } : {})
    });
  }

  scrollIntoView(sessionId: string, ref: string, targetId?: string | null): ReturnType<BrowserManagerLike["scrollIntoView"]> {
    return this.client.call<CallResult<"scrollIntoView">>("interact.scrollIntoView", {
      sessionId,
      ref,
      ...(typeof targetId === "string" ? { targetId } : {})
    });
  }

  domGetHtml(sessionId: string, ref: string, maxChars = 8000, targetId?: string | null): ReturnType<BrowserManagerLike["domGetHtml"]> {
    return this.client.call<CallResult<"domGetHtml">>("dom.getHtml", {
      sessionId,
      ref,
      maxChars,
      ...(typeof targetId === "string" ? { targetId } : {})
    });
  }

  domGetText(sessionId: string, ref: string, maxChars = 8000, targetId?: string | null): ReturnType<BrowserManagerLike["domGetText"]> {
    return this.client.call<CallResult<"domGetText">>("dom.getText", {
      sessionId,
      ref,
      maxChars,
      ...(typeof targetId === "string" ? { targetId } : {})
    });
  }

  domGetAttr(sessionId: string, ref: string, name: string, targetId?: string | null): ReturnType<BrowserManagerLike["domGetAttr"]> {
    return this.client.call<CallResult<"domGetAttr">>("dom.getAttr", {
      sessionId,
      ref,
      name,
      ...(typeof targetId === "string" ? { targetId } : {})
    });
  }

  domGetValue(sessionId: string, ref: string, targetId?: string | null): ReturnType<BrowserManagerLike["domGetValue"]> {
    return this.client.call<CallResult<"domGetValue">>("dom.getValue", {
      sessionId,
      ref,
      ...(typeof targetId === "string" ? { targetId } : {})
    });
  }

  domIsVisible(sessionId: string, ref: string, targetId?: string | null): ReturnType<BrowserManagerLike["domIsVisible"]> {
    return this.client.call<CallResult<"domIsVisible">>("dom.isVisible", {
      sessionId,
      ref,
      ...(typeof targetId === "string" ? { targetId } : {})
    });
  }

  domIsEnabled(sessionId: string, ref: string, targetId?: string | null): ReturnType<BrowserManagerLike["domIsEnabled"]> {
    return this.client.call<CallResult<"domIsEnabled">>("dom.isEnabled", {
      sessionId,
      ref,
      ...(typeof targetId === "string" ? { targetId } : {})
    });
  }

  domIsChecked(sessionId: string, ref: string, targetId?: string | null): ReturnType<BrowserManagerLike["domIsChecked"]> {
    return this.client.call<CallResult<"domIsChecked">>("dom.isChecked", {
      sessionId,
      ref,
      ...(typeof targetId === "string" ? { targetId } : {})
    });
  }

  clonePage(sessionId: string, targetId?: string | null): Promise<ReactExport> {
    return this.client.call("export.clonePage", {
      sessionId,
      ...(typeof targetId === "string" ? { targetId } : {})
    }) as Promise<ReactExport>;
  }

  cloneComponent(sessionId: string, ref: string, targetId?: string | null): Promise<ReactExport> {
    return this.client.call("export.cloneComponent", {
      sessionId,
      ref,
      ...(typeof targetId === "string" ? { targetId } : {})
    }) as Promise<ReactExport>;
  }

  perfMetrics(sessionId: string, targetId?: string | null): ReturnType<BrowserManagerLike["perfMetrics"]> {
    return this.client.call<CallResult<"perfMetrics">>("devtools.perf", {
      sessionId,
      ...(typeof targetId === "string" ? { targetId } : {})
    });
  }

  screenshot(sessionId: string, path?: string, targetId?: string | null): ReturnType<BrowserManagerLike["screenshot"]> {
    return this.client.call<CallResult<"screenshot">>("page.screenshot", {
      sessionId,
      path,
      ...(typeof targetId === "string" ? { targetId } : {})
    });
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
