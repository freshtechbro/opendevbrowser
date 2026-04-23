import { randomUUID } from "crypto";
import type { OpenDevBrowserCore } from "../core";
import { buildBrowserReviewResult } from "../browser/review-surface";
import {
  buildCorrelatedAuditBundle,
  inspectSession
} from "../browser/session-inspector";
import { resolveBundledProviderRuntime } from "../providers/runtime-bundle";
import { buildBlockerArtifacts, classifyBlockerSignal } from "../providers/blocker";
import { captureInspiredesignReferenceFromManager } from "../providers/inspiredesign-capture";
import {
  runInspiredesignWorkflow,
  runProductVideoWorkflow,
  runResearchWorkflow,
  runShoppingWorkflow
} from "../providers/workflows";
import { buildMacroResolveSuccessHandoff } from "../providers/workflow-handoff";
import { isChallengeAutomationMode, type ChallengeAutomationMode } from "../challenges";
import {
  type MacroExecutionPayload,
  type MacroResolution
} from "../macros/execute";
import { executeMacroWithRuntime } from "../macros/execute-runtime";
import type { RuntimeInit } from "../providers";
import type { AnnotationDispatchSource, AnnotationPayload } from "../relay/protocol";
import {
  buildLoopbackSessionRelayEndpoint,
  classifySessionRelayEndpoint,
  resolveSessionRelayRoute
} from "../relay/relay-endpoints";
import {
  bindRelay,
  waitForBinding,
  releaseRelay,
  renewRelay,
  requireBinding,
  completeScreencastOwner,
  registerScreencastOwner,
  requireScreencastOwner,
  registerSessionLease,
  getSessionLease,
  requireSessionLease,
  releaseSessionLease,
  releaseOwnedSessionLease,
  getBindingRenewConfig,
  getHubInstanceId
} from "./daemon-state";
import { fetchWithTimeout } from "./utils/http";

export type DaemonCommandRequest = {
  name: string;
  params?: Record<string, unknown>;
};

const createDaemonWorkflowRuntime = (
  core: OpenDevBrowserCore,
  options?: { init?: Omit<RuntimeInit, "providers"> }
) => resolveBundledProviderRuntime({
  existingRuntime: core.providerRuntime,
  config: core.config,
  manager: core.manager,
  browserFallbackPort: core.browserFallbackPort,
  init: options?.init
});

