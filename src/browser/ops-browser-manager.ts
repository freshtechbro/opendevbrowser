import { writeFile } from "fs/promises";
import { randomUUID } from "crypto";
import type { OpenDevBrowserConfig } from "../config";
import { createRequestId } from "../core/logging";
import { resolveRelayEndpoint, sanitizeWsEndpoint } from "../relay/relay-endpoints";
import type { ParallelismGovernorPolicyPayload } from "../relay/protocol";
import { ChallengeOrchestrator, resolveChallengeAutomationPolicy, type ChallengeAutomationMode } from "../challenges";
import type {
  BrowserCloneHtmlResult,
  BrowserClonePageOptions,
  BrowserDialogInput,
  BrowserDialogResult,
  BrowserDialogState,
  BrowserCanvasOverlayMountInput,
  BrowserCanvasOverlayResult,
  BrowserCanvasOverlaySelectInput,
  BrowserCanvasOverlaySyncInput,
  BrowserManagerLike,
  BrowserResponseMeta,
  BrowserScreenshotOptions,
  BrowserScreenshotResult,
  BrowserUploadInput,
  BrowserUploadResult,
  ChallengeRuntimeHandle,
  SessionInspectorHandle
} from "./manager-types";
import type { ConnectOptions, LaunchOptions } from "./browser-manager";
import type { BrowserMode } from "./session-store";
import type { TargetInfo } from "./target-manager";
import type { ReactExport } from "../export/react-emitter";
import { emitReactComponent } from "../export/react-emitter";
import { extractCss, STYLE_ALLOWLIST, SKIP_STYLE_VALUES } from "../export/css-extract";
import type { DomCapture } from "../export/dom-capture";
import {
  OpsClient,
  isOpsRequestTimeoutError,
  withOpsRequestTimeoutDetails
} from "./ops-client";
import type { ConsoleTracker } from "../devtools/console-tracker";
import type { NetworkTracker } from "../devtools/network-tracker";
import { BrowserManager } from "./browser-manager";
import type {
  RuntimePreviewBridgeInput,
  RuntimePreviewBridgeResult
} from "./canvas-runtime-preview-bridge";
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
  private opsProtocolSessions = new Map<string, string>();
  private publicSessionIdsByProtocolId = new Map<string, string>();
  private opsSessionTabs = new Map<string, number>();
  private opsSessionReconnectTabs = new Map<string, number>();
  private opsSessionUrls = new Map<string, string>();
  private opsSessionChallengeAutomationModes = new Map<string, ChallengeAutomationMode>();
  private closedOpsSessions = new Map<string, number>();
  private idleDisconnectPromise: Promise<void> | null = null;
  private challengeOrchestrator?: ChallengeOrchestrator;
  private readonly challengeAutomationSuppression = new Map<string, number>();

  constructor(base: BrowserManager, config: OpenDevBrowserConfig) {
    this.base = base;
    this.config = config;
  }

  setChallengeOrchestrator(orchestrator?: ChallengeOrchestrator): void {
    this.challengeOrchestrator = orchestrator;
    this.base.setChallengeOrchestrator(orchestrator);
  }

  getSessionChallengeAutomationMode(sessionId: string): ChallengeAutomationMode | undefined {
    return this.opsSessionChallengeAutomationModes.get(sessionId);
  }

  setSessionChallengeAutomationMode(sessionId: string, mode?: ChallengeAutomationMode): void {
    if (typeof mode === "undefined") {
      this.opsSessionChallengeAutomationModes.delete(sessionId);
      return;
    }
    this.opsSessionChallengeAutomationModes.set(sessionId, mode);
  }

  createChallengeRuntimeHandle(): ChallengeRuntimeHandle {
    return {
      status: (sessionId) => this.withChallengeAutomationSuppressed(sessionId, () => this.status(sessionId)),
      goto: (sessionId, url, waitUntil, timeoutMs, sessionOverride, targetId) => (
        this.withChallengeAutomationSuppressed(
          sessionId,
          () => this.goto(sessionId, url, waitUntil, timeoutMs, sessionOverride, targetId)
        )
      ),
      waitForLoad: (sessionId, until, timeoutMs, targetId) => (
        this.withChallengeAutomationSuppressed(sessionId, () => this.waitForLoad(sessionId, until, timeoutMs, targetId))
      ),
      snapshot: (sessionId, mode, maxChars, cursor, targetId) => (
        this.withChallengeAutomationSuppressed(sessionId, () => this.snapshot(sessionId, mode, maxChars, cursor, targetId))
      ),
      click: (sessionId, ref, targetId) => this.withChallengeAutomationSuppressed(sessionId, () => this.click(sessionId, ref, targetId)),
      hover: (sessionId, ref, targetId) => this.withChallengeAutomationSuppressed(sessionId, () => this.hover(sessionId, ref, targetId)),
      press: (sessionId, key, ref, targetId) => this.withChallengeAutomationSuppressed(sessionId, () => this.press(sessionId, key, ref, targetId)),
      type: (sessionId, ref, text, clear, submit, targetId) => (
        this.withChallengeAutomationSuppressed(sessionId, () => this.type(sessionId, ref, text, clear, submit, targetId))
      ),
      select: (sessionId, ref, values, targetId) => (
        this.withChallengeAutomationSuppressed(sessionId, () => this.select(sessionId, ref, values, targetId))
      ),
      scroll: (sessionId, dy, ref, targetId) => (
        this.withChallengeAutomationSuppressed(sessionId, () => this.scroll(sessionId, dy, ref, targetId))
      ),
      pointerMove: (sessionId, x, y, targetId, steps) => (
        this.withChallengeAutomationSuppressed(sessionId, () => this.pointerMove(sessionId, x, y, targetId, steps))
      ),
      pointerDown: (sessionId, x, y, targetId, button, clickCount) => (
        this.withChallengeAutomationSuppressed(sessionId, () => this.pointerDown(sessionId, x, y, targetId, button, clickCount))
      ),
      pointerUp: (sessionId, x, y, targetId, button, clickCount) => (
        this.withChallengeAutomationSuppressed(sessionId, () => this.pointerUp(sessionId, x, y, targetId, button, clickCount))
      ),
      drag: (sessionId, from, to, targetId, steps) => (
        this.withChallengeAutomationSuppressed(sessionId, () => this.drag(sessionId, from, to, targetId, steps))
      ),
      resolveRefPoint: (sessionId, ref, targetId) => (
        this.withChallengeAutomationSuppressed(sessionId, () => this.resolveRefPoint(sessionId, ref, targetId))
      ),
      cookieList: (sessionId, urls) => this.withChallengeAutomationSuppressed(sessionId, () => this.cookieList(sessionId, urls)),
      cookieImport: (sessionId, cookies, replaceExisting) => (
        this.withChallengeAutomationSuppressed(sessionId, () => this.cookieImport(sessionId, cookies, replaceExisting))
      ),
      debugTraceSnapshot: (sessionId, options) => (
        this.withChallengeAutomationSuppressed(sessionId, () => this.debugTraceSnapshot(sessionId, options))
      )
    };
  }

  createSessionInspector(): SessionInspectorHandle {
    return {
      status: (sessionId) => this.status(sessionId),
      listTargets: (sessionId, includeUrls) => this.listTargets(sessionId, includeUrls),
      consolePoll: (sessionId, sinceSeq, max) => this.consolePoll(sessionId, sinceSeq, max),
      networkPoll: (sessionId, sinceSeq, max) => this.networkPoll(sessionId, sinceSeq, max),
      debugTraceSnapshot: (sessionId, options) => this.debugTraceSnapshot(sessionId, options)
    };
  }

  private async withChallengeAutomationSuppressed<T>(sessionId: string, action: () => Promise<T>): Promise<T> {
    const current = this.challengeAutomationSuppression.get(sessionId) ?? 0;
    this.challengeAutomationSuppression.set(sessionId, current + 1);
    try {
      return await action();
    } finally {
      const next = (this.challengeAutomationSuppression.get(sessionId) ?? 1) - 1;
      if (next <= 0) {
        this.challengeAutomationSuppression.delete(sessionId);
      } else {
        this.challengeAutomationSuppression.set(sessionId, next);
      }
    }
  }

  private isChallengeAutomationSuppressed(sessionId: string): boolean {
    return (this.challengeAutomationSuppression.get(sessionId) ?? 0) > 0;
  }

  private reserveExternalBlockerSlot(sessionId: string): void {
    this.base.reserveExternalBlockerSlot?.(sessionId);
  }

  private releaseExternalBlockerSlot(sessionId: string): void {
    this.base.releaseExternalBlockerSlot?.(sessionId);
  }

  private reconcileExternalBlockerMeta(
    sessionId: string,
    input: Parameters<BrowserManager["reconcileExternalBlockerMeta"]>[1]
  ): BrowserResponseMeta | undefined {
    return this.base.reconcileExternalBlockerMeta?.(sessionId, input);
  }

  async launch(options: LaunchOptions): ReturnType<BrowserManagerLike["launch"]> {
    return this.base.launch(options);
  }

  async connect(options: ConnectOptions): ReturnType<BrowserManagerLike["connect"]> {
    return this.base.connect(options);
  }

  async connectRelay(wsEndpoint: string, options?: { startUrl?: string }): ReturnType<BrowserManagerLike["connectRelay"]> {
    const endpoint = new URL(wsEndpoint);
    if (endpoint.pathname.endsWith("/cdp")) {
      return options?.startUrl
        ? this.base.connectRelay(wsEndpoint, options)
        : this.base.connectRelay(wsEndpoint);
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
        parallelismPolicy: this.buildParallelismPolicyPayload(),
        ...(typeof options?.startUrl === "string" && options.startUrl.trim().length > 0
          ? { startUrl: options.startUrl.trim() }
          : {})
      },
      undefined,
      30000,
      leaseId
    );
    const sessionId = result.opsSessionId;
    this.opsSessions.add(sessionId);
    this.opsLeases.set(sessionId, result.leaseId ?? leaseId);
    this.reserveExternalBlockerSlot(sessionId);
    this.trackProtocolSession(sessionId, result.opsSessionId);
    this.rememberSessionTarget(sessionId, result.activeTargetId ?? null);
    this.rememberReconnectTarget(sessionId, result.activeTargetId ?? null, true);
    this.rememberSessionUrl(sessionId, result.url);
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
    this.releaseProtocolSession(sessionId);
    this.releaseExternalBlockerSlot(sessionId);
    this.opsSessionTabs.delete(sessionId);
    this.opsSessionReconnectTabs.delete(sessionId);
    this.opsSessionUrls.delete(sessionId);
    this.closedOpsSessions.delete(sessionId);
    await this.disconnectOpsClientIfIdle();
  }

  async status(sessionId: string): ReturnType<BrowserManagerLike["status"]> {
    if (!this.opsSessions.has(sessionId)) {
      if (this.closedOpsSessions.has(sessionId)) {
        throw new Error("[invalid_session] Session already closed");
      }
      return this.base.status(sessionId);
    }
    const result = await this.getRawOpsStatus(sessionId);
    return await this.maybeOrchestrateChallenge(sessionId, result.activeTargetId, this.withOpsMeta(sessionId, result, {
      source: "navigation",
      finalUrl: result.url,
      title: result.title,
      targetId: result.activeTargetId,
      verifier: false
    }));
  }

  async withPage<T>(sessionId: string, targetId: string | null, fn: (page: never) => Promise<T>): Promise<T> {
    if (!this.opsSessions.has(sessionId)) {
      return this.base.withPage(sessionId, targetId, fn as never);
    }
    throw new Error("Direct annotate is unavailable via extension ops sessions.");
  }

  async applyRuntimePreviewBridge(
    sessionId: string,
    targetId: string | null,
    input: RuntimePreviewBridgeInput
  ): Promise<RuntimePreviewBridgeResult> {
    if (!this.opsSessions.has(sessionId)) {
      if (typeof this.base.applyRuntimePreviewBridge === "function") {
        return await this.base.applyRuntimePreviewBridge(sessionId, targetId, input);
      }
      return await this.base.withPage(sessionId, targetId, async (page) => {
        const { applyRuntimePreviewBridge: runRuntimePreviewBridge } = await import("./canvas-runtime-preview-bridge");
        return await runRuntimePreviewBridge(page as {
          evaluate: <TArg, TResult>(
            pageFunction: (arg: TArg) => TResult | Promise<TResult>,
            arg: TArg
          ) => Promise<TResult>;
        }, input);
      });
    }
    return await this.requestOps<RuntimePreviewBridgeResult>(
      sessionId,
      "canvas.applyRuntimePreviewBridge",
      this.withTarget({
        bindingId: input.bindingId,
        rootSelector: input.rootSelector,
        html: input.html
      }, targetId)
    );
  }

  async mountCanvasOverlay(
    sessionId: string,
    targetId: string,
    input: BrowserCanvasOverlayMountInput
  ): Promise<BrowserCanvasOverlayResult> {
    return await this.requestOps(
      sessionId,
      "canvas.overlay.mount",
      this.withTarget({
        mountId: input.mountId,
        title: input.title,
        prototypeId: input.prototypeId,
        selection: input.selection
      }, targetId)
    );
  }

  supportsOpsOverlayTransport(sessionId: string): boolean {
    return this.opsSessions.has(sessionId);
  }

  async unmountCanvasOverlay(
    sessionId: string,
    targetId: string,
    mountId: string
  ): Promise<BrowserCanvasOverlayResult> {
    return await this.requestOps(
      sessionId,
      "canvas.overlay.unmount",
      this.withTarget({ mountId }, targetId)
    );
  }

  async selectCanvasOverlay(
    sessionId: string,
    targetId: string,
    input: BrowserCanvasOverlaySelectInput
  ): Promise<BrowserCanvasOverlayResult> {
    return await this.requestOps(
      sessionId,
      "canvas.overlay.select",
      this.withTarget({
        mountId: input.mountId,
        nodeId: input.nodeId,
        selectionHint: input.selectionHint
      }, targetId)
    );
  }

  async syncCanvasOverlay(
    sessionId: string,
    targetId: string,
    input: BrowserCanvasOverlaySyncInput
  ): Promise<BrowserCanvasOverlayResult> {
    return await this.requestOps(
      sessionId,
      "canvas.overlay.sync",
      this.withTarget({
        mountId: input.mountId,
        title: input.title,
        selection: input.selection
      }, targetId)
    );
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
    const result = await this.requestOps<Awaited<ReturnType<BrowserManagerLike["goto"]>>>(
      sessionId,
      "nav.goto",
      this.withTarget({ url, waitUntil, timeoutMs }, targetId)
    );
    const status = await this.getRawOpsStatus(sessionId);
    const rememberedUrl = typeof result.finalUrl === "string" ? result.finalUrl : url;
    const finalUrl = typeof result.finalUrl === "string" ? result.finalUrl : status.url ?? url;
    this.rememberSessionUrl(sessionId, rememberedUrl);
    return await this.maybeOrchestrateChallenge(sessionId, targetId ?? status.activeTargetId, this.withOpsMeta(sessionId, result, {
      source: "navigation",
      url,
      finalUrl,
      title: status.title,
      status: typeof result.status === "number" ? result.status : undefined,
      targetId: targetId ?? status.activeTargetId,
      verifier: true
    }));
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
    const result = await this.requestOps<Awaited<ReturnType<BrowserManagerLike["waitForLoad"]>>>(
      sessionId,
      "nav.wait",
      this.withTarget({ until, timeoutMs }, targetId)
    );
    const status = await this.getRawOpsStatus(sessionId);
    return await this.maybeOrchestrateChallenge(sessionId, targetId ?? status.activeTargetId, this.withOpsMeta(sessionId, result, {
      source: "navigation",
      finalUrl: status.url,
      title: status.title,
      targetId: targetId ?? status.activeTargetId,
      verifier: true
    }));
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
    const result = await this.requestOps<Awaited<ReturnType<BrowserManagerLike["waitForRef"]>>>(
      sessionId,
      "nav.wait",
      this.withTarget({ ref, state, timeoutMs }, targetId)
    );
    const status = await this.getRawOpsStatus(sessionId);
    return await this.maybeOrchestrateChallenge(sessionId, targetId ?? status.activeTargetId, this.withOpsMeta(sessionId, result, {
      source: "navigation",
      finalUrl: status.url,
      title: status.title,
      targetId: targetId ?? status.activeTargetId,
      verifier: true
    }));
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

  async pointerMove(
    sessionId: string,
    x: number,
    y: number,
    targetId?: string | null,
    steps?: number
  ): Promise<{ timingMs: number }> {
    if (!this.opsSessions.has(sessionId)) {
      return this.base.pointerMove(sessionId, x, y, targetId, steps);
    }
    return await this.requestOps(sessionId, "pointer.move", this.withTarget({ x, y, steps }, targetId));
  }

  async pointerDown(
    sessionId: string,
    x: number,
    y: number,
    targetId?: string | null,
    button: "left" | "middle" | "right" = "left",
    clickCount = 1
  ): Promise<{ timingMs: number }> {
    if (!this.opsSessions.has(sessionId)) {
      return this.base.pointerDown(sessionId, x, y, targetId, button, clickCount);
    }
    return await this.requestOps(sessionId, "pointer.down", this.withTarget({ x, y, button, clickCount }, targetId));
  }

  async pointerUp(
    sessionId: string,
    x: number,
    y: number,
    targetId?: string | null,
    button: "left" | "middle" | "right" = "left",
    clickCount = 1
  ): Promise<{ timingMs: number }> {
    if (!this.opsSessions.has(sessionId)) {
      return this.base.pointerUp(sessionId, x, y, targetId, button, clickCount);
    }
    return await this.requestOps(sessionId, "pointer.up", this.withTarget({ x, y, button, clickCount }, targetId));
  }

  async drag(
    sessionId: string,
    from: { x: number; y: number },
    to: { x: number; y: number },
    targetId?: string | null,
    steps?: number
  ): Promise<{ timingMs: number }> {
    if (!this.opsSessions.has(sessionId)) {
      return this.base.drag(sessionId, from, to, targetId, steps);
    }
    return await this.requestOps(
      sessionId,
      "pointer.drag",
      this.withTarget({ from, to, steps }, targetId)
    );
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

  async resolveRefPoint(
    sessionId: string,
    ref: string,
    targetId?: string | null
  ): Promise<{ x: number; y: number }> {
    if (!this.opsSessions.has(sessionId)) {
      const resolver = (this.base as BrowserManagerLike & {
        resolveRefPoint?: (
          sessionId: string,
          ref: string,
          targetId?: string | null
        ) => Promise<{ x: number; y: number }>;
      }).resolveRefPoint;
      if (!resolver) {
        throw new Error("Base browser manager does not support ref-point resolution.");
      }
      return await resolver(sessionId, ref, targetId);
    }
    return await this.requestOps(sessionId, "dom.refPoint", this.withTarget({ ref }, targetId));
  }

  async clonePageWithOptions(
    sessionId: string,
    targetId?: string | null,
    options: BrowserClonePageOptions = {}
  ): Promise<ReactExport> {
    if (!this.opsSessions.has(sessionId)) {
      return await this.base.clonePageWithOptions(sessionId, targetId, options);
    }
    const capture = await this.requestClonePageCapture(sessionId, targetId, options);
    const css = extractCss(capture);
    return emitReactComponent(capture, css, { allowUnsafeExport: this.config.security.allowUnsafeExport });
  }

  async clonePage(sessionId: string, targetId?: string | null): Promise<ReactExport> {
    return await this.clonePageWithOptions(sessionId, targetId);
  }

  async clonePageHtmlWithOptions(
    sessionId: string,
    targetId?: string | null,
    options: BrowserClonePageOptions = {}
  ): Promise<BrowserCloneHtmlResult> {
    if (!this.opsSessions.has(sessionId)) {
      return await this.base.clonePageHtmlWithOptions(sessionId, targetId, options);
    }
    const capture = await this.requestClonePageCapture(sessionId, targetId, options);
    return {
      html: capture.html,
      ...(capture.warnings ? { warnings: [...capture.warnings] } : {})
    };
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

  private async requestClonePageCapture(
    sessionId: string,
    targetId: string | null | undefined,
    options: BrowserClonePageOptions
  ): Promise<DomCapture> {
    const capture = await this.requestOps<{ capture: DomCapture }>(sessionId, "export.clonePage", this.withTarget({
      sanitize: !this.config.security.allowUnsafeExport,
      maxNodes: options.maxNodes ?? this.config.export.maxNodes,
      inlineStyles: options.inlineStyles ?? this.config.export.inlineStyles,
      styleAllowlist: Array.from(STYLE_ALLOWLIST),
      skipStyleValues: Array.from(SKIP_STYLE_VALUES)
    }, targetId));
    return capture.capture;
  }

  async perfMetrics(sessionId: string, targetId?: string | null): ReturnType<BrowserManagerLike["perfMetrics"]> {
    if (!this.opsSessions.has(sessionId)) {
      return this.base.perfMetrics(sessionId, targetId);
    }
    return await this.requestOps(sessionId, "devtools.perf", this.withTarget({}, targetId));
  }

  async screenshot(sessionId: string, options: BrowserScreenshotOptions = {}): Promise<BrowserScreenshotResult> {
    if (!this.opsSessions.has(sessionId)) {
      return this.base.screenshot(sessionId, options);
    }
    if (options.ref && options.fullPage) {
      throw new Error("Screenshot ref and fullPage options are mutually exclusive.");
    }
    const result = await this.requestOps<{ base64?: string; warning?: string; warnings?: string[] }>(
      sessionId,
      "page.screenshot",
      this.withTarget({
        ref: options.ref,
        fullPage: options.fullPage
      }, options.targetId)
    );
    if (!result.base64) {
      throw new Error("Screenshot failed");
    }
    const warnings = Array.isArray(result.warnings)
      ? result.warnings
      : (typeof result.warning === "string" ? [result.warning] : undefined);
    if (options.path) {
      await writeFile(options.path, Buffer.from(result.base64, "base64"));
      return warnings ? { path: options.path, warnings } : { path: options.path };
    }
    return warnings ? { base64: result.base64, warnings } : { base64: result.base64 };
  }

  async upload(sessionId: string, input: BrowserUploadInput): Promise<BrowserUploadResult> {
    if (!this.opsSessions.has(sessionId)) {
      return this.base.upload(sessionId, input);
    }
    return await this.requestOps<BrowserUploadResult>(
      sessionId,
      "interact.upload",
      this.withTarget({ ref: input.ref, files: input.files }, input.targetId)
    );
  }

  async dialog(sessionId: string, input: BrowserDialogInput = {}): Promise<BrowserDialogResult> {
    if (!this.opsSessions.has(sessionId)) {
      return this.base.dialog(sessionId, input);
    }
    return await this.requestOps<BrowserDialogResult>(
      sessionId,
      "page.dialog",
      this.withTarget({
        action: input.action ?? "status",
        promptText: input.promptText
      }, input.targetId)
    );
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

  async debugTraceSnapshot(
    sessionId: string,
    options: {
      sinceConsoleSeq?: number;
      sinceNetworkSeq?: number;
      sinceExceptionSeq?: number;
      max?: number;
      requestId?: string;
    } = {}
  ): ReturnType<BrowserManagerLike["debugTraceSnapshot"]> {
    if (!this.opsSessions.has(sessionId)) {
      return this.base.debugTraceSnapshot(sessionId, options);
    }
    const requestId = options.requestId ?? createRequestId();
    const status = await this.getRawOpsStatus(sessionId);
    const consoleChannel = await this.consolePoll(sessionId, options.sinceConsoleSeq, options.max ?? 500);
    const networkChannel = await this.networkPoll(sessionId, options.sinceNetworkSeq, options.max ?? 500);
    const meta = this.reconcileExternalBlockerMeta(sessionId, {
      source: "network",
      url: status.url,
      finalUrl: status.url,
      title: status.title,
      status: this.findLatestStatus(networkChannel.events),
      traceRequestId: requestId,
      networkEvents: networkChannel.events,
      consoleEvents: consoleChannel.events,
      exceptionEvents: [],
      verifier: true,
      includeArtifacts: true,
      ownerLeaseId: this.opsLeases.get(sessionId),
      targetKey: status.activeTargetId ?? undefined
    });
    const fingerprint = {
      tier1: {
        ok: true,
        warnings: [],
        issues: []
      },
      tier2: {
        enabled: false,
        mode: "disabled",
        profileId: "extension-ops",
        healthScore: 0,
        challengeCount: 0,
        rotationCount: 0,
        lastRotationTs: 0,
        lastAppliedNetworkSeq: 0,
        recentChallenges: []
      },
      tier3: {
        enabled: false,
        status: "disabled",
        adapterName: "extension-ops",
        fallbackTier: "A",
        canary: {
          level: 0,
          averageScore: 0,
          lastAction: "ops",
          sampleCount: 0
        }
      }
    } as unknown as Awaited<ReturnType<BrowserManagerLike["debugTraceSnapshot"]>>["fingerprint"];
    return {
      requestId,
      generatedAt: new Date().toISOString(),
      page: {
        mode: status.mode,
        activeTargetId: status.activeTargetId,
        ...(status.url ? { url: status.url } : {}),
        ...(status.title ? { title: status.title } : {})
      },
      channels: {
        console: {
          nextSeq: consoleChannel.nextSeq,
          events: consoleChannel.events.map((event) => ({
            ...event,
            requestId,
            sessionId
          }))
        },
        network: {
          nextSeq: networkChannel.nextSeq,
          events: networkChannel.events.map((event) => ({
            ...event,
            requestId,
            sessionId
          }))
        },
        exception: {
          nextSeq: options.sinceExceptionSeq ?? 0,
          events: []
        }
      },
      fingerprint,
      meta
    };
  }

  async listTargets(sessionId: string, includeUrls = false): Promise<{ activeTargetId: string | null; targets: TargetInfo[] }> {
    if (!this.opsSessions.has(sessionId)) {
      return this.base.listTargets(sessionId, includeUrls);
    }
    const result = await this.requestOps<{ activeTargetId: string | null; targets: TargetInfo[] }>(sessionId, "targets.list", { includeUrls });
    this.rememberSessionTarget(sessionId, result.activeTargetId ?? null);
    return result;
  }

  async registerCanvasTarget(
    sessionId: string,
    targetId: string
  ): Promise<{ targetId: string; url?: string; title?: string; adopted?: boolean }> {
    if (!this.opsSessions.has(sessionId)) {
      return { targetId, adopted: false };
    }
    const result = await this.requestOps<{ targetId: string; url?: string; title?: string; adopted?: boolean }>(
      sessionId,
      "targets.registerCanvas",
      { targetId }
    );
    this.rememberSessionTarget(sessionId, result.targetId);
    return result;
  }

  async useTarget(sessionId: string, targetId: string): Promise<{ activeTargetId: string; url?: string; title?: string }> {
    if (!this.opsSessions.has(sessionId)) {
      return this.base.useTarget(sessionId, targetId);
    }
    const result = await this.requestOps<{ activeTargetId: string; url?: string; title?: string }>(
      sessionId,
      "targets.use",
      { targetId }
    );
    this.rememberSessionTarget(sessionId, result.activeTargetId);
    return result;
  }

  async newTarget(sessionId: string, url?: string): Promise<{ targetId: string }> {
    if (!this.opsSessions.has(sessionId)) {
      return this.base.newTarget(sessionId, url);
    }
    const result = await this.requestOps<{ targetId: string }>(sessionId, "targets.new", { url });
    this.rememberSessionTarget(sessionId, result.targetId);
    return result;
  }

  async closeTarget(sessionId: string, targetId: string): Promise<void> {
    if (!this.opsSessions.has(sessionId)) {
      return this.base.closeTarget(sessionId, targetId);
    }
    await this.requestOps(sessionId, "targets.close", { targetId });
    if (this.opsSessionTabs.get(sessionId) === parseTabTargetId(targetId)) {
      this.opsSessionTabs.delete(sessionId);
    }
    if (this.opsSessionReconnectTabs.get(sessionId) === parseTabTargetId(targetId)) {
      this.opsSessionReconnectTabs.delete(sessionId);
    }
  }

  async page(sessionId: string, name: string, url?: string): Promise<{ targetId: string; created: boolean; url?: string; title?: string }> {
    if (!this.opsSessions.has(sessionId)) {
      return this.base.page(sessionId, name, url);
    }
    const result = await this.requestOps<{ targetId: string; created: boolean; url?: string; title?: string }>(
      sessionId,
      "page.open",
      { name, url }
    );
    this.rememberSessionTarget(sessionId, result.targetId);
    return result;
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
    void this.opsClient?.disconnect();
    let client: OpsClient;
    client = new OpsClient(wsEndpoint, {
      onEvent: (event) => {
        this.handleOpsEvent(event);
      },
      onClose: () => {
        this.handleOpsClientClosed(client);
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

  private resolveOpsRequestTimeoutMs(command: string): number {
    if (command === "interact.click") {
      return OPS_CLICK_REQUEST_TIMEOUT_MS;
    }
    return OPS_REQUEST_TIMEOUT_MS;
  }

  private shouldRecoverOpsTimeout(command: string): boolean {
    return command !== "interact.click" && command !== "page.dialog";
  }

  private async requestOps<T>(sessionId: string, command: string, payload: Record<string, unknown>): Promise<T> {
    const leaseId = this.opsLeases.get(sessionId);
    if (!leaseId) {
      throw new Error("Ops lease not found for session");
    }
    const requestTimeoutMs = this.resolveOpsRequestTimeoutMs(command);
    let client = this.opsClient;
    if (!client) {
      client = await this.reconnectOpsClient(sessionId, payload);
    }
    let protocolSessionId = this.getProtocolSessionId(sessionId);
    try {
      return await client.request<T>(command, payload, protocolSessionId, requestTimeoutMs, leaseId);
    } catch (error) {
      if (command === "session.connect") {
        throw error;
      }
      if (isOpsRequestTimeoutError(error) && !this.shouldRecoverOpsTimeout(command)) {
        throw error;
      }
      if (isOpsRelayUnavailableError(error)) {
        const relayReady = await this.waitForRelayExtensionReady();
        if (!relayReady) {
          throw error;
        }
        if (!this.opsClient && this.opsEndpoint) {
          client = await this.ensureOpsClient(this.opsEndpoint);
        }
      } else if (!isUnknownOpsSessionError(error) && !isOpsRequestTimeoutError(error)) {
        throw error;
      } else if (this.opsEndpoint) {
        const relayReady = await this.waitForRelayExtensionReady();
        if (!relayReady) {
          throw error;
        }
        if (!this.opsClient) {
          client = await this.ensureOpsClient(this.opsEndpoint);
        }
      }
      const recovered = await this.recoverOpsSession(sessionId, payload);
      if (!recovered) {
        throw error;
      }
      const recoveredClient = this.opsClient ?? client;
      const recoveredLeaseId = this.opsLeases.get(sessionId) ?? leaseId;
      if (!recoveredClient) {
        throw error;
      }
      protocolSessionId = this.getProtocolSessionId(sessionId);
      return await recoveredClient.request<T>(command, payload, protocolSessionId, requestTimeoutMs, recoveredLeaseId);
    }
  }

  private async reconnectOpsClient(sessionId: string, payload: Record<string, unknown>): Promise<OpsClient> {
    const endpoint = this.opsEndpoint;
    if (!endpoint) {
      throw new Error("Ops client not connected");
    }
    const relayReady = await this.waitForRelayExtensionReady();
    if (!relayReady) {
      throw new Error("Ops client not connected");
    }
    const client = await this.ensureOpsClient(endpoint);
    const recovered = await this.recoverOpsSession(sessionId, payload);
    if (!recovered) {
      throw new Error("Ops client not connected");
    }
    return client;
  }

  private async waitForRelayExtensionReady(timeoutMs = 15000): Promise<boolean> {
    const endpoint = this.opsEndpoint;
    if (!endpoint) {
      return false;
    }
    const statusUrl = this.buildRelayStatusUrl(endpoint);
    if (!statusUrl) {
      return false;
    }
    const headers: Record<string, string> = { Accept: "application/json" };
    const relayToken = typeof this.config.relayToken === "string" ? this.config.relayToken.trim() : "";
    if (relayToken) {
      headers.Authorization = `Bearer ${relayToken}`;
    }
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(statusUrl.toString(), { headers });
        if (response.ok) {
          const payload = await response.json() as {
            extensionConnected?: boolean;
            extensionHandshakeComplete?: boolean;
          };
          if (payload.extensionConnected === true && payload.extensionHandshakeComplete === true) {
            return true;
          }
        }
      } catch {
        // retry until timeout
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return false;
  }

  private buildRelayStatusUrl(wsEndpoint: string): URL | null {
    try {
      const socketUrl = new URL(wsEndpoint);
      const protocol = socketUrl.protocol === "wss:" ? "https:" : "http:";
      return new URL("/status", `${protocol}//${socketUrl.hostname}:${socketUrl.port}`);
    } catch {
      return null;
    }
  }

  private handleOpsEvent(event: { event?: string; opsSessionId?: string }): void {
    if (!event.opsSessionId) return;
    const sessionId = this.publicSessionIdsByProtocolId.get(event.opsSessionId) ?? event.opsSessionId;
    if (event.event === "ops_session_closed" || event.event === "ops_session_expired" || event.event === "ops_tab_closed") {
      this.opsSessions.delete(sessionId);
      this.opsLeases.delete(sessionId);
      this.releaseProtocolSession(sessionId);
      this.releaseExternalBlockerSlot(sessionId);
      this.opsSessionTabs.delete(sessionId);
      this.opsSessionReconnectTabs.delete(sessionId);
      this.opsSessionUrls.delete(sessionId);
      this.opsSessionChallengeAutomationModes.delete(sessionId);
      this.closedOpsSessions.set(sessionId, Date.now());
      this.trackClosedSessionCleanup();
      void this.disconnectOpsClientIfIdle();
    }
  }

  private handleOpsClientClosed(client: OpsClient): void {
    if (this.opsClient && this.opsClient !== client) {
      return;
    }
    if (this.opsClient === client) {
      this.opsClient = null;
    }
    if (this.opsSessions.size === 0) {
      this.opsEndpoint = null;
      return;
    }
    // Preserve live-session metadata so the next command can reconnect to the relay and recover
    // the same public session onto the last known target instead of silently degrading to a fresh tab.
    this.opsProtocolSessions.clear();
    this.publicSessionIdsByProtocolId.clear();
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

  private async disconnectOpsClientIfIdle(): Promise<void> {
    if (this.opsSessions.size > 0) {
      return;
    }
    if (this.idleDisconnectPromise) {
      await this.idleDisconnectPromise;
      return;
    }
    const client = this.opsClient;
    this.opsClient = null;
    this.opsEndpoint = null;
    if (client && typeof client.disconnect === "function") {
      const pending = Promise.resolve(client.disconnect()).finally(() => {
        if (this.idleDisconnectPromise === pending) {
          this.idleDisconnectPromise = null;
        }
      });
      this.idleDisconnectPromise = pending;
      await pending;
    }
  }

  private rememberSessionTarget(sessionId: string, targetId: string | null | undefined): void {
    const tabId = parseTabTargetId(targetId);
    if (tabId === null) {
      return;
    }
    this.opsSessionTabs.set(sessionId, tabId);
  }

  private rememberReconnectTarget(
    sessionId: string,
    targetId: string | null | undefined,
    overwrite = false
  ): void {
    const tabId = parseTabTargetId(targetId);
    if (tabId === null) {
      return;
    }
    if (!overwrite && this.opsSessionReconnectTabs.has(sessionId)) {
      return;
    }
    this.opsSessionReconnectTabs.set(sessionId, tabId);
  }

  private rememberSessionUrl(sessionId: string, url: string | null | undefined): void {
    const normalized = normalizeRecoverableOpsUrl(url);
    if (!normalized) {
      return;
    }
    this.opsSessionUrls.set(sessionId, normalized);
  }

  private async recoverOpsSession(sessionId: string, payload: Record<string, unknown>): Promise<boolean> {
    const client = this.opsClient;
    const leaseId = this.opsLeases.get(sessionId);
    if (!client || !leaseId) {
      return false;
    }

    const reconnectPayload: Record<string, unknown> = {
      sessionId,
      parallelismPolicy: this.buildParallelismPolicyPayload()
    };
    const requestedTabId = parseTabTargetId(typeof payload.targetId === "string" ? payload.targetId : null);
    const rememberedTabId = requestedTabId
      ?? this.opsSessionTabs.get(sessionId)
      ?? this.opsSessionReconnectTabs.get(sessionId);
    const fallbackUrl = normalizeRecoverableOpsUrl(payload.url) ?? this.opsSessionUrls.get(sessionId) ?? null;
    if (typeof rememberedTabId === "number") {
      reconnectPayload.tabId = rememberedTabId;
    } else if (fallbackUrl) {
      reconnectPayload.startUrl = fallbackUrl;
    }

    const recoveryDeadlineMs = Date.now() + 30000;
    const nextRecoveryTimeoutMs = (): number => {
      const remainingMs = Math.floor(recoveryDeadlineMs - Date.now());
      return remainingMs > 0 ? remainingMs : 1;
    };
    const reconnectStage = (candidatePayload: Record<string, unknown>): string => {
      if (typeof candidatePayload.tabId === "number") {
        return "session.connect.tabId";
      }
      if (typeof candidatePayload.startUrl === "string") {
        return "session.connect.startUrl";
      }
      return "session.connect";
    };
    const reconnectSession = async (
      candidatePayload: Record<string, unknown>
    ): Promise<{ opsSessionId: string; activeTargetId?: string | null; leaseId?: string; url?: string }> => {
      const timeoutMs = nextRecoveryTimeoutMs();
      try {
        return await client.request<{ opsSessionId: string; activeTargetId?: string | null; leaseId?: string; url?: string }>(
          "session.connect",
          candidatePayload,
          undefined,
          timeoutMs,
          leaseId
        );
      } catch (error) {
        throw withOpsRequestTimeoutDetails(error, {
          timeoutMs,
          stage: reconnectStage(candidatePayload)
        });
      }
    };

    let result: { opsSessionId: string; activeTargetId?: string | null; leaseId?: string; url?: string };
    try {
      result = await reconnectSession(reconnectPayload);
    } catch (error) {
      if (
        (!isUnknownOpsTabError(error) && !isOpsRequestTimeoutError(error))
        || !fallbackUrl
        || !("tabId" in reconnectPayload)
      ) {
        throw error;
      }
      result = await reconnectSession({
        sessionId,
        parallelismPolicy: this.buildParallelismPolicyPayload(),
        startUrl: fallbackUrl
      });
    }

    this.opsSessions.add(sessionId);
    this.opsLeases.set(sessionId, result.leaseId ?? leaseId);
    this.reserveExternalBlockerSlot(sessionId);
    this.trackProtocolSession(sessionId, result.opsSessionId);
    this.rememberSessionTarget(sessionId, result.activeTargetId ?? null);
    this.rememberReconnectTarget(sessionId, result.activeTargetId ?? null);
    this.rememberSessionUrl(sessionId, result.url ?? fallbackUrl);
    this.closedOpsSessions.delete(sessionId);
    return true;
  }

  private getProtocolSessionId(sessionId: string): string {
    return this.opsProtocolSessions.get(sessionId) ?? sessionId;
  }

  private trackProtocolSession(sessionId: string, protocolSessionId: string): void {
    const previousProtocolSessionId = this.opsProtocolSessions.get(sessionId);
    if (previousProtocolSessionId && previousProtocolSessionId !== protocolSessionId) {
      this.publicSessionIdsByProtocolId.delete(previousProtocolSessionId);
    }
    this.opsProtocolSessions.set(sessionId, protocolSessionId);
    this.publicSessionIdsByProtocolId.set(protocolSessionId, sessionId);
  }

  private releaseProtocolSession(sessionId: string): void {
    const protocolSessionId = this.opsProtocolSessions.get(sessionId);
    if (protocolSessionId) {
      this.publicSessionIdsByProtocolId.delete(protocolSessionId);
    }
    this.opsProtocolSessions.delete(sessionId);
  }

  private async getRawOpsStatus(
    sessionId: string
  ): Promise<{ mode: BrowserMode; activeTargetId: string | null; url?: string; title?: string; dialog?: BrowserDialogState }> {
    const result = await this.requestOps<{ mode: BrowserMode; activeTargetId: string | null; url?: string; title?: string; dialog?: BrowserDialogState }>(
      sessionId,
      "session.status",
      {}
    );
    this.rememberSessionTarget(sessionId, result.activeTargetId ?? null);
    this.rememberSessionUrl(sessionId, result.url);
    return result;
  }

  private async maybeOrchestrateChallenge<T extends Record<string, unknown> & { meta?: BrowserResponseMeta }>(
    sessionId: string,
    targetId: string | null | undefined,
    result: T
  ): Promise<T> {
    if (!result.meta?.challenge || result.meta.blockerState === "clear") {
      return result;
    }
    if (!this.challengeOrchestrator) {
      return result;
    }
    const policy = resolveChallengeAutomationPolicy({
      sessionMode: this.getSessionChallengeAutomationMode(sessionId),
      configMode: this.config.providers?.challengeOrchestration.mode ?? "browser_with_helper"
    });
    if (this.isChallengeAutomationSuppressed(sessionId)) {
      return {
        ...result,
        meta: {
          ...result.meta,
          challengeOrchestration: {
            challengeId: result.meta.challenge.challengeId,
            classification: result.meta.blocker?.type === "auth_required"
              ? "auth_required"
              : "unsupported_third_party_challenge",
            mode: policy.mode,
            source: policy.source,
            lane: "defer",
            status: "deferred",
            reason: "Challenge automation is suppressed while a bounded challenge action is already in progress.",
            attempts: 0,
            reusedExistingSession: false,
            reusedCookies: false,
            standDownReason: "suppressed_by_manager",
            helperEligibility: {
              allowed: false,
              reason: "Challenge automation is currently suppressed by the manager guard.",
              standDownReason: "suppressed_by_manager"
            },
            verification: {
              status: "still_blocked",
              blockerState: result.meta.blockerState,
              blocker: result.meta.blocker,
              challenge: result.meta.challenge,
              changed: false,
              reason: "Challenge automation is currently suppressed by the manager guard."
            },
            evidence: {
              loginRefs: [],
              humanVerificationRefs: [],
              checkpointRefs: []
            }
          }
        }
      };
    }
    try {
      const orchestration = await this.challengeOrchestrator.orchestrate({
        handle: this.createChallengeRuntimeHandle(),
        sessionId,
        targetId,
        policy,
        canImportCookies: true
      });
      const verification = orchestration.action.verification;
      return {
        ...result,
        meta: {
          ...result.meta,
          blocker: verification.blocker,
          blockerState: verification.blockerState,
          blockerResolution: verification.bundle?.blockerResolution ?? result.meta.blockerResolution,
          challenge: verification.challenge ?? verification.bundle?.challenge ?? result.meta.challenge,
          challengeOrchestration: orchestration.outcome
        }
      };
    } catch {
      return result;
    }
  }

  private withOpsMeta<T extends Record<string, unknown>>(
    sessionId: string,
    result: T,
    options: {
      source: "navigation" | "network";
      url?: string;
      finalUrl?: string;
      title?: string;
      status?: number;
      targetId?: string | null;
      verifier?: boolean;
      includeArtifacts?: boolean;
      traceRequestId?: string;
      networkEvents?: Array<{ url?: string; status?: number }>;
      consoleEvents?: unknown[];
      exceptionEvents?: unknown[];
      envLimited?: boolean;
    }
  ): T & { meta?: BrowserResponseMeta } {
    const { dialog, ...rest } = result as T & { dialog?: BrowserDialogState };
    const meta = this.reconcileExternalBlockerMeta(sessionId, {
      source: options.source,
      url: options.url,
      finalUrl: options.finalUrl,
      title: options.title,
      status: options.status,
      traceRequestId: options.traceRequestId,
      networkEvents: options.networkEvents,
      consoleEvents: options.consoleEvents,
      exceptionEvents: options.exceptionEvents,
      verifier: options.verifier,
      includeArtifacts: options.includeArtifacts,
      envLimited: options.envLimited,
      ownerLeaseId: this.opsLeases.get(sessionId),
      targetKey: options.targetId ?? undefined
    });
    if (meta) {
      return dialog ? { ...rest as T, meta: { ...meta, dialog } } : { ...rest as T, meta };
    }
    if (dialog) {
      return { ...rest as T, meta: { blockerState: "clear", dialog } };
    }
    return rest as T;
  }

  private findLatestStatus(events: Array<{ status?: number }>): number | undefined {
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const status = events[index]?.status;
      if (typeof status === "number") {
        return status;
      }
    }
    return undefined;
  }
}

const isIgnorableOpsDisconnectError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return isOpsRequestTimeoutError(error)
    || message.includes("Ops request timed out")
    || message.includes("[invalid_session] Unknown ops session")
    || message.includes("Ops socket closed");
};

const OPS_REQUEST_TIMEOUT_MS = 30_000;
const OPS_CLICK_REQUEST_TIMEOUT_MS = 55_000;

const isUnknownOpsSessionError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.includes("[invalid_session] Unknown ops session");
};

const isOpsRelayUnavailableError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.includes("[ops_unavailable]")
    || message.includes("[relay_unavailable]")
    || message.includes("Extension not connected to relay");
};

const isUnknownOpsTabError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.includes("[invalid_request] Unknown tabId:");
};

const parseTabTargetId = (targetId: string | null | undefined): number | null => {
  if (typeof targetId !== "string") {
    return null;
  }
  const match = /^tab-(\d+)$/.exec(targetId.trim());
  if (!match) {
    return null;
  }
  return Number.parseInt(match[1]!, 10);
};

const normalizeRecoverableOpsUrl = (url: unknown): string | null => {
  if (typeof url !== "string") {
    return null;
  }
  const trimmed = url.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? trimmed : null;
  } catch {
    return null;
  }
};
