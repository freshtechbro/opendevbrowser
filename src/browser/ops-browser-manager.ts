import { writeFile } from "fs/promises";
import { randomUUID } from "crypto";
import type { OpenDevBrowserConfig } from "../config";
import { resolveRelayEndpoint, sanitizeWsEndpoint } from "../relay/relay-endpoints";
import type { BrowserManagerLike } from "./manager-types";
import type { BrowserMode, ConnectOptions, LaunchOptions } from "./browser-manager";
import type { TargetInfo } from "./target-manager";
import type { ReactExport } from "../export/react-emitter";
import { emitReactComponent } from "../export/react-emitter";
import { extractCss, STYLE_ALLOWLIST, SKIP_STYLE_VALUES } from "../export/css-extract";
import type { DomCapture } from "../export/dom-capture";
import { OpsClient } from "./ops-client";
import type { ConsoleTracker } from "../devtools/console-tracker";
import type { NetworkTracker } from "../devtools/network-tracker";
import { BrowserManager } from "./browser-manager";

export class OpsBrowserManager implements BrowserManagerLike {
  private readonly base: BrowserManager;
  private readonly config: OpenDevBrowserConfig;
  private opsClient: OpsClient | null = null;
  private opsEndpoint: string | null = null;
  private opsSessions = new Set<string>();
  private opsLeases = new Map<string, string>();

  constructor(base: BrowserManager, config: OpenDevBrowserConfig) {
    this.base = base;
    this.config = config;
  }

  async launch(options: LaunchOptions): ReturnType<BrowserManagerLike["launch"]> {
    return this.base.launch(options);
  }

  async connect(options: ConnectOptions): ReturnType<BrowserManagerLike["connect"]> {
    return this.base.connect(options);
  }

  async connectRelay(wsEndpoint: string): ReturnType<BrowserManagerLike["connectRelay"]> {
    const endpoint = new URL(wsEndpoint);
    if (endpoint.pathname.endsWith("/cdp")) {
      return this.base.connectRelay(wsEndpoint);
    }

    const { connectEndpoint, reportedEndpoint } = await resolveRelayEndpoint({
      wsEndpoint,
      path: "ops",
      config: this.config
    });
    const client = await this.ensureOpsClient(connectEndpoint);
    const leaseId = randomUUID();
    const result = await client.request<{ opsSessionId: string; activeTargetId?: string | null; url?: string; title?: string; leaseId?: string }>(
      "session.connect",
      {},
      undefined,
      30000,
      leaseId
    );
    const sessionId = result.opsSessionId;
    this.opsSessions.add(sessionId);
    this.opsLeases.set(sessionId, result.leaseId ?? leaseId);
    return {
      sessionId,
      mode: "extension",
      activeTargetId: result.activeTargetId ?? null,
      warnings: [],
      leaseId: result.leaseId ?? leaseId,
      wsEndpoint: sanitizeWsEndpoint(reportedEndpoint)
    };
  }

  async disconnect(sessionId: string, closeBrowser = false): ReturnType<BrowserManagerLike["disconnect"]> {
    if (!this.opsSessions.has(sessionId)) {
      return this.base.disconnect(sessionId, closeBrowser);
    }
    await this.requestOps(sessionId, "session.disconnect", { closeBrowser });
    this.opsSessions.delete(sessionId);
    this.opsLeases.delete(sessionId);
  }

  async status(sessionId: string): ReturnType<BrowserManagerLike["status"]> {
    if (!this.opsSessions.has(sessionId)) {
      return this.base.status(sessionId);
    }
    const result = await this.requestOps<{ mode: BrowserMode; activeTargetId: string | null; url?: string; title?: string }>(
      sessionId,
      "session.status",
      {}
    );
    return result;
  }

  async withPage<T>(sessionId: string, targetId: string | null, fn: (page: never) => Promise<T>): Promise<T> {
    if (!this.opsSessions.has(sessionId)) {
      return this.base.withPage(sessionId, targetId, fn as never);
    }
    throw new Error("Direct annotate is unavailable via extension ops sessions.");
  }

  async goto(sessionId: string, url: string, waitUntil: "domcontentloaded" | "load" | "networkidle" = "load", timeoutMs = 30000): ReturnType<BrowserManagerLike["goto"]> {
    if (!this.opsSessions.has(sessionId)) {
      return this.base.goto(sessionId, url, waitUntil, timeoutMs);
    }
    return await this.requestOps(sessionId, "nav.goto", { url, waitUntil, timeoutMs });
  }