export async function handleDaemonCommand(core: OpenDevBrowserCore, request: DaemonCommandRequest): Promise<unknown> {
  const params = request.params ?? {};
  const bindingId = optionalString(params.bindingId);

  try {
    return await (async () => {
      switch (request.name) {
    case "relay.status":
      return core.relay.status();
    case "relay.cdpUrl":
      return core.relay.getCdpUrl();
    case "relay.annotationUrl":
      return core.relay.getAnnotationUrl?.() ?? null;
    case "relay.opsUrl":
      return core.relay.getOpsUrl?.() ?? null;
    case "relay.canvasUrl":
      return core.relay.getCanvasUrl?.() ?? null;
    case "canvas.execute":
      return core.canvasManager.execute(
        requireString(params.command, "command"),
        requireRecord(params.params ?? {}, "params")
      );
    case "relay.bind": {
      const clientId = requireClientId(params);
      const binding = bindRelay(clientId);
      const relayStatus = core.relay.status();
      return {
        ...binding,
        hubInstanceId: getHubInstanceId(),
        relayInstanceId: relayStatus.instanceId,
        relayPort: relayStatus.port ?? null,
        bindingConfig: getBindingRenewConfig()
      };
    }
    case "relay.wait": {
      const clientId = requireClientId(params);
      const timeoutMs = optionalNumber(params.timeoutMs, "timeoutMs");
      const binding = await waitForBinding(clientId, timeoutMs);
      const relayStatus = core.relay.status();
      return {
        ...binding,
        hubInstanceId: getHubInstanceId(),
        relayInstanceId: relayStatus.instanceId,
        relayPort: relayStatus.port ?? null,
        bindingConfig: getBindingRenewConfig()
      };
    }
    case "relay.renew": {
      const clientId = requireClientId(params);
      const binding = renewRelay(clientId, requireString(bindingId, "bindingId"));
      const relayStatus = core.relay.status();
      return {
        ...binding,
        hubInstanceId: getHubInstanceId(),
        relayInstanceId: relayStatus.instanceId,
        relayPort: relayStatus.port ?? null,
        bindingConfig: getBindingRenewConfig()
      };
    }
    case "relay.release": {
      const clientId = requireClientId(params);
      return releaseRelay(clientId, requireString(bindingId, "bindingId"));
    }
    case "session.launch":
      return launchWithRelay(core, params, requireClientId(params), bindingId);
    case "session.connect":
      return connectWithRelayRouting(core, params, requireClientId(params), bindingId);
    case "session.disconnect":
      return disconnectSession(core, params, requireClientId(params), bindingId);
    case "session.status":
      await authorizeSessionCommand(core, params, request.name, bindingId);
      return core.manager.status(requireString(params.sessionId, "sessionId"));
    case "status.capabilities":
      if (typeof params.sessionId === "string") {
        await authorizeSessionCommand(core, params, request.name, bindingId);
      }
      return runStatusCapabilities(core, params);
    case "session.inspect": {
      await authorizeSessionCommand(core, params, request.name, bindingId);
      const inspector = requireSessionInspectorHandle(core);
      return inspectSession(inspector, {
        sessionId: requireString(params.sessionId, "sessionId"),
        includeUrls: optionalBoolean(params.includeUrls) ?? true,
        sinceConsoleSeq: optionalNumber(params.sinceConsoleSeq, "sinceConsoleSeq") ?? undefined,
        sinceNetworkSeq: optionalNumber(params.sinceNetworkSeq, "sinceNetworkSeq") ?? undefined,
        sinceExceptionSeq: optionalNumber(params.sinceExceptionSeq, "sinceExceptionSeq") ?? undefined,
        max: optionalNumber(params.max, "max") ?? undefined,
        requestId: optionalString(params.requestId),
        relayStatus: core.relay.status()
      });
    }
    case "session.inspectPlan":
      await authorizeSessionCommand(core, params, request.name, bindingId);
      return runInspectChallengePlan(core, params);
    case "session.inspectAudit":
      await authorizeSessionCommand(core, params, request.name, bindingId);
      return runInspectAudit(core, params);
    case "desktop.status":
      return core.desktopRuntime.status();
    case "desktop.windows.list":
      return core.desktopRuntime.listWindows(optionalString(params.reason));
    case "desktop.window.active":
      return core.desktopRuntime.activeWindow(optionalString(params.reason));
    case "desktop.capture.desktop":
      return core.desktopRuntime.captureDesktop({
        reason: requireString(params.reason, "reason")
      });
    case "desktop.capture.window":
      return core.desktopRuntime.captureWindow(
        requireString(params.windowId, "windowId"),
        { reason: requireString(params.reason, "reason") }
      );
    case "desktop.accessibility.snapshot":
      return core.desktopRuntime.accessibilitySnapshot(
        requireString(params.reason, "reason"),
        optionalString(params.windowId)
      );
    case "annotate": {
      await authorizeSessionCommand(core, params, request.name, bindingId);
      const sessionId = requireString(params.sessionId, "sessionId");
      const stored = optionalBoolean(params.stored) ?? false;
      const transport = stored ? "relay" : requireAnnotationTransport(params.transport);
      if (transport === "relay" && !stored) {
        const status = await core.manager.status(sessionId);
        if (status.mode !== "extension") {
          throw new Error("Relay annotations require extension mode.");
        }
      }
      const url = optionalString(params.url);
      const targetId = optionalString(params.targetId);
      const tabId = optionalNumber(params.tabId, "tabId");
      const screenshotMode = requireScreenshotMode(params.screenshotMode);
      const debug = optionalBoolean(params.debug) ?? false;
      const context = optionalString(params.context);
      const includeScreenshots = optionalBoolean(params.includeScreenshots) ?? true;
      const timeoutMs = optionalNumber(params.timeoutMs, "timeoutMs");
      return core.annotationManager.requestAnnotation({
        sessionId,
        transport,
        stored,
        includeScreenshots,
        targetId,
        tabId,
        url,
        screenshotMode,
        debug,
        context,
        timeoutMs
      });
    }
    case "agent.inbox.enqueue":
      return core.agentInbox.enqueue({
        payload: requireAnnotationPayload(params.payload),
        source: requireAnnotationDispatchSource(params.source),
        label: optionalString(params.label) ?? "",
        explicitChatScopeKey: optionalString(params.chatScopeKey) ?? null
      });
    case "agent.inbox.peek": {
      const chatScopeKey = requireString(params.chatScopeKey, "chatScopeKey");
      return {
        chatScopeKey,
        activeScopes: core.agentInbox.listActiveScopes(),
        entries: core.agentInbox.peekScope(chatScopeKey)
      };
    }
    case "agent.inbox.consume": {
      const chatScopeKey = requireString(params.chatScopeKey, "chatScopeKey");
      const entries = core.agentInbox.consumeScope(chatScopeKey);
      return {
        chatScopeKey,
        receiptIds: entries.map((entry) => entry.id),
        entries
      };
    }
    case "agent.inbox.ack": {
      const receiptIds = requireStringArray(params.receiptIds, "receiptIds");
      core.agentInbox.acknowledge(receiptIds);
      return {
        ok: true,
        receiptIds
      };
    }
    case "targets.list":
      await authorizeSessionCommand(core, params, request.name, bindingId);
      return core.manager.listTargets(
        requireString(params.sessionId, "sessionId"),
        optionalBoolean(params.includeUrls) ?? false
      );
    case "targets.use":
      await authorizeSessionCommand(core, params, request.name, bindingId);
      return core.manager.useTarget(
        requireString(params.sessionId, "sessionId"),
        requireString(params.targetId, "targetId")
      );
    case "targets.new":
      await authorizeSessionCommand(core, params, request.name, bindingId);
      return core.manager.newTarget(
        requireString(params.sessionId, "sessionId"),
        optionalString(params.url)
      );
    case "targets.close":
      await authorizeSessionCommand(core, params, request.name, bindingId);
      await core.manager.closeTarget(
        requireString(params.sessionId, "sessionId"),
        requireString(params.targetId, "targetId")
      );
      return { ok: true };
    case "page.open":
      await authorizeSessionCommand(core, params, request.name, bindingId);
      return core.manager.page(
        requireString(params.sessionId, "sessionId"),
        requireString(params.name, "name"),
        optionalString(params.url)
      );
    case "page.list":
      await authorizeSessionCommand(core, params, request.name, bindingId);
      return core.manager.listPages(requireString(params.sessionId, "sessionId"));
    case "page.close":
      await authorizeSessionCommand(core, params, request.name, bindingId);
      await core.manager.closePage(
        requireString(params.sessionId, "sessionId"),
        requireString(params.name, "name")
      );
      return { ok: true };
    case "nav.goto":
      await authorizeSessionCommand(core, params, request.name, bindingId);
      {
        const targetId = optionalString(params.targetId);
        const sessionId = requireString(params.sessionId, "sessionId");
      return attachBlockerMetaForNavigation(
        core,
          sessionId,
        await core.manager.goto(
            sessionId,
          requireString(params.url, "url"),
          requireWaitUntil(params.waitUntil),
            optionalNumber(params.timeoutMs, "timeoutMs") ?? 30000,
            undefined,
            targetId
        )
      );
      }
    case "nav.wait":
      await authorizeSessionCommand(core, params, request.name, bindingId);
      {
        const targetId = optionalString(params.targetId);
        const sessionId = requireString(params.sessionId, "sessionId");
      if (typeof params.ref === "string") {
        return attachBlockerMetaForNavigation(
          core,
            sessionId,
          await core.manager.waitForRef(
              sessionId,
            requireString(params.ref, "ref"),
            requireState(params.state),
              optionalNumber(params.timeoutMs, "timeoutMs") ?? 30000,
              targetId
          )
        );
      }
      return attachBlockerMetaForNavigation(
        core,
          sessionId,
        await core.manager.waitForLoad(
            sessionId,
          requireWaitUntil(params.until),
            optionalNumber(params.timeoutMs, "timeoutMs") ?? 30000,
            targetId
        )
      );
      }
    case "nav.snapshot":
      await authorizeSessionCommand(core, params, request.name, bindingId);
      {
        const targetId = optionalString(params.targetId);
      return core.manager.snapshot(
        requireString(params.sessionId, "sessionId"),
        requireSnapshotMode(params.mode),
        optionalNumber(params.maxChars, "maxChars") ?? 16000,
          optionalString(params.cursor),
          targetId
      );
      }
    case "nav.review":
      await authorizeSessionCommand(core, params, request.name, bindingId);
      return buildBrowserReviewResult({
        manager: core.manager,
        sessionId: requireString(params.sessionId, "sessionId"),
        targetId: optionalString(params.targetId),
        maxChars: optionalNumber(params.maxChars, "maxChars") ?? core.config.snapshot.maxChars,
        cursor: optionalString(params.cursor)
      });
    case "nav.reviewDesktop":
      await authorizeSessionCommand(core, params, request.name, bindingId);
      return runReviewDesktop(core, params);
    case "interact.click":
      await authorizeSessionCommand(core, params, request.name, bindingId);
      return core.manager.click(
        requireString(params.sessionId, "sessionId"),
        requireString(params.ref, "ref"),
        optionalString(params.targetId)
      );
    case "interact.hover":
      await authorizeSessionCommand(core, params, request.name, bindingId);
      return core.manager.hover(
        requireString(params.sessionId, "sessionId"),
        requireString(params.ref, "ref"),
        optionalString(params.targetId)
      );
    case "interact.press":
      await authorizeSessionCommand(core, params, request.name, bindingId);
      return core.manager.press(
        requireString(params.sessionId, "sessionId"),
        requireString(params.key, "key"),
        optionalString(params.ref),
        optionalString(params.targetId)
      );
    case "interact.check":
      await authorizeSessionCommand(core, params, request.name, bindingId);
      return core.manager.check(
        requireString(params.sessionId, "sessionId"),
        requireString(params.ref, "ref"),
        optionalString(params.targetId)
      );
    case "interact.uncheck":
      await authorizeSessionCommand(core, params, request.name, bindingId);
      return core.manager.uncheck(
        requireString(params.sessionId, "sessionId"),
        requireString(params.ref, "ref"),
        optionalString(params.targetId)
      );
    case "interact.type":
      await authorizeSessionCommand(core, params, request.name, bindingId);
      return core.manager.type(
        requireString(params.sessionId, "sessionId"),
        requireString(params.ref, "ref"),
        requireString(params.text, "text"),
        optionalBoolean(params.clear) ?? false,
        optionalBoolean(params.submit) ?? false,
        optionalString(params.targetId)
      );
    case "interact.select":
      await authorizeSessionCommand(core, params, request.name, bindingId);
      return core.manager.select(
        requireString(params.sessionId, "sessionId"),
        requireString(params.ref, "ref"),
        requireStringArray(params.values, "values"),
        optionalString(params.targetId)
      );
    case "interact.upload":
      await authorizeSessionCommand(core, params, request.name, bindingId);
      return core.manager.upload(
        requireString(params.sessionId, "sessionId"),
        {
          ref: requireString(params.ref, "ref"),
          files: requireStringArray(params.files, "files"),
          ...(typeof params.targetId === "string" ? { targetId: params.targetId } : {})
        }
      );
    case "interact.scroll":
      await authorizeSessionCommand(core, params, request.name, bindingId);
      return core.manager.scroll(
        requireString(params.sessionId, "sessionId"),
        optionalNumber(params.dy, "dy") ?? 0,
        optionalString(params.ref),
        optionalString(params.targetId)
      );
    case "interact.scrollIntoView":
      await authorizeSessionCommand(core, params, request.name, bindingId);
      return core.manager.scrollIntoView(
        requireString(params.sessionId, "sessionId"),
        requireString(params.ref, "ref"),
        optionalString(params.targetId)
      );
    case "pointer.move":
      await authorizeSessionCommand(core, params, request.name, bindingId);
      return core.manager.pointerMove(
        requireString(params.sessionId, "sessionId"),
        requireFiniteNumber(params.x, "x"),
        requireFiniteNumber(params.y, "y"),
        optionalString(params.targetId),
        optionalNumber(params.steps, "steps")
      );
    case "pointer.down":
      await authorizeSessionCommand(core, params, request.name, bindingId);
      return core.manager.pointerDown(
        requireString(params.sessionId, "sessionId"),
        requireFiniteNumber(params.x, "x"),
        requireFiniteNumber(params.y, "y"),
        optionalString(params.targetId),
        optionalPointerButton(params.button),
        optionalNumber(params.clickCount, "clickCount") ?? 1
      );
    case "pointer.up":
      await authorizeSessionCommand(core, params, request.name, bindingId);
      return core.manager.pointerUp(
        requireString(params.sessionId, "sessionId"),
        requireFiniteNumber(params.x, "x"),
        requireFiniteNumber(params.y, "y"),
        optionalString(params.targetId),
        optionalPointerButton(params.button),
        optionalNumber(params.clickCount, "clickCount") ?? 1
      );
    case "pointer.drag":
      await authorizeSessionCommand(core, params, request.name, bindingId);
      return core.manager.drag(
        requireString(params.sessionId, "sessionId"),
        requirePointerPoint(params.from, "from"),
        requirePointerPoint(params.to, "to"),
        optionalString(params.targetId),
        optionalNumber(params.steps, "steps")
      );
    case "dom.getHtml":
      await authorizeSessionCommand(core, params, request.name, bindingId);
      return core.manager.domGetHtml(
        requireString(params.sessionId, "sessionId"),
        requireString(params.ref, "ref"),
        optionalNumber(params.maxChars, "maxChars") ?? 8000,
        optionalString(params.targetId)
      );
    case "dom.getText":
      await authorizeSessionCommand(core, params, request.name, bindingId);
      return core.manager.domGetText(
        requireString(params.sessionId, "sessionId"),
        requireString(params.ref, "ref"),
        optionalNumber(params.maxChars, "maxChars") ?? 8000,
        optionalString(params.targetId)
      );
    case "dom.getAttr":
      await authorizeSessionCommand(core, params, request.name, bindingId);
      return core.manager.domGetAttr(
        requireString(params.sessionId, "sessionId"),
        requireString(params.ref, "ref"),
        requireString(params.name, "name"),
        optionalString(params.targetId)
      );
    case "dom.getValue":
      await authorizeSessionCommand(core, params, request.name, bindingId);
      return core.manager.domGetValue(
        requireString(params.sessionId, "sessionId"),
        requireString(params.ref, "ref"),
        optionalString(params.targetId)
      );
    case "dom.isVisible":
      await authorizeSessionCommand(core, params, request.name, bindingId);
      return core.manager.domIsVisible(
        requireString(params.sessionId, "sessionId"),
        requireString(params.ref, "ref"),
        optionalString(params.targetId)
      );
    case "dom.isEnabled":
      await authorizeSessionCommand(core, params, request.name, bindingId);
      return core.manager.domIsEnabled(
        requireString(params.sessionId, "sessionId"),
        requireString(params.ref, "ref"),
        optionalString(params.targetId)
      );
    case "dom.isChecked":
      await authorizeSessionCommand(core, params, request.name, bindingId);
      return core.manager.domIsChecked(
        requireString(params.sessionId, "sessionId"),
        requireString(params.ref, "ref"),
        optionalString(params.targetId)
      );
    case "export.clonePage":
      await authorizeSessionCommand(core, params, request.name, bindingId);
      return core.manager.clonePage(
        requireString(params.sessionId, "sessionId"),
        optionalString(params.targetId)
      );
    case "export.clonePageHtml":
      await authorizeSessionCommand(core, params, request.name, bindingId);
      if (typeof core.manager.clonePageHtmlWithOptions !== "function") {
        throw new Error("clonePageHtmlWithOptions unavailable in this execution lane.");
      }
      {
        const maxNodes = optionalPositiveInteger(params.maxNodes, "maxNodes");
      return core.manager.clonePageHtmlWithOptions(
        requireString(params.sessionId, "sessionId"),
        optionalString(params.targetId),
        {
            ...(typeof maxNodes === "number" ? { maxNodes } : {}),
          ...(typeof params.inlineStyles === "boolean" ? { inlineStyles: params.inlineStyles } : {})
        }
      );
      }
    case "export.cloneComponent":
      await authorizeSessionCommand(core, params, request.name, bindingId);
      return core.manager.cloneComponent(
        requireString(params.sessionId, "sessionId"),
        requireString(params.ref, "ref"),
        optionalString(params.targetId)
      );
    case "devtools.perf":
      await authorizeSessionCommand(core, params, request.name, bindingId);
      return core.manager.perfMetrics(
        requireString(params.sessionId, "sessionId"),
        optionalString(params.targetId)
      );
    case "page.screenshot":
      await authorizeSessionCommand(core, params, request.name, bindingId);
      return core.manager.screenshot(
        requireString(params.sessionId, "sessionId"),
        {
          ...(typeof params.path === "string" ? { path: params.path } : {}),
          ...(typeof params.targetId === "string" ? { targetId: params.targetId } : {}),
          ...(typeof params.ref === "string" ? { ref: params.ref } : {}),
          ...(params.fullPage === true ? { fullPage: true } : {})
        }
      );
    case "page.screencast.start":
      await authorizeSessionCommand(core, params, request.name, bindingId);
      const screencastOwnerClientId = requireClientId(params);
      const screencast = await core.manager.startScreencast(
        requireString(params.sessionId, "sessionId"),
        {
          targetId: optionalString(params.targetId),
          outputDir: optionalString(params.outputDir),
          intervalMs: optionalNumber(params.intervalMs, "intervalMs") ?? undefined,
          maxFrames: optionalNumber(params.maxFrames, "maxFrames") ?? undefined
        }
      );
      registerScreencastOwner(screencast.sessionId, screencast.screencastId, screencastOwnerClientId);
      core.manager.monitorScreencastCompletion?.(screencast.screencastId, () => {
        completeScreencastOwner(screencast.screencastId);
      });
      return screencast;
    case "page.screencast.stop":
      await authorizeSessionCommand(core, params, request.name, bindingId);
      const screencastResult = await core.manager.stopScreencast(
        requireString(params.sessionId, "sessionId"),
        requireString(params.screencastId, "screencastId")
      );
      completeScreencastOwner(screencastResult.screencastId);
      return screencastResult;
    case "page.dialog":
      await authorizeSessionCommand(core, params, request.name, bindingId);
      return core.manager.dialog(
        requireString(params.sessionId, "sessionId"),
        {
          ...(typeof params.targetId === "string" ? { targetId: params.targetId } : {}),
          ...(typeof params.action === "string" ? { action: requireDialogAction(params.action) } : {}),
          ...(typeof params.promptText === "string" ? { promptText: params.promptText } : {})
        }
      );
    case "devtools.consolePoll":
      await authorizeSessionCommand(core, params, request.name, bindingId);
      return core.manager.consolePoll(
        requireString(params.sessionId, "sessionId"),
        optionalNumber(params.sinceSeq, "sinceSeq"),
        optionalNumber(params.max, "max") ?? 50
      );
    case "devtools.networkPoll":
      await authorizeSessionCommand(core, params, request.name, bindingId);
      return core.manager.networkPoll(
        requireString(params.sessionId, "sessionId"),
        optionalNumber(params.sinceSeq, "sinceSeq"),
        optionalNumber(params.max, "max") ?? 50
      );
    case "devtools.debugTraceSnapshot": {
      await authorizeSessionCommand(core, params, request.name, bindingId);
      const sessionId = requireString(params.sessionId, "sessionId");
      const manager = core.manager as OpenDevBrowserCore["manager"] & {
        debugTraceSnapshot?: (
          sessionId: string,
          options?: {
            sinceConsoleSeq?: number;
            sinceNetworkSeq?: number;
            sinceExceptionSeq?: number;
            max?: number;
            requestId?: string;
          }
        ) => Promise<unknown>;
        exceptionPoll?: (
          sessionId: string,
          sinceSeq?: number,
          max?: number
        ) => Promise<{ events: unknown[]; nextSeq: number }>;
      };

      const max = optionalNumber(params.max, "max") ?? 50;
      const requestId = optionalString(params.requestId);
      const sinceConsoleSeq = optionalNumber(params.sinceConsoleSeq, "sinceConsoleSeq");
      const sinceNetworkSeq = optionalNumber(params.sinceNetworkSeq, "sinceNetworkSeq");
      const sinceExceptionSeq = optionalNumber(params.sinceExceptionSeq, "sinceExceptionSeq");

      if (typeof manager.debugTraceSnapshot === "function") {
        return manager.debugTraceSnapshot(sessionId, {
          sinceConsoleSeq,
          sinceNetworkSeq,
          sinceExceptionSeq,
          max,
          requestId
        });
      }

      const [page, consoleChannel, networkChannel] = await Promise.all([
        core.manager.status(sessionId),
        core.manager.consolePoll(sessionId, sinceConsoleSeq, max),
        core.manager.networkPoll(sessionId, sinceNetworkSeq, max)
      ]);
      const exceptionChannel = typeof manager.exceptionPoll === "function"
        ? await manager.exceptionPoll(sessionId, sinceExceptionSeq, max)
        : { events: [], nextSeq: sinceExceptionSeq ?? 0 };

      const fallbackResult = {
        requestId: requestId ?? randomUUID(),
        generatedAt: new Date().toISOString(),
        page,
        channels: {
          console: consoleChannel,
          network: networkChannel,
          exception: exceptionChannel
        }
      };
      return attachBlockerMetaForTrace(core, fallbackResult);
    }
    case "session.cookieImport": {
      await authorizeSessionCommand(core, params, request.name, bindingId);
      const sessionId = requireString(params.sessionId, "sessionId");
      const manager = core.manager as OpenDevBrowserCore["manager"] & {
        cookieImport?: (
          sessionId: string,
          cookies: CookieImportRecord[],
          strict?: boolean,
          requestId?: string
        ) => Promise<{ requestId: string; imported: number; rejected: Array<{ index: number; reason: string }> }>;
      };

      const cookies = requireCookieArray(params.cookies, "cookies");
      const strict = optionalBoolean(params.strict) ?? true;
      const requestId = optionalString(params.requestId) ?? randomUUID();

      if (typeof manager.cookieImport === "function") {
        return manager.cookieImport(sessionId, cookies, strict, requestId);
      }

      const normalized: CookieImportRecord[] = [];
      const rejected: Array<{ index: number; reason: string }> = [];
      cookies.forEach((cookie, index) => {
        const validation = validateCookieRecord(cookie);
        if (!validation.valid) {
          rejected.push({ index, reason: validation.reason });
          return;
        }
        normalized.push(validation.cookie);
      });

      if (strict && rejected.length > 0) {
        throw new Error(`Cookie import rejected ${rejected.length} entries.`);
      }

      if (normalized.length > 0) {
        const targetId = optionalString(params.targetId);
        await core.manager.withPage(sessionId, targetId ?? null, async (page) => {
          await page.context().addCookies(normalized);
          return undefined;
        });
      }

      return {
        requestId,
        imported: normalized.length,
        rejected
      };
    }
    case "session.cookieList": {
      await authorizeSessionCommand(core, params, request.name, bindingId);
      const sessionId = requireString(params.sessionId, "sessionId");
      const manager = core.manager as OpenDevBrowserCore["manager"] & {
        cookieList?: (
          sessionId: string,
          urls?: string[],
          requestId?: string
        ) => Promise<{ requestId: string; cookies: CookieListRecord[]; count: number }>;
      };

      const urls = requireOptionalCookieUrlArray(params.urls, "urls");
      const requestId = optionalString(params.requestId) ?? randomUUID();

      if (typeof manager.cookieList === "function") {
        return manager.cookieList(sessionId, urls, requestId);
      }

      const targetId = optionalString(params.targetId);
      const cookies = await core.manager.withPage(
        sessionId,
        targetId ?? null,
        async (page) => {
          const listed = urls ? await page.context().cookies(urls) : await page.context().cookies();
          return listed.map((cookie) => ({
            name: cookie.name,
            value: cookie.value,
            domain: cookie.domain,
            path: cookie.path,
            expires: cookie.expires,
            httpOnly: cookie.httpOnly,
            secure: cookie.secure,
            ...(cookie.sameSite ? { sameSite: cookie.sameSite as "Strict" | "Lax" | "None" } : {})
          }));
        }
      );

      return {
        requestId,
        cookies,
        count: cookies.length
      };
    }
    case "macro.resolve":
      return resolveMacroExpression(
        {
          expression: requireString(params.expression, "expression"),
          defaultProvider: optionalString(params.defaultProvider),
          includeCatalog: optionalBoolean(params.includeCatalog) ?? false,
          execute: optionalBoolean(params.execute) ?? false,
          timeoutMs: optionalNumber(params.timeoutMs, "timeoutMs"),
          challengeAutomationMode: optionalChallengeAutomationMode(params.challengeAutomationMode)
        },
        core.config,
        core.manager,
        core.browserFallbackPort,
        core.providerRuntime
      );
    case "research.run":
      return runResearchWorkflow(
        createDaemonWorkflowRuntime(core),
        {
          topic: requireString(params.topic, "topic"),
          days: optionalNumber(params.days, "days"),
          from: optionalString(params.from),
          to: optionalString(params.to),
          sourceSelection: optionalProviderSelection(params.sourceSelection),
          sources: optionalProviderSources(params.sources),
          mode: optionalRenderMode(params.mode) ?? "compact",
          includeEngagement: optionalBoolean(params.includeEngagement),
          limitPerSource: optionalNumber(params.limitPerSource, "limitPerSource"),
          timeoutMs: optionalNumber(params.timeoutMs, "timeoutMs"),
          outputDir: optionalString(params.outputDir),
          ttlHours: optionalNumber(params.ttlHours, "ttlHours"),
          useCookies: optionalBoolean(params.useCookies),
          challengeAutomationMode: optionalChallengeAutomationMode(params.challengeAutomationMode),
          cookiePolicyOverride: optionalCookiePolicy(params.cookiePolicyOverride)
        }
      );
    case "shopping.run":
      return runShoppingWorkflow(
        createDaemonWorkflowRuntime(core),
        {
          query: requireString(params.query, "query"),
          providers: optionalStringArray(params.providers),
          budget: optionalNumber(params.budget, "budget"),
          region: optionalString(params.region),
          browserMode: optionalWorkflowBrowserMode(params.browserMode),
          sort: optionalShoppingSort(params.sort),
          mode: optionalRenderMode(params.mode) ?? "compact",
          timeoutMs: optionalNumber(params.timeoutMs, "timeoutMs"),
          outputDir: optionalString(params.outputDir),
          ttlHours: optionalNumber(params.ttlHours, "ttlHours"),
          useCookies: optionalBoolean(params.useCookies),
          challengeAutomationMode: optionalChallengeAutomationMode(params.challengeAutomationMode),
          cookiePolicyOverride: optionalCookiePolicy(params.cookiePolicyOverride)
        }
      );
    case "inspiredesign.run": {
      const inspiredesignTimeoutMs = optionalNumber(params.timeoutMs, "timeoutMs");
      return runInspiredesignWorkflow(
        createDaemonWorkflowRuntime(core),
        {
          brief: requireString(params.brief, "brief"),
          urls: optionalStringArray(params.urls),
          captureMode: optionalInspiredesignCaptureMode(params.captureMode),
          includePrototypeGuidance: optionalBoolean(params.includePrototypeGuidance),
          mode: optionalRenderMode(params.mode) ?? "compact",
          timeoutMs: inspiredesignTimeoutMs,
          outputDir: optionalString(params.outputDir),
          ttlHours: optionalNumber(params.ttlHours, "ttlHours"),
          useCookies: optionalBoolean(params.useCookies),
          challengeAutomationMode: optionalChallengeAutomationMode(params.challengeAutomationMode),
          cookiePolicyOverride: optionalCookiePolicy(params.cookiePolicyOverride)
        },
        {
          captureReference: async (url, options) =>
            captureInspiredesignReferenceFromManager(core.manager, url, {
              ...options,
              cookieSource: core.config.providers?.cookieSource
            })
        }
      );
    }
    case "product.video.run": {
      const productVideoTimeoutMs = optionalNumber(params.timeoutMs, "timeoutMs");
      return runProductVideoWorkflow(
        createDaemonWorkflowRuntime(core),
        {
          product_url: optionalString(params.product_url),
          product_name: optionalString(params.product_name),
          provider_hint: optionalString(params.provider_hint),
          include_screenshots: optionalBoolean(params.include_screenshots),
          include_all_images: optionalBoolean(params.include_all_images),
          include_copy: optionalBoolean(params.include_copy),
          output_dir: optionalString(params.output_dir),
          ttl_hours: optionalNumber(params.ttl_hours, "ttl_hours"),
          timeoutMs: productVideoTimeoutMs,
          useCookies: optionalBoolean(params.useCookies),
          challengeAutomationMode: optionalChallengeAutomationMode(params.challengeAutomationMode),
          cookiePolicyOverride: optionalCookiePolicy(params.cookiePolicyOverride)
        },
        {
          captureScreenshot: async (url: string, timeoutMs?: number) => {
            const captureTimeoutMs = Math.max(1, Math.min(timeoutMs ?? 30000, 30000));
            const session = await core.manager.launch({
              headless: true,
              startUrl: "about:blank",
              // Capture sessions are ephemeral; avoid persisted profile lock contention.
              persistProfile: false
            });
            try {
              await core.manager.goto(session.sessionId, url, "load", captureTimeoutMs);
              const screenshot = await Promise.race([
                core.manager.screenshot(session.sessionId),
                new Promise<null>((resolve) => {
                  setTimeout(() => resolve(null), captureTimeoutMs);
                })
              ]);
              if (!screenshot || typeof screenshot.base64 !== "string" || screenshot.base64.length === 0) return null;
              return Buffer.from(screenshot.base64, "base64");
            } catch {
              return null;
            } finally {
              await core.manager.disconnect(session.sessionId, true).catch(() => {
                // Best effort cleanup.
              });
            }
          }
        }
      );
    }
      default:
        throw new Error(`Unknown daemon command: ${request.name}`);
      }
    })();
  } catch (error) {
    throw coerceDaemonSessionError(params, error);
  }
}

