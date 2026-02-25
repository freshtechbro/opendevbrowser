import { writeFile } from "fs/promises";
import { randomUUID } from "crypto";
import type { OpenDevBrowserConfig } from "../config";
import { createRequestId } from "../core/logging";
import { resolveRelayEndpoint, sanitizeWsEndpoint } from "../relay/relay-endpoints";
import type { ParallelismGovernorPolicyPayload } from "../relay/protocol";
import type { BrowserManagerLike } from "./manager-types";
import type { ConnectOptions, LaunchOptions } from "./browser-manager";
import type { BrowserMode } from "./session-store";
import type { TargetInfo } from "./target-manager";
import type { ReactExport } from "../export/react-emitter";
import { emitReactComponent } from "../export/react-emitter";
import { extractCss, STYLE_ALLOWLIST, SKIP_STYLE_VALUES } from "../export/css-extract";
import type { DomCapture } from "../export/dom-capture";
import { OpsClient } from "./ops-client";
import type { ConsoleTracker } from "../devtools/console-tracker";
import type { NetworkTracker } from "../devtools/network-tracker";
import { BrowserManager } from "./browser-manager";

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

type CookieListRecord = {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite?: "Strict" | "Lax" | "None";
};

export class OpsBrowserManager implements BrowserManagerLike {
  private readonly base: BrowserManager;
  private readonly config: OpenDevBrowserConfig;
  private opsClient: OpsClient | null = null;
  private opsEndpoint: string | null = null;
  private opsSessions = new Set<string>();
  private opsLeases = new Map<string, string>();
  private closedOpsSessions = new Map<string, number>();

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
      {
        parallelismPolicy: this.buildParallelismPolicyPayload()
      },
      undefined,
      30000,
      leaseId
    );
    const sessionId = result.opsSessionId;
    this.opsSessions.add(sessionId);
    this.opsLeases.set(sessionId, result.leaseId ?? leaseId);
    this.trackClosedSessionCleanup();
    return {
      sessionId,
      mode: "extension",
      activeTargetId: result.activeTargetId ?? null,
      warnings: [],
      leaseId: result.leaseId ?? leaseId,
      wsEndpoint: sanitizeWsEndpoint(reportedEndpoint)
    };
  }

  private buildParallelismPolicyPayload(): ParallelismGovernorPolicyPayload {
    const policy = this.config.parallelism;
    return {
      floor: policy.floor,
      backpressureTimeoutMs: policy.backpressureTimeoutMs,
      sampleIntervalMs: policy.sampleIntervalMs,
      recoveryStableWindows: policy.recoveryStableWindows,
      hostFreeMemMediumPct: policy.hostFreeMemMediumPct,
      hostFreeMemHighPct: policy.hostFreeMemHighPct,
      hostFreeMemCriticalPct: policy.hostFreeMemCriticalPct,
      rssBudgetMb: policy.rssBudgetMb,
      rssSoftPct: policy.rssSoftPct,
      rssHighPct: policy.rssHighPct,
      rssCriticalPct: policy.rssCriticalPct,
      queueAgeHighMs: policy.queueAgeHighMs,
      queueAgeCriticalMs: policy.queueAgeCriticalMs,
      modeCaps: {
        managedHeaded: policy.modeCaps.managedHeaded,
        managedHeadless: policy.modeCaps.managedHeadless,
        cdpConnectHeaded: policy.modeCaps.cdpConnectHeaded,
        cdpConnectHeadless: policy.modeCaps.cdpConnectHeadless,
        extensionOpsHeaded: policy.modeCaps.extensionOpsHeaded,
        extensionLegacyCdpHeaded: policy.modeCaps.extensionLegacyCdpHeaded
      }
    };
  }

  async disconnect(sessionId: string, closeBrowser = false): ReturnType<BrowserManagerLike["disconnect"]> {
    if (!this.opsSessions.has(sessionId)) {
      if (this.closedOpsSessions.has(sessionId)) {
        return;
      }
      return this.base.disconnect(sessionId, closeBrowser);
    }
    try {
      await this.requestOps(sessionId, "session.disconnect", { closeBrowser });
    } catch (error) {
      if (!isIgnorableOpsDisconnectError(error)) {
        throw error;
      }
    }
    this.opsSessions.delete(sessionId);
    this.opsLeases.delete(sessionId);
    this.closedOpsSessions.delete(sessionId);
  }

  async status(sessionId: string): ReturnType<BrowserManagerLike["status"]> {
    if (!this.opsSessions.has(sessionId)) {
      if (this.closedOpsSessions.has(sessionId)) {
        throw new Error("[invalid_session] Session already closed");
      }
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

  async cookieImport(
    sessionId: string,
    cookies: CookieImportRecord[],
    strict = true,
    requestId = createRequestId()
  ): Promise<{ requestId: string; imported: number; rejected: Array<{ index: number; reason: string }> }> {
    if (!this.opsSessions.has(sessionId)) {
      return this.base.cookieImport(sessionId, cookies, strict, requestId);
    }
    return await this.requestOps(
      sessionId,
      "storage.setCookies",
      { cookies, strict, requestId }
    );
  }

  async cookieList(
    sessionId: string,
    urls?: string[],
    requestId = createRequestId()
  ): Promise<{ requestId: string; cookies: CookieListRecord[]; count: number }> {
    if (!this.opsSessions.has(sessionId)) {
      return this.base.cookieList(sessionId, urls, requestId);
    }
    return await this.requestOps(
      sessionId,
      "storage.getCookies",
      { urls, requestId }
    );
  }

  async goto(
    sessionId: string,
    url: string,
    waitUntil: "domcontentloaded" | "load" | "networkidle" = "load",
    timeoutMs = 30000,
    _sessionOverride?: { browser: unknown; context: unknown; targets: unknown },
    targetId?: string | null
  ): ReturnType<BrowserManagerLike["goto"]> {
    if (!this.opsSessions.has(sessionId)) {
      return this.base.goto(sessionId, url, waitUntil, timeoutMs, undefined, targetId);
    }
    return await this.requestOps(sessionId, "nav.goto", this.withTarget({ url, waitUntil, timeoutMs }, targetId));
  }

  async waitForLoad(
    sessionId: string,
    until: "domcontentloaded" | "load" | "networkidle",
    timeoutMs = 30000,
    targetId?: string | null
  ): ReturnType<BrowserManagerLike["waitForLoad"]> {
    if (!this.opsSessions.has(sessionId)) {
      return this.base.waitForLoad(sessionId, until, timeoutMs, targetId);
    }
    return await this.requestOps(sessionId, "nav.wait", this.withTarget({ until, timeoutMs }, targetId));
  }

  async waitForRef(
    sessionId: string,
    ref: string,
    state: "attached" | "visible" | "hidden" = "attached",
    timeoutMs = 30000,
    targetId?: string | null
  ): ReturnType<BrowserManagerLike["waitForRef"]> {
    if (!this.opsSessions.has(sessionId)) {
      return this.base.waitForRef(sessionId, ref, state, timeoutMs, targetId);
    }
    return await this.requestOps(sessionId, "nav.wait", this.withTarget({ ref, state, timeoutMs }, targetId));
  }

  async snapshot(
    sessionId: string,
    mode: "outline" | "actionables",
    maxChars: number,
    cursor?: string,
    targetId?: string | null
  ): ReturnType<BrowserManagerLike["snapshot"]> {
    if (!this.opsSessions.has(sessionId)) {
      return this.base.snapshot(sessionId, mode, maxChars, cursor, targetId);
    }
    return await this.requestOps(sessionId, "nav.snapshot", this.withTarget({
      mode,
      maxChars,
      cursor,
      maxNodes: this.config.snapshot.maxNodes
    }, targetId));
  }

  async click(sessionId: string, ref: string, targetId?: string | null): ReturnType<BrowserManagerLike["click"]> {
    if (!this.opsSessions.has(sessionId)) {
      return this.base.click(sessionId, ref, targetId);
    }
    return await this.requestOps(sessionId, "interact.click", this.withTarget({ ref }, targetId));
  }

  async hover(sessionId: string, ref: string, targetId?: string | null): ReturnType<BrowserManagerLike["hover"]> {
    if (!this.opsSessions.has(sessionId)) {
      return this.base.hover(sessionId, ref, targetId);
    }
    return await this.requestOps(sessionId, "interact.hover", this.withTarget({ ref }, targetId));
  }

  async press(sessionId: string, key: string, ref?: string, targetId?: string | null): ReturnType<BrowserManagerLike["press"]> {
    if (!this.opsSessions.has(sessionId)) {
      return this.base.press(sessionId, key, ref, targetId);
    }
    return await this.requestOps(sessionId, "interact.press", this.withTarget({ key, ref }, targetId));
  }

  async check(sessionId: string, ref: string, targetId?: string | null): ReturnType<BrowserManagerLike["check"]> {
    if (!this.opsSessions.has(sessionId)) {
      return this.base.check(sessionId, ref, targetId);
    }
    return await this.requestOps(sessionId, "interact.check", this.withTarget({ ref }, targetId));
  }

  async uncheck(sessionId: string, ref: string, targetId?: string | null): ReturnType<BrowserManagerLike["uncheck"]> {
    if (!this.opsSessions.has(sessionId)) {
      return this.base.uncheck(sessionId, ref, targetId);
    }
    return await this.requestOps(sessionId, "interact.uncheck", this.withTarget({ ref }, targetId));
  }

  async type(
    sessionId: string,
    ref: string,
    text: string,
    clear = false,
    submit = false,
    targetId?: string | null
  ): ReturnType<BrowserManagerLike["type"]> {
    if (!this.opsSessions.has(sessionId)) {
      return this.base.type(sessionId, ref, text, clear, submit, targetId);
    }
    return await this.requestOps(sessionId, "interact.type", this.withTarget({ ref, text, clear, submit }, targetId));
  }

  async select(sessionId: string, ref: string, values: string[], targetId?: string | null): ReturnType<BrowserManagerLike["select"]> {
    if (!this.opsSessions.has(sessionId)) {
      return this.base.select(sessionId, ref, values, targetId);
    }
    return await this.requestOps(sessionId, "interact.select", this.withTarget({ ref, values }, targetId));
  }

  async scroll(sessionId: string, dy: number, ref?: string, targetId?: string | null): ReturnType<BrowserManagerLike["scroll"]> {
    if (!this.opsSessions.has(sessionId)) {
      return this.base.scroll(sessionId, dy, ref, targetId);
    }
    return await this.requestOps(sessionId, "interact.scroll", this.withTarget({ dy, ref }, targetId));
  }

  async scrollIntoView(sessionId: string, ref: string, targetId?: string | null): ReturnType<BrowserManagerLike["scrollIntoView"]> {
    if (!this.opsSessions.has(sessionId)) {
      return this.base.scrollIntoView(sessionId, ref, targetId);
    }
    return await this.requestOps(sessionId, "interact.scrollIntoView", this.withTarget({ ref }, targetId));
  }

  async domGetHtml(
    sessionId: string,
    ref: string,
    maxChars = 8000,
    targetId?: string | null
  ): ReturnType<BrowserManagerLike["domGetHtml"]> {
    if (!this.opsSessions.has(sessionId)) {
      return this.base.domGetHtml(sessionId, ref, maxChars, targetId);
    }
    return await this.requestOps(sessionId, "dom.getHtml", this.withTarget({ ref, maxChars }, targetId));
  }

  async domGetText(
    sessionId: string,
    ref: string,
    maxChars = 8000,
    targetId?: string | null
  ): ReturnType<BrowserManagerLike["domGetText"]> {
    if (!this.opsSessions.has(sessionId)) {
      return this.base.domGetText(sessionId, ref, maxChars, targetId);
    }
    return await this.requestOps(sessionId, "dom.getText", this.withTarget({ ref, maxChars }, targetId));
  }

  async domGetAttr(
    sessionId: string,
    ref: string,
    name: string,
    targetId?: string | null
  ): ReturnType<BrowserManagerLike["domGetAttr"]> {
    if (!this.opsSessions.has(sessionId)) {
      return this.base.domGetAttr(sessionId, ref, name, targetId);
    }
    return await this.requestOps(sessionId, "dom.getAttr", this.withTarget({ ref, name }, targetId));
  }

  async domGetValue(sessionId: string, ref: string, targetId?: string | null): ReturnType<BrowserManagerLike["domGetValue"]> {
    if (!this.opsSessions.has(sessionId)) {
      return this.base.domGetValue(sessionId, ref, targetId);
    }
    return await this.requestOps(sessionId, "dom.getValue", this.withTarget({ ref }, targetId));
  }

  async domIsVisible(sessionId: string, ref: string, targetId?: string | null): ReturnType<BrowserManagerLike["domIsVisible"]> {
    if (!this.opsSessions.has(sessionId)) {
      return this.base.domIsVisible(sessionId, ref, targetId);
    }
    return await this.requestOps(sessionId, "dom.isVisible", this.withTarget({ ref }, targetId));
  }

  async domIsEnabled(sessionId: string, ref: string, targetId?: string | null): ReturnType<BrowserManagerLike["domIsEnabled"]> {
    if (!this.opsSessions.has(sessionId)) {
      return this.base.domIsEnabled(sessionId, ref, targetId);
    }
    return await this.requestOps(sessionId, "dom.isEnabled", this.withTarget({ ref }, targetId));
  }

  async domIsChecked(sessionId: string, ref: string, targetId?: string | null): ReturnType<BrowserManagerLike["domIsChecked"]> {
    if (!this.opsSessions.has(sessionId)) {
      return this.base.domIsChecked(sessionId, ref, targetId);
    }
    return await this.requestOps(sessionId, "dom.isChecked", this.withTarget({ ref }, targetId));
  }

  async clonePage(sessionId: string, targetId?: string | null): Promise<ReactExport> {
    if (!this.opsSessions.has(sessionId)) {
      return this.base.clonePage(sessionId, targetId);
    }
    const capture = await this.requestOps<{ capture: DomCapture }>(sessionId, "export.clonePage", this.withTarget({
      sanitize: !this.config.security.allowUnsafeExport,
      maxNodes: this.config.export.maxNodes,
      inlineStyles: this.config.export.inlineStyles,
      styleAllowlist: Array.from(STYLE_ALLOWLIST),
      skipStyleValues: Array.from(SKIP_STYLE_VALUES)
    }, targetId));
    const css = extractCss(capture.capture);
    return emitReactComponent(capture.capture, css, { allowUnsafeExport: this.config.security.allowUnsafeExport });
  }

  async cloneComponent(sessionId: string, ref: string, targetId?: string | null): Promise<ReactExport> {
    if (!this.opsSessions.has(sessionId)) {
      return this.base.cloneComponent(sessionId, ref, targetId);
    }
    const capture = await this.requestOps<{ capture: DomCapture }>(sessionId, "export.cloneComponent", this.withTarget({
      ref,
      sanitize: !this.config.security.allowUnsafeExport,
      maxNodes: this.config.export.maxNodes,
      inlineStyles: this.config.export.inlineStyles,
      styleAllowlist: Array.from(STYLE_ALLOWLIST),
      skipStyleValues: Array.from(SKIP_STYLE_VALUES)
    }, targetId));
    const css = extractCss(capture.capture);
    return emitReactComponent(capture.capture, css, { allowUnsafeExport: this.config.security.allowUnsafeExport });
  }

  async perfMetrics(sessionId: string, targetId?: string | null): ReturnType<BrowserManagerLike["perfMetrics"]> {
    if (!this.opsSessions.has(sessionId)) {
      return this.base.perfMetrics(sessionId, targetId);
    }
    return await this.requestOps(sessionId, "devtools.perf", this.withTarget({}, targetId));
  }

  async screenshot(sessionId: string, path?: string, targetId?: string | null): ReturnType<BrowserManagerLike["screenshot"]> {
    if (!this.opsSessions.has(sessionId)) {
      return this.base.screenshot(sessionId, path, targetId);
    }
    const result = await this.requestOps<{ base64?: string; warning?: string }>(
      sessionId,
      "page.screenshot",
      this.withTarget({}, targetId)
    );
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
    const client = new OpsClient(wsEndpoint, {
      onEvent: (event) => {
        this.handleOpsEvent(event);
      },
      onClose: () => {
        this.handleOpsClientClosed();
      }
    });
    await client.connect();
    this.opsClient = client;
    this.opsEndpoint = wsEndpoint;
    return client;
  }

  private withTarget(
    payload: Record<string, unknown>,
    targetId?: string | null
  ): Record<string, unknown> {
    if (typeof targetId !== "string" || targetId.trim().length === 0) {
      return payload;
    }
    return {
      ...payload,
      targetId: targetId.trim()
    };
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

  private handleOpsEvent(event: { event?: string; opsSessionId?: string }): void {
    if (!event.opsSessionId) return;
    if (event.event === "ops_session_closed" || event.event === "ops_session_expired" || event.event === "ops_tab_closed") {
      this.opsSessions.delete(event.opsSessionId);
      this.opsLeases.delete(event.opsSessionId);
      this.closedOpsSessions.set(event.opsSessionId, Date.now());
      this.trackClosedSessionCleanup();
    }
  }

  private handleOpsClientClosed(): void {
    if (this.opsSessions.size === 0) return;
    const now = Date.now();
    for (const sessionId of this.opsSessions) {
      this.closedOpsSessions.set(sessionId, now);
    }
    this.opsSessions.clear();
    this.opsLeases.clear();
    this.trackClosedSessionCleanup();
  }

  private trackClosedSessionCleanup(): void {
    if (this.closedOpsSessions.size <= 100) return;
    const entries = Array.from(this.closedOpsSessions.entries()).sort((a, b) => a[1] - b[1]);
    const excess = entries.length - 100;
    for (let i = 0; i < excess; i += 1) {
      const sessionId = entries[i]?.[0];
      if (sessionId) {
        this.closedOpsSessions.delete(sessionId);
      }
    }
  }
}

const isIgnorableOpsDisconnectError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.includes("Ops request timed out")
    || message.includes("[invalid_session] Unknown ops session")
    || message.includes("Ops socket closed");
};