  async waitForLoad(sessionId: string, until: "domcontentloaded" | "load" | "networkidle", timeoutMs = 30000): ReturnType<BrowserManagerLike["waitForLoad"]> {
    if (!this.opsSessions.has(sessionId)) {
      return this.base.waitForLoad(sessionId, until, timeoutMs);
    }
    return await this.requestOps(sessionId, "nav.wait", { until, timeoutMs });
  }

  async waitForRef(sessionId: string, ref: string, state: "attached" | "visible" | "hidden" = "attached", timeoutMs = 30000): ReturnType<BrowserManagerLike["waitForRef"]> {
    if (!this.opsSessions.has(sessionId)) {
      return this.base.waitForRef(sessionId, ref, state, timeoutMs);
    }
    return await this.requestOps(sessionId, "nav.wait", { ref, state, timeoutMs });
  }

  async snapshot(sessionId: string, mode: "outline" | "actionables", maxChars: number, cursor?: string): ReturnType<BrowserManagerLike["snapshot"]> {
    if (!this.opsSessions.has(sessionId)) {
      return this.base.snapshot(sessionId, mode, maxChars, cursor);
    }
    return await this.requestOps(sessionId, "nav.snapshot", {
      mode,
      maxChars,
      cursor,
      maxNodes: this.config.snapshot.maxNodes
    });
  }

  async click(sessionId: string, ref: string): ReturnType<BrowserManagerLike["click"]> {
    if (!this.opsSessions.has(sessionId)) {
      return this.base.click(sessionId, ref);
    }
    return await this.requestOps(sessionId, "interact.click", { ref });
  }

  async hover(sessionId: string, ref: string): ReturnType<BrowserManagerLike["hover"]> {
    if (!this.opsSessions.has(sessionId)) {
      return this.base.hover(sessionId, ref);
    }
    return await this.requestOps(sessionId, "interact.hover", { ref });
  }

  async press(sessionId: string, key: string, ref?: string): ReturnType<BrowserManagerLike["press"]> {
    if (!this.opsSessions.has(sessionId)) {
      return this.base.press(sessionId, key, ref);
    }
    return await this.requestOps(sessionId, "interact.press", { key, ref });
  }

  async check(sessionId: string, ref: string): ReturnType<BrowserManagerLike["check"]> {
    if (!this.opsSessions.has(sessionId)) {
      return this.base.check(sessionId, ref);
    }
    return await this.requestOps(sessionId, "interact.check", { ref });
  }

  async uncheck(sessionId: string, ref: string): ReturnType<BrowserManagerLike["uncheck"]> {
    if (!this.opsSessions.has(sessionId)) {
      return this.base.uncheck(sessionId, ref);
    }
    return await this.requestOps(sessionId, "interact.uncheck", { ref });
  }

  async type(sessionId: string, ref: string, text: string, clear = false, submit = false): ReturnType<BrowserManagerLike["type"]> {
    if (!this.opsSessions.has(sessionId)) {
      return this.base.type(sessionId, ref, text, clear, submit);
    }
    return await this.requestOps(sessionId, "interact.type", { ref, text, clear, submit });
  }

  async select(sessionId: string, ref: string, values: string[]): ReturnType<BrowserManagerLike["select"]> {
    if (!this.opsSessions.has(sessionId)) {
      return this.base.select(sessionId, ref, values);
    }
    return await this.requestOps(sessionId, "interact.select", { ref, values });
  }

  async scroll(sessionId: string, dy: number, ref?: string): ReturnType<BrowserManagerLike["scroll"]> {
    if (!this.opsSessions.has(sessionId)) {
      return this.base.scroll(sessionId, dy, ref);
    }
    return await this.requestOps(sessionId, "interact.scroll", { dy, ref });
  }

  async scrollIntoView(sessionId: string, ref: string): ReturnType<BrowserManagerLike["scrollIntoView"]> {
    if (!this.opsSessions.has(sessionId)) {
      return this.base.scrollIntoView(sessionId, ref);
    }
    return await this.requestOps(sessionId, "interact.scrollIntoView", { ref });
  }