async function launchWithRelay(
  core: OpenDevBrowserCore,
  params: Record<string, unknown>,
  clientId: string,
  bindingId?: string
) {
  let relayStatus = core.relay.status();
  const extensionLegacy = optionalBoolean(params.extensionLegacy) ?? false;
  let relayUrl = extensionLegacy ? core.relay.getCdpUrl() : core.relay.getOpsUrl?.() ?? null;
  const relayPort = core.config.relayPort;
  const noExtension = optionalBoolean(params.noExtension) ?? false;
  const extensionOnly = optionalBoolean(params.extensionOnly) ?? false;
  const waitForExtension = optionalBoolean(params.waitForExtension) ?? false;
  const headlessExplicit = optionalBoolean(params.headless) === true;
  if (headlessExplicit && !noExtension) {
    throw unsupportedModeError(
      "Extension mode does not support headless launches. Use --no-extension --headless for managed mode."
    );
  }
  const managedExplicit = Boolean(noExtension || headlessExplicit);
  const managedHeadless = headlessExplicit ? true : false;
  const waitTimeoutMs = clampWaitTimeout(optionalNumber(params.waitTimeoutMs, "waitTimeoutMs") ?? 30000);

  if (!managedExplicit && extensionLegacy) {
    requireBinding(clientId, bindingId);
  }

  if (waitForExtension && !managedExplicit) {
    const observedPort = resolveObservedPort(relayStatus, relayPort);
    const connected = await waitForRelayHandshake(core.relay, observedPort, waitTimeoutMs);
    if (connected) {
      relayStatus = core.relay.status();
      relayUrl = extensionLegacy ? core.relay.getCdpUrl() ?? relayUrl : core.relay.getOpsUrl?.() ?? relayUrl;
    }
  }

  const observedPort = resolveObservedPort(relayStatus, relayPort);
  const shouldFetchObserved = !managedExplicit && (!relayUrl || !relayStatus.extensionHandshakeComplete);
  const observedStatus = shouldFetchObserved ? await fetchRelayObservedStatus(observedPort) : null;
  const matchingObservedStatus = getMatchingObservedRelayStatus(relayStatus, observedStatus);
  if (!relayUrl) {
    const fallbackPort = isValidPort(observedStatus?.port) ? observedStatus?.port : observedPort;
    relayUrl = fallbackPort ? buildLoopbackSessionRelayEndpoint(fallbackPort, { extensionLegacy }) : null;
  }
  const extensionReady = Boolean(
    relayUrl && (
      relayStatus.extensionHandshakeComplete ||
      matchingObservedStatus?.extensionHandshakeComplete
    )
  );
  const extensionSocketConnected = Boolean(
    relayStatus.extensionConnected || matchingObservedStatus?.extensionConnected
  );
  const observedInstanceMismatch = Boolean(
    observedStatus
    && observedStatus.instanceId !== relayStatus.instanceId
    && (observedStatus.extensionConnected || observedStatus.extensionHandshakeComplete)
  );
  const handshakePending = Boolean(relayUrl && extensionSocketConnected && !extensionReady);
  const diagnostics = observedStatus
    ? `Diagnostics: relayPort=${observedPort ?? "?"} instance=${observedStatus.instanceId.slice(0, 8)} ext=${observedStatus.extensionConnected} handshake=${observedStatus.extensionHandshakeComplete} ops=${observedStatus.opsConnected} cdp=${observedStatus.cdpConnected}`
    : null;
  const missingReason = observedInstanceMismatch
    ? diagnostics
      ? `Extension not connected to the expected relay instance. ${diagnostics}`
      : "Extension not connected to the expected relay instance."
    : handshakePending
    ? diagnostics
      ? `Extension websocket connected but handshake incomplete. Re-establish a clean daemon-extension handshake. ${diagnostics}`
      : "Extension websocket connected but handshake incomplete. Re-establish a clean daemon-extension handshake."
    : diagnostics
      ? `Extension not connected. ${diagnostics}`
      : "Extension not connected.";

  if (extensionOnly && !extensionReady) {
    throw new Error(buildExtensionMissingMessage(missingReason));
  }

  if (!managedExplicit) {
    if (!extensionReady || !relayUrl) {
      throw new Error(buildExtensionMissingMessage(missingReason));
    }
    try {
      const startUrl = optionalString(params.startUrl);
      const result = startUrl
        ? await core.manager.connectRelay(relayUrl, { startUrl })
        : await core.manager.connectRelay(relayUrl);
      const leaseId = extractLeaseId(result);
      if (result.mode === "extension" && !extensionLegacy && !leaseId) {
        throw new Error("[invalid_session] Extension relay session missing leaseId.");
      }
      if (result.mode === "extension" && leaseId) {
        registerSessionLease(result.sessionId, leaseId, clientId);
      }
      return { ...result, warnings: result.warnings ?? [], ...(leaseId ? { leaseId } : {}) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const unauthorized = message.toLowerCase().includes("unauthorized") || message.includes("401");
      const relayLabel = extensionLegacy ? "/cdp" : "/ops";
      const reason = unauthorized
        ? `Extension relay connection failed: relay ${relayLabel} unauthorized (token mismatch).`
        : `Extension relay connection failed: ${message}`;
      throw new Error(buildExtensionMissingMessage(reason));
    }
  }

  try {
    const result = await core.manager.launch({
      profile: optionalString(params.profile),
      headless: managedHeadless,
      startUrl: optionalString(params.startUrl),
      chromePath: optionalString(params.chromePath),
      flags: optionalStringArray(params.flags),
      persistProfile: optionalBoolean(params.persistProfile)
    });
    return { ...result, warnings: result.warnings ?? [] };
  } catch (error) {
    throw new Error(buildManagedFailureMessage(error));
  }
}

async function connectWithRelayRouting(
  core: OpenDevBrowserCore,
  params: Record<string, unknown>,
  clientId: string,
  bindingId?: string
) {
  const wsEndpoint = optionalString(params.wsEndpoint);
  const extensionLegacy = optionalBoolean(params.extensionLegacy) ?? false;
  const relayUrl = extensionLegacy ? core.relay.getCdpUrl() : core.relay.getOpsUrl?.() ?? null;
  const parsedRelayEndpoint = classifySessionRelayEndpoint(wsEndpoint);
  const resolvedRelayEndpoint = parsedRelayEndpoint
    ? resolveSessionRelayRoute(parsedRelayEndpoint, { extensionLegacy })
    : null;
  if (resolvedRelayEndpoint && "code" in resolvedRelayEndpoint) {
    throw new Error("Legacy extension relay (/cdp) requires --extension-legacy.");
  }
  const relayEndpoint = relayUrl && wsEndpoint === relayUrl
    ? relayUrl
    : resolvedRelayEndpoint?.normalizedEndpoint ?? null;

  const hasExplicitCdp = Boolean(wsEndpoint || params.host || params.port);
  const headlessExplicit = optionalBoolean(params.headless) === true;

  if (headlessExplicit && !hasExplicitCdp) {
    throw unsupportedModeError(
      "Extension mode does not support headless connect routing. Use launch --no-extension --headless or connect to an explicit CDP endpoint."
    );
  }

  if (relayEndpoint || (!hasExplicitCdp && relayUrl)) {
    if (headlessExplicit) {
      throw unsupportedModeError(
        "Extension mode does not support headless connect routing. Use launch --no-extension --headless or connect to an explicit CDP endpoint."
      );
    }
    if (extensionLegacy) {
      requireBinding(clientId, bindingId);
    }
    const startUrl = optionalString(params.startUrl);
    const result = startUrl
      ? await core.manager.connectRelay(relayEndpoint ?? relayUrl ?? "", { startUrl })
      : await core.manager.connectRelay(relayEndpoint ?? relayUrl ?? "");
    const leaseId = extractLeaseId(result);
    if (result.mode === "extension" && !extensionLegacy && !leaseId) {
      throw new Error("[invalid_session] Extension relay session missing leaseId.");
    }
    if (result.mode === "extension" && leaseId) {
      registerSessionLease(result.sessionId, leaseId, clientId);
    }
    return { ...result, ...(leaseId ? { leaseId } : {}) };
  }

  if (!hasExplicitCdp) {
    throw new Error("Extension relay not available. Connect the extension or pass --cdp-port/--ws-endpoint.");
  }

  return core.manager.connect({
    wsEndpoint,
    host: optionalString(params.host),
    port: optionalNumber(params.port, "port"),
    startUrl: optionalString(params.startUrl)
  });
}

async function disconnectSession(
  core: OpenDevBrowserCore,
  params: Record<string, unknown>,
  clientId: string,
  bindingId?: string
): Promise<{ ok: true; bindingReleased?: boolean }> {
  const sessionId = requireString(params.sessionId, "sessionId");
  let status: Awaited<ReturnType<OpenDevBrowserCore["manager"]["status"]>> | null = null;
  try {
    status = await core.manager.status(sessionId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? "");
    if (isIgnorableDisconnectStatusError(message)) {
      const lease = getSessionLease(sessionId);
      if (lease) {
        requireSessionLease(sessionId, clientId, optionalString(params.leaseId));
      } else if (bindingId) {
        requireBinding(clientId, bindingId);
      }
      releaseSessionLease(sessionId);
      if (bindingId) {
        releaseRelay(clientId, bindingId);
        return { ok: true, bindingReleased: true };
      }
      return { ok: true };
    }
    throw error;
  }
  if (status.mode === "extension") {
    const lease = getSessionLease(sessionId);
    if (lease) {
      requireSessionLease(sessionId, clientId, optionalString(params.leaseId));
    } else {
      requireBinding(clientId, bindingId);
    }
  }
  await core.manager.disconnect(sessionId, optionalBoolean(params.closeBrowser) ?? false);
  releaseSessionLease(sessionId);
  if (status.mode === "extension" && bindingId) {
    releaseRelay(clientId, bindingId);
    return { ok: true, bindingReleased: true };
  }
  return { ok: true };
}

function requireSessionInspectorHandle(core: OpenDevBrowserCore) {
  const inspector = core.manager.createSessionInspector?.();
  if (!inspector) {
    throw new Error("Session inspector is unavailable for the current runtime.");
  }
  return inspector;
}

function readChallengeAutomationMode(
  params: Record<string, unknown>
): ChallengeAutomationMode | undefined {
  return optionalChallengeAutomationMode(params.challengeAutomationMode);
}

async function runReviewDesktop(
  core: OpenDevBrowserCore,
  params: Record<string, unknown>
) {
  return core.automationCoordinator.reviewDesktop({
    browserSessionId: requireString(params.sessionId, "sessionId"),
    targetId: optionalString(params.targetId),
    reason: optionalString(params.reason),
    maxChars: optionalNumber(params.maxChars, "maxChars"),
    cursor: optionalString(params.cursor)
  });
}

async function runInspectChallengePlan(
  core: OpenDevBrowserCore,
  params: Record<string, unknown>
) {
  return core.automationCoordinator.inspectChallengePlan({
    browserSessionId: requireString(params.sessionId, "sessionId"),
    targetId: optionalString(params.targetId),
    runMode: readChallengeAutomationMode(params)
  });
}

async function runInspectAudit(
  core: OpenDevBrowserCore,
  params: Record<string, unknown>
) {
  const browserSessionId = requireString(params.sessionId, "sessionId");
  const targetId = optionalString(params.targetId);
  const review = await runReviewDesktop(core, params);
  const challengePlan = await core.automationCoordinator.inspectChallengePlan({
    browserSessionId,
    targetId,
    runMode: readChallengeAutomationMode(params)
  });
  return buildCorrelatedAuditBundle({
    handle: requireSessionInspectorHandle(core),
    browserSessionId,
    targetId,
    observation: review.observation,
    review: review.verification,
    challengePlan,
    includeUrls: optionalBoolean(params.includeUrls) ?? undefined,
    sinceConsoleSeq: optionalNumber(params.sinceConsoleSeq, "sinceConsoleSeq"),
    sinceNetworkSeq: optionalNumber(params.sinceNetworkSeq, "sinceNetworkSeq"),
    sinceExceptionSeq: optionalNumber(params.sinceExceptionSeq, "sinceExceptionSeq"),
    max: optionalNumber(params.max, "max"),
    requestId: optionalString(params.requestId),
    relayStatus: core.relay.status()
  });
}

async function runStatusCapabilities(
  core: OpenDevBrowserCore,
  params: Record<string, unknown>
) {
  return core.automationCoordinator.statusCapabilities({
    browserSessionId: optionalString(params.sessionId),
    targetId: optionalString(params.targetId),
    runMode: readChallengeAutomationMode(params)
  });
}

async function authorizeSessionCommand(
  core: OpenDevBrowserCore,
  params: Record<string, unknown>,
  commandName: string,
  bindingId?: string
): Promise<void> {
  const sessionId = optionalString(params.sessionId);
  if (!sessionId) return;
  const clientId = requireClientId(params);
  const lease = getSessionLease(sessionId);
  if (lease) {
    requireSessionLease(sessionId, clientId, optionalString(params.leaseId));
    return;
  }
  let status: Awaited<ReturnType<OpenDevBrowserCore["manager"]["status"]>>;
  try {
    status = await core.manager.status(sessionId);
  } catch (error) {
    if (canStopCompletedScreencastWithoutLiveSession(commandName, error)) {
      requireScreencastOwner(
        sessionId,
        requireString(params.screencastId, "screencastId"),
        clientId
      );
      return;
    }
    throw error;
  }
  if (status.mode !== "extension") {
    return;
  }
  requireBinding(clientId, bindingId);
}

function extractLeaseId(result: unknown): string | undefined {
  if (!result || typeof result !== "object") return undefined;
  const leaseId = (result as Record<string, unknown>).leaseId;
  return typeof leaseId === "string" ? leaseId : undefined;
}

function buildExtensionMissingMessage(reason: string): string {
  return [
    reason,
    "Connect the extension: open the Chrome extension popup and click Connect. If ext=on but handshake=off, click Connect again to re-establish a clean daemon-extension handshake, then retry.",
    "Tip: If the popup says Connected, it may be connected to a different relay instance/port than the daemon expects.",
    "Legend: ext=extension websocket, handshake=extension handshake, ops=active /ops client, cdp=active /cdp client, pairing=token required.",
    "",
    "Other options (explicit):",
    "- Managed (headed): npx opendevbrowser launch --no-extension",
    "- Managed (headless): npx opendevbrowser launch --no-extension --headless",
    "- Legacy extension relay: npx opendevbrowser launch --extension-legacy",
    "- CDPConnect (default port): npx opendevbrowser connect --cdp-port 9222",
    "- CDPConnect (explicit WS): npx opendevbrowser connect --ws-endpoint ws://127.0.0.1:9222/devtools/browser/<id>",
    "Note: CDPConnect requires Chrome started with --remote-debugging-port=9222."
  ].join("\n");
}

function buildManagedFailureMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  const normalized = detail.toLowerCase();
  const profileLocked = normalized.includes("singletonlock")
    || normalized.includes("processsingleton")
    || normalized.includes("profile in use")
    || normalized.includes("already in use")
    || normalized.includes("user data directory is already in use")
    || normalized.includes("profile is locked");

  if (profileLocked) {
    return [
      `Managed session failed: ${detail}`,
      "",
      "Detected persisted profile lock (another Chrome process is using the same profile).",
      "Retry options (explicit):",
      "- Managed with a unique profile: npx opendevbrowser launch --no-extension --profile lock-safe-<timestamp>",
      "- Managed with a temporary profile: npx opendevbrowser launch --no-extension --persist-profile false",
      "- CDPConnect (default port): npx opendevbrowser connect --cdp-port 9222",
      "- CDPConnect (explicit WS): npx opendevbrowser connect --ws-endpoint ws://127.0.0.1:9222/devtools/browser/<id>"
    ].join("\n");
  }

  return [
    `Managed session failed: ${detail}`,
    "",
    "Final option (explicit):",
    "- CDPConnect (default port): npx opendevbrowser connect --cdp-port 9222",
    "- CDPConnect (explicit WS): npx opendevbrowser connect --ws-endpoint ws://127.0.0.1:9222/devtools/browser/<id>"
  ].join("\n");
}

function unsupportedModeError(message: string): Error {
  return new Error(`[unsupported_mode] ${message}`);
}

function coerceDaemonSessionError(params: Record<string, unknown>, error: unknown): Error {
  const sessionId = optionalString(params.sessionId);
  const clientId = optionalString(params.clientId);
  const baseError = error instanceof Error ? error : new Error(String(error ?? ""));
  if (!sessionId || !clientId) {
    return baseError;
  }
  if (!isStaleExtensionSessionError(baseError.message)) {
    return baseError;
  }
  const released = releaseOwnedSessionLease(sessionId, clientId, optionalString(params.leaseId));
  if (!released) {
    return baseError;
  }
  return new Error([
    `[relaunch_required] Extension session ${sessionId} is no longer valid.`,
    "Relaunch the extension-backed session and retry the command.",
    `Previous error: ${baseError.message}`
  ].join(" "));
}

function isIgnorableDisconnectStatusError(message: string): boolean {
  return message.includes("[invalid_session]")
    || message.includes("Unknown ops session")
    || message.includes("Ops client not connected");
}

function canStopCompletedScreencastWithoutLiveSession(commandName: string, error: unknown): boolean {
  if (commandName !== "page.screencast.stop") {
    return false;
  }
  const message = error instanceof Error ? error.message : String(error ?? "");
  return isIgnorableDisconnectStatusError(message);
}