  async domGetHtml(sessionId: string, ref: string, maxChars = 8000): ReturnType<BrowserManagerLike["domGetHtml"]> {
    if (!this.opsSessions.has(sessionId)) {
      return this.base.domGetHtml(sessionId, ref, maxChars);
    }
    return await this.requestOps(sessionId, "dom.getHtml", { ref, maxChars });
  }

  async domGetText(sessionId: string, ref: string, maxChars = 8000): ReturnType<BrowserManagerLike["domGetText"]> {
    if (!this.opsSessions.has(sessionId)) {
      return this.base.domGetText(sessionId, ref, maxChars);
    }
    return await this.requestOps(sessionId, "dom.getText", { ref, maxChars });
  }

  async domGetAttr(sessionId: string, ref: string, name: string): ReturnType<BrowserManagerLike["domGetAttr"]> {
    if (!this.opsSessions.has(sessionId)) {
      return this.base.domGetAttr(sessionId, ref, name);
    }
    return await this.requestOps(sessionId, "dom.getAttr", { ref, name });
  }

  async domGetValue(sessionId: string, ref: string): ReturnType<BrowserManagerLike["domGetValue"]> {
    if (!this.opsSessions.has(sessionId)) {
      return this.base.domGetValue(sessionId, ref);
    }
    return await this.requestOps(sessionId, "dom.getValue", { ref });
  }

  async domIsVisible(sessionId: string, ref: string): ReturnType<BrowserManagerLike["domIsVisible"]> {
    if (!this.opsSessions.has(sessionId)) {
      return this.base.domIsVisible(sessionId, ref);
    }
    return await this.requestOps(sessionId, "dom.isVisible", { ref });
  }

  async domIsEnabled(sessionId: string, ref: string): ReturnType<BrowserManagerLike["domIsEnabled"]> {
    if (!this.opsSessions.has(sessionId)) {
      return this.base.domIsEnabled(sessionId, ref);
    }
    return await this.requestOps(sessionId, "dom.isEnabled", { ref });
  }

  async domIsChecked(sessionId: string, ref: string): ReturnType<BrowserManagerLike["domIsChecked"]> {
    if (!this.opsSessions.has(sessionId)) {
      return this.base.domIsChecked(sessionId, ref);
    }
    return await this.requestOps(sessionId, "dom.isChecked", { ref });
  }

  async clonePage(sessionId: string): Promise<ReactExport> {
    if (!this.opsSessions.has(sessionId)) {
      return this.base.clonePage(sessionId);
    }
    const capture = await this.requestOps<{ capture: DomCapture }>(sessionId, "export.clonePage", {
      sanitize: !this.config.security.allowUnsafeExport,
      maxNodes: this.config.export.maxNodes,
      inlineStyles: this.config.export.inlineStyles,
      styleAllowlist: Array.from(STYLE_ALLOWLIST),
      skipStyleValues: Array.from(SKIP_STYLE_VALUES)
    });
    const css = extractCss(capture.capture);
    return emitReactComponent(capture.capture, css, { allowUnsafeExport: this.config.security.allowUnsafeExport });
  }

  async cloneComponent(sessionId: string, ref: string): Promise<ReactExport> {
    if (!this.opsSessions.has(sessionId)) {
      return this.base.cloneComponent(sessionId, ref);
    }
    const capture = await this.requestOps<{ capture: DomCapture }>(sessionId, "export.cloneComponent", {
      ref,
      sanitize: !this.config.security.allowUnsafeExport,
      maxNodes: this.config.export.maxNodes,
      inlineStyles: this.config.export.inlineStyles,
      styleAllowlist: Array.from(STYLE_ALLOWLIST),
      skipStyleValues: Array.from(SKIP_STYLE_VALUES)
    });
    const css = extractCss(capture.capture);
    return emitReactComponent(capture.capture, css, { allowUnsafeExport: this.config.security.allowUnsafeExport });
  }

  async perfMetrics(sessionId: string): ReturnType<BrowserManagerLike["perfMetrics"]> {
    if (!this.opsSessions.has(sessionId)) {
      return this.base.perfMetrics(sessionId);
    }
    return await this.requestOps(sessionId, "devtools.perf", {});
  }