function isStaleExtensionSessionError(message: string): boolean {
  return message.includes("[invalid_session]")
    || message.includes("Unknown sessionId:")
    || message.includes("Unknown ops session")
    || message.includes("[not_owner]")
    || message.includes("Client does not own session")
    || message.includes("Lease does not match session owner");
}

async function attachBlockerMetaForNavigation(
  core: OpenDevBrowserCore,
  sessionId: string,
  result: unknown
): Promise<unknown> {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return result;
  }

  const record = result as Record<string, unknown>;
  const existingMeta = (!Array.isArray(record.meta) && typeof record.meta === "object" && record.meta !== null)
    ? record.meta as Record<string, unknown>
    : undefined;
  if (existingMeta && typeof existingMeta.blockerState === "string") {
    return result;
  }

  const fallbackStatus = await core.manager.status(sessionId);
  let networkEvents: { events: Array<{ url?: string; status?: number }> } = { events: [] };
  try {
    const polled = await core.manager.networkPoll(
      sessionId,
      undefined,
      core.config.blockerArtifactCaps.maxNetworkEvents
    );
    if (polled && Array.isArray(polled.events)) {
      networkEvents = { events: polled.events as Array<{ url?: string; status?: number }> };
    }
  } catch {
    // Ignore polling failures for fallback blocker enrichment.
  }

  const blocker = classifyBlockerSignal({
    source: "navigation",
    url: typeof record.url === "string" ? record.url : fallbackStatus.url,
    finalUrl: typeof record.finalUrl === "string" ? record.finalUrl : fallbackStatus.url,
    title: fallbackStatus.title,
    status: typeof record.status === "number" ? record.status : findLatestStatus(networkEvents.events),
    networkHosts: extractHosts(networkEvents.events),
    threshold: core.config.blockerDetectionThreshold,
    promptGuardEnabled: core.config.security.promptInjectionGuard?.enabled ?? true
  });

  return {
    ...record,
    meta: {
      ...(existingMeta ?? {}),
      blockerState: blocker ? "active" : "clear",
      ...(blocker ? { blocker } : {})
    }
  };
}

function attachBlockerMetaForTrace(
  core: OpenDevBrowserCore,
  result: {
    requestId: string;
    generatedAt: string;
    page: { url?: string; title?: string };
    channels: {
      network: { events: Array<{ url?: string; status?: number }> };
      console: { events: unknown[] };
      exception: { events: unknown[] };
    };
  }
): unknown {
  const blocker = classifyBlockerSignal({
    source: "network",
    url: result.page.url,
    finalUrl: result.page.url,
    title: result.page.title,
    status: findLatestStatus(result.channels.network.events),
    networkHosts: extractHosts(result.channels.network.events),
    traceRequestId: result.requestId,
    threshold: core.config.blockerDetectionThreshold,
    promptGuardEnabled: core.config.security.promptInjectionGuard?.enabled ?? true
  });
  const blockerArtifacts = blocker
    ? buildBlockerArtifacts({
      networkEvents: result.channels.network.events,
      consoleEvents: result.channels.console.events,
      exceptionEvents: result.channels.exception.events,
      promptGuardEnabled: core.config.security.promptInjectionGuard?.enabled ?? true,
      caps: core.config.blockerArtifactCaps
    })
    : undefined;
  return {
    ...result,
    meta: {
      blockerState: blocker ? "active" : "clear",
      ...(blocker ? { blocker } : {}),
      ...(blockerArtifacts ? { blockerArtifacts } : {})
    }
  };
}

function findLatestStatus(events: Array<{ status?: number }>): number | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const status = events[index]?.status;
    if (typeof status === "number") return status;
  }
  return undefined;
}