  async screenshot(sessionId: string, path?: string): ReturnType<BrowserManagerLike["screenshot"]> {
    if (!this.opsSessions.has(sessionId)) {
      return this.base.screenshot(sessionId, path);
    }
    const result = await this.requestOps<{ base64?: string; warning?: string }>(sessionId, "page.screenshot", {});
    if (!result.base64) {
      throw new Error("Screenshot failed");
    }
    const warnings = result.warning ? [result.warning] : undefined;
    if (path) {
      await writeFile(path, Buffer.from(result.base64, "base64"));
      return warnings ? { path, warnings } : { path };
    }
    return warnings ? { base64: result.base64, warnings } : { base64: result.base64 };
  }

  async consolePoll(sessionId: string, sinceSeq?: number, max = 50): Promise<{ events: ReturnType<ConsoleTracker["poll"]>["events"]; nextSeq: number }> {
    if (!this.opsSessions.has(sessionId)) {
      return this.base.consolePoll(sessionId, sinceSeq, max);
    }
    return await this.requestOps(sessionId, "devtools.consolePoll", { sinceSeq, max });
  }

  async networkPoll(sessionId: string, sinceSeq?: number, max = 50): Promise<{ events: ReturnType<NetworkTracker["poll"]>["events"]; nextSeq: number }> {
    if (!this.opsSessions.has(sessionId)) {
      return this.base.networkPoll(sessionId, sinceSeq, max);
    }
    return await this.requestOps(sessionId, "devtools.networkPoll", { sinceSeq, max });
  }

  async listTargets(sessionId: string, includeUrls = false): Promise<{ activeTargetId: string | null; targets: TargetInfo[] }> {
    if (!this.opsSessions.has(sessionId)) {
      return this.base.listTargets(sessionId, includeUrls);
    }
    return await this.requestOps(sessionId, "targets.list", { includeUrls });
  }

  async useTarget(sessionId: string, targetId: string): Promise<{ activeTargetId: string; url?: string; title?: string }> {
    if (!this.opsSessions.has(sessionId)) {
      return this.base.useTarget(sessionId, targetId);
    }
    return await this.requestOps(sessionId, "targets.use", { targetId });
  }

  async newTarget(sessionId: string, url?: string): Promise<{ targetId: string }> {
    if (!this.opsSessions.has(sessionId)) {
      return this.base.newTarget(sessionId, url);
    }
    return await this.requestOps(sessionId, "targets.new", { url });
  }

  async closeTarget(sessionId: string, targetId: string): Promise<void> {
    if (!this.opsSessions.has(sessionId)) {
      return this.base.closeTarget(sessionId, targetId);
    }
    await this.requestOps(sessionId, "targets.close", { targetId });
  }

  async page(sessionId: string, name: string, url?: string): Promise<{ targetId: string; created: boolean; url?: string; title?: string }> {
    if (!this.opsSessions.has(sessionId)) {
      return this.base.page(sessionId, name, url);
    }
    return await this.requestOps(sessionId, "page.open", { name, url });
  }

  async listPages(sessionId: string): Promise<{ pages: Array<{ name: string; targetId: string; url?: string; title?: string }> }> {
    if (!this.opsSessions.has(sessionId)) {
      return this.base.listPages(sessionId);
    }
    return await this.requestOps(sessionId, "page.list", {});
  }

  async closePage(sessionId: string, name: string): Promise<void> {
    if (!this.opsSessions.has(sessionId)) {
      return this.base.closePage(sessionId, name);
    }
    await this.requestOps(sessionId, "page.close", { name });
  }

  private async ensureOpsClient(wsEndpoint: string): Promise<OpsClient> {
    if (this.opsClient && this.opsEndpoint === wsEndpoint) {
      await this.opsClient.connect();
      return this.opsClient;
    }
    this.opsClient?.disconnect();
    const client = new OpsClient(wsEndpoint);
    await client.connect();
    this.opsClient = client;
    this.opsEndpoint = wsEndpoint;
    return client;
  }

  private async requestOps<T>(sessionId: string, command: string, payload: Record<string, unknown>): Promise<T> {
    const client = this.opsClient;
    if (!client) {
      throw new Error("Ops client not connected");
    }
    const leaseId = this.opsLeases.get(sessionId);
    if (!leaseId) {
      throw new Error("Ops lease not found for session");
    }
    return await client.request<T>(command, payload, sessionId, 30000, leaseId);
  }
}