function extractHosts(events: Array<{ url?: string }>): string[] {
  const hosts: string[] = [];
  const seen = new Set<string>();
  for (const event of events) {
    if (typeof event.url !== "string") continue;
    try {
      const host = new URL(event.url).hostname.toLowerCase();
      if (!host || seen.has(host)) continue;
      seen.add(host);
      hosts.push(host);
    } catch {
      // Ignore invalid URLs.
    }
  }
  return hosts;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing ${label}`);
  }
  return value;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value as Record<string, unknown>;
}

function requireClientId(params: Record<string, unknown>): string {
  return requireString(params.clientId, "clientId");
}

function requireStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`Invalid ${label}`);
  }
  return value as string[];
}

function requireDialogAction(value: unknown): "status" | "accept" | "dismiss" {
  if (value === "status" || value === "accept" || value === "dismiss") {
    return value;
  }
  throw new Error("Invalid action");
}

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

function requireCookieArray(value: unknown, label: string): CookieImportRecord[] {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid ${label}`);
  }
  const parsed: CookieImportRecord[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`Invalid ${label}`);
    }
    const cookie = entry as Record<string, unknown>;
    if (typeof cookie.name !== "string" || typeof cookie.value !== "string") {
      throw new Error(`Invalid ${label}`);
    }
    if (typeof cookie.sameSite !== "undefined" && cookie.sameSite !== "Strict" && cookie.sameSite !== "Lax" && cookie.sameSite !== "None") {
      throw new Error(`Invalid ${label}`);
    }
    parsed.push({
      name: cookie.name,
      value: cookie.value,
      ...(typeof cookie.url === "string" ? { url: cookie.url } : {}),
      ...(typeof cookie.domain === "string" ? { domain: cookie.domain } : {}),
      ...(typeof cookie.path === "string" ? { path: cookie.path } : {}),
      ...(typeof cookie.expires === "number" ? { expires: cookie.expires } : {}),
      ...(typeof cookie.httpOnly === "boolean" ? { httpOnly: cookie.httpOnly } : {}),
      ...(typeof cookie.secure === "boolean" ? { secure: cookie.secure } : {}),
      ...(cookie.sameSite ? { sameSite: cookie.sameSite as "Strict" | "Lax" | "None" } : {})
    });
  }
  return parsed;
}

function requireOptionalCookieUrlArray(value: unknown, label: string): string[] | undefined {
  if (typeof value === "undefined") {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error(`Invalid ${label}`);
  }

  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") {
      throw new Error(`Invalid ${label}`);
    }
    const trimmed = entry.trim();
    if (!trimmed) {
      throw new Error(`Invalid ${label}`);
    }
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(trimmed);
    } catch {
      throw new Error(`Invalid ${label}`);
    }
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      throw new Error(`Invalid ${label}`);
    }
    const normalizedUrl = parsedUrl.toString();
    if (seen.has(normalizedUrl)) {
      continue;
    }
    seen.add(normalizedUrl);
    normalized.push(normalizedUrl);
  }

  return normalized.length > 0 ? normalized : undefined;
}

function validateCookieRecord(cookie: CookieImportRecord): { valid: boolean; reason: string; cookie: CookieImportRecord } {
  const name = cookie.name?.trim();
  if (!name) {
    return { valid: false, reason: "Cookie name is required.", cookie };
  }
  if (!/^[^\s;=]+$/.test(name)) {
    return { valid: false, reason: `Invalid cookie name: ${cookie.name}.`, cookie };
  }
  if (typeof cookie.value !== "string" || /\r|\n|;/.test(cookie.value)) {
    return { valid: false, reason: `Invalid cookie value for ${name}.`, cookie };
  }

  const hasUrl = typeof cookie.url === "string" && cookie.url.trim().length > 0;
  const hasDomain = typeof cookie.domain === "string" && cookie.domain.trim().length > 0;
  if (!hasUrl && !hasDomain) {
    return { valid: false, reason: `Cookie ${name} requires url or domain.`, cookie };
  }

  let normalizedUrl: string | undefined;
  if (hasUrl) {
    try {
      const parsedUrl = new URL(cookie.url as string);
      if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
        return { valid: false, reason: `Cookie ${name} url must be http(s).`, cookie };
      }
      normalizedUrl = parsedUrl.toString();
    } catch {
      return { valid: false, reason: `Cookie ${name} has invalid url.`, cookie };
    }
  }

  let normalizedDomain: string | undefined;
  if (hasDomain) {
    normalizedDomain = String(cookie.domain).trim().toLowerCase();
    if (!/^\.?[a-z0-9.-]+$/.test(normalizedDomain) || normalizedDomain.includes("..")) {
      return { valid: false, reason: `Cookie ${name} has invalid domain.`, cookie };
    }
  }

  const normalizedPath = typeof cookie.path === "string" ? cookie.path.trim() : undefined;
  if (typeof normalizedPath === "string" && !normalizedPath.startsWith("/")) {
    return { valid: false, reason: `Cookie ${name} path must start with '/'.`, cookie };
  }

  if (typeof cookie.expires !== "undefined") {
    if (!Number.isFinite(cookie.expires) || cookie.expires < -1) {
      return { valid: false, reason: `Cookie ${name} has invalid expires.`, cookie };
    }
  }

  if (cookie.sameSite === "None" && cookie.secure !== true) {
    return { valid: false, reason: `Cookie ${name} with SameSite=None must set secure=true.`, cookie };
  }

  const normalizedCookie: CookieImportRecord = {
    name,
    value: cookie.value,
    ...(typeof cookie.expires === "number" ? { expires: cookie.expires } : {}),
    ...(typeof cookie.httpOnly === "boolean" ? { httpOnly: cookie.httpOnly } : {}),
    ...(typeof cookie.secure === "boolean" ? { secure: cookie.secure } : {}),
    ...(cookie.sameSite ? { sameSite: cookie.sameSite } : {})
  };

  if (normalizedDomain) {
    normalizedCookie.domain = normalizedDomain;
    normalizedCookie.path = normalizedPath ?? "/";
  } else if (normalizedUrl) {
    normalizedCookie.url = normalizedUrl;
  }

  return {
    valid: true,
    reason: "",
    cookie: normalizedCookie
  };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function optionalStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value as string[]
    : undefined;
}

function optionalNumber(value: unknown, label: string): number | undefined {
  if (typeof value === "undefined") {
    return undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  throw new Error(`Invalid ${label}`);
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function requireFiniteNumber(value: unknown, label: string): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  throw new Error(`Invalid ${label}`);
}

function optionalPositiveInteger(value: unknown, label: string): number | undefined {
  if (typeof value === "undefined") {
    return undefined;
  }
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  throw new Error(`Invalid ${label}`);
}

function requirePointerPoint(value: unknown, label: string): { x: number; y: number } {
  const point = requireRecord(value, label);
  return {
    x: requireFiniteNumber(point.x, `${label}.x`),
    y: requireFiniteNumber(point.y, `${label}.y`)
  };
}

function optionalPointerButton(value: unknown): "left" | "middle" | "right" {
  if (value === "middle" || value === "right") {
    return value;
  }
  return "left";
}

function optionalRenderMode(value: unknown): "compact" | "json" | "md" | "context" | "path" | undefined {
  if (typeof value === "undefined") return undefined;
  if (value === "compact" || value === "json" || value === "md" || value === "context" || value === "path") {
    return value;
  }
  throw new Error("Invalid mode");
}

function optionalProviderSelection(value: unknown): "auto" | "web" | "community" | "social" | "shopping" | "all" | undefined {
  if (typeof value === "undefined") return undefined;
  if (value === "auto" || value === "web" || value === "community" || value === "social" || value === "shopping" || value === "all") {
    return value;
  }
  throw new Error("Invalid sourceSelection");
}

function optionalProviderSources(value: unknown): Array<"web" | "community" | "social" | "shopping"> | undefined {
  if (typeof value === "undefined") return undefined;
  if (!Array.isArray(value)) {
    throw new Error("Invalid sources");
  }
  const valid = value.every((entry) => entry === "web" || entry === "community" || entry === "social" || entry === "shopping");
  if (!valid) {
    throw new Error("Invalid sources");
  }
  return value as Array<"web" | "community" | "social" | "shopping">;
}

function optionalCookiePolicy(value: unknown): "off" | "auto" | "required" | undefined {
  if (typeof value === "undefined") return undefined;
  if (value === "off" || value === "auto" || value === "required") {
    return value;
  }
  throw new Error("Invalid cookiePolicyOverride");
}

function optionalChallengeAutomationMode(value: unknown): ChallengeAutomationMode | undefined {
  if (typeof value === "undefined") return undefined;
  if (isChallengeAutomationMode(value)) {
    return value;
  }
  throw new Error("Invalid challengeAutomationMode");
}

function optionalShoppingSort(value: unknown): "best_deal" | "lowest_price" | "highest_rating" | "fastest_shipping" | undefined {
  if (typeof value === "undefined") return undefined;
  if (value === "best_deal" || value === "lowest_price" || value === "highest_rating" || value === "fastest_shipping") {
    return value;
  }
  throw new Error("Invalid shopping sort");
}

function optionalWorkflowBrowserMode(value: unknown): "auto" | "extension" | "managed" | undefined {
  if (typeof value === "undefined") return undefined;
  if (value === "auto" || value === "extension" || value === "managed") {
    return value;
  }
  throw new Error("Invalid browserMode");
}

function optionalInspiredesignCaptureMode(value: unknown): "off" | "deep" | undefined {
  if (typeof value === "undefined") return undefined;
  if (value === "off" || value === "deep") {
    return value;
  }
  throw new Error("Invalid captureMode");
}

function requireWaitUntil(value: unknown): "domcontentloaded" | "load" | "networkidle" {
  if (value === "domcontentloaded" || value === "load" || value === "networkidle") {
    return value;
  }
  return "load";
}

function requireSnapshotMode(value: unknown): "outline" | "actionables" {
  if (value === "actionables") return "actionables";
  return "outline";
}

function requireScreenshotMode(value: unknown): "visible" | "full" | "none" {
  if (value === "visible" || value === "full" || value === "none") {
    return value;
  }
  return "visible";
}

function requireAnnotationTransport(value: unknown): "auto" | "direct" | "relay" {
  if (value === "auto" || value === "direct" || value === "relay") {
    return value;
  }
  if (typeof value === "undefined") {
    return "auto";
  }
  throw new Error("Invalid transport");
}

function requireAnnotationDispatchSource(value: unknown): AnnotationDispatchSource {
  if (
    value === "annotate_item"
    || value === "annotate_all"
    || value === "popup_item"
    || value === "popup_all"
    || value === "canvas_item"
    || value === "canvas_all"
  ) {
    return value;
  }
  throw new Error("Invalid source");
}

function requireAnnotationPayload(value: unknown): AnnotationPayload {
  const payload = requireRecord(value, "payload");
  if (
    typeof payload.url !== "string"
    || typeof payload.timestamp !== "string"
    || !Array.isArray(payload.annotations)
  ) {
    throw new Error("Invalid payload");
  }
  if (
    (typeof payload.title !== "undefined" && typeof payload.title !== "string")
    || (typeof payload.context !== "undefined" && typeof payload.context !== "string")
  ) {
    throw new Error("Invalid payload");
  }
  if (
    typeof payload.screenshotMode !== "undefined"
    && payload.screenshotMode !== "visible"
    && payload.screenshotMode !== "full"
    && payload.screenshotMode !== "none"
  ) {
    throw new Error("Invalid payload");
  }
  return payload as AnnotationPayload;
}

function requireState(value: unknown): "attached" | "visible" | "hidden" {
  if (value === "visible" || value === "hidden") return value;
  return "attached";
}

type RelayObservedStatus = {
  instanceId: string;
  running: boolean;
  port?: number;
  extensionConnected: boolean;
  extensionHandshakeComplete: boolean;
  cdpConnected: boolean;
  opsConnected: boolean;
  pairingRequired: boolean;
};

type MacroRuntimeModule = {
  createDefaultMacroRegistry?: () => {
    resolve: (expression: string, context?: { defaultProvider?: string }) => Promise<MacroResolution>;
    list: () => Array<{ name: string; pack?: string; description?: string }>;
  };
};

type MacroResolveOptions = {
  expression: string;
  defaultProvider?: string;
  includeCatalog: boolean;
  execute: boolean;
  timeoutMs?: number;
  challengeAutomationMode?: ChallengeAutomationMode;
};

const MIN_WAIT_TIMEOUT_MS = 3000;
const WAIT_MIN_DELAY_MS = 250;
const WAIT_MAX_DELAY_MS = 2000;
const RELAY_STATUS_TIMEOUT_MS = 1500;

function clampWaitTimeout(timeoutMs: number): number {
  if (!Number.isFinite(timeoutMs)) {
    return MIN_WAIT_TIMEOUT_MS;
  }
  return Math.max(timeoutMs, MIN_WAIT_TIMEOUT_MS);
}

async function waitForRelayHandshake(
  relay: { status: () => { extensionHandshakeComplete: boolean; instanceId: string } },
  observedPort: number | null,
  timeoutMs: number
): Promise<boolean> {
  const start = Date.now();
  let delay = WAIT_MIN_DELAY_MS;
  while (Date.now() - start < timeoutMs) {
    const relayStatus = relay.status();
    if (relayStatus.extensionHandshakeComplete) {
      return true;
    }
    const observedStatus = getMatchingObservedRelayStatus(
      relayStatus,
      await fetchRelayObservedStatus(observedPort)
    );
    if (observedStatus?.extensionHandshakeComplete) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(delay * 2, WAIT_MAX_DELAY_MS);
  }
  return false;
}

function resolveObservedPort(relayStatus: { port?: number }, configPort: number): number | null {
  if (isValidPort(relayStatus.port)) return relayStatus.port;
  if (isValidPort(configPort)) return configPort;
  return null;
}

function isValidPort(port: unknown): port is number {
  return typeof port === "number" && Number.isInteger(port) && port > 0 && port <= 65535;
}

async function fetchRelayObservedStatus(port: number | null): Promise<RelayObservedStatus | null> {
  if (!isValidPort(port)) {
    return null;
  }
  try {
    const response = await fetchWithTimeout(
      `http://127.0.0.1:${port}/status`,
      undefined,
      RELAY_STATUS_TIMEOUT_MS
    );
    if (!response.ok) {
      return null;
    }
    const data = await response.json();
    if (!data || typeof data !== "object") {
      return null;
    }
    const record = data as Record<string, unknown>;
    if (typeof record.instanceId !== "string") {
      return null;
    }
    return {
      instanceId: record.instanceId,
      running: Boolean(record.running),
      port: typeof record.port === "number" ? record.port : undefined,
      extensionConnected: Boolean(record.extensionConnected),
      extensionHandshakeComplete: Boolean(record.extensionHandshakeComplete),
      cdpConnected: Boolean(record.cdpConnected),
      opsConnected: Boolean(record.opsConnected),
      pairingRequired: Boolean(record.pairingRequired)
    };
  } catch {
    return null;
  }
}

function getMatchingObservedRelayStatus(
  relayStatus: { instanceId: string },
  observedStatus: RelayObservedStatus | null
): RelayObservedStatus | null {
  if (!observedStatus) {
    return null;
  }
  return observedStatus.instanceId === relayStatus.instanceId ? observedStatus : null;
}

async function loadMacroRuntime(): Promise<MacroRuntimeModule | null> {
  try {
    const module = await import("../macros");
    return module as MacroRuntimeModule;
  } catch {
    return null;
  }
}

function parseFallbackMacro(expression: string, defaultProvider?: string): {
  action: {
    source: "web";
    operation: "search";
    input: { query: string; limit: number; providerId: string };
  };
  provenance: {
    macro: string;
    provider: string;
    resolvedQuery: string;
    pack: string;
    args: { positional: string[]; named: Record<string, string> };
  };
} {
  const raw = expression.trim();
  if (!raw.startsWith("@")) {
    throw new Error("Macro expressions must start with '@'");
  }

  const body = raw.slice(1).trim();
  if (!body) {
    throw new Error("Macro name is required");
  }

  const openParen = body.indexOf("(");
  const closeParen = body.endsWith(")") ? body.length - 1 : -1;
  const macroName = openParen >= 0 ? body.slice(0, openParen).trim() : body;
  const argsBody = openParen >= 0 && closeParen > openParen
    ? body.slice(openParen + 1, closeParen).trim()
    : "";
  const positional = argsBody
    ? argsBody.split(",").map((part) => part.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean)
    : [];
  const query = positional[0] ?? macroName;
  const provider = defaultProvider ?? "web/default";

  return {
    action: {
      source: "web",
      operation: "search",
      input: {
        query,
        limit: 10,
        providerId: provider
      }
    },
    provenance: {
      macro: macroName,
      provider,
      resolvedQuery: query,
      pack: "fallback",
      args: {
        positional,
        named: {}
      }
    }
  };
}

async function resolveMacroExpression(
  options: MacroResolveOptions,
  config: Pick<OpenDevBrowserCore["config"], "blockerDetectionThreshold" | "security" | "providers">,
  manager: OpenDevBrowserCore["manager"],
  browserFallbackPort: OpenDevBrowserCore["browserFallbackPort"],
  existingRuntime?: OpenDevBrowserCore["providerRuntime"]
): Promise<{
  runtime: "macros" | "fallback";
  resolution: MacroResolution;
  catalog?: Array<{ name: string; pack?: string; description?: string }>;
  execution?: MacroExecutionPayload;
  followthroughSummary: string;
  suggestedNextAction: string;
  suggestedSteps: Array<{ reason: string; command?: string }>;
}> {
  const runtime = await loadMacroRuntime();
  const registry = runtime?.createDefaultMacroRegistry?.();
  let resolvedRuntime: "macros" | "fallback" = "fallback";
  let resolution: MacroResolution;
  let catalog: Array<{ name: string; pack?: string; description?: string }> | undefined;

  if (registry) {
    resolvedRuntime = "macros";
    resolution = await registry.resolve(options.expression, {
      defaultProvider: options.defaultProvider
    });
    catalog = options.includeCatalog
      ? registry.list().map((entry) => ({
        name: entry.name,
        pack: entry.pack,
        description: entry.description
      }))
      : undefined;
  } else {
    resolution = parseFallbackMacro(options.expression, options.defaultProvider);
  }

  if (!options.execute) {
    const handoff = buildMacroResolveSuccessHandoff({
      expression: options.expression,
      defaultProvider: options.defaultProvider,
      execute: false,
      blocked: false
    });
    return {
      runtime: resolvedRuntime,
      resolution,
      ...(catalog ? { catalog } : {}),
      ...handoff
    };
  }

  const execution = await executeMacroWithRuntime({
    resolution,
    existingRuntime,
    config,
    manager,
    browserFallbackPort,
    timeoutMs: options.timeoutMs,
    challengeAutomationMode: options.challengeAutomationMode
  });
  const handoff = buildMacroResolveSuccessHandoff({
    expression: options.expression,
    defaultProvider: options.defaultProvider,
    execute: true,
    blocked: Boolean(execution.meta.blocker)
  });
  return {
    runtime: resolvedRuntime,
    resolution,
    ...(catalog ? { catalog } : {}),
    execution,
    ...handoff
  };
}
