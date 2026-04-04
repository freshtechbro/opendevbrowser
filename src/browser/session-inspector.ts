import type { RelayStatus } from "../relay/relay-server";
import type { BrowserResponseMeta, SessionInspectorHandle } from "./manager-types";

type SessionInspectorStatus = Awaited<ReturnType<SessionInspectorHandle["status"]>>;
type SessionInspectorTargets = Awaited<ReturnType<SessionInspectorHandle["listTargets"]>>;

type TraceChannelSummary = {
  eventCount: number;
  nextSeq: number | null;
  truncated: boolean;
};

type ConsoleSummary = TraceChannelSummary & {
  errorCount: number;
  warningCount: number;
  latest: Array<{ level: string; message: string }>;
};

type NetworkSummary = TraceChannelSummary & {
  failureCount: number;
  latestFailures: Array<{ status?: number; method?: string; url?: string; error?: string }>;
};

export type SessionInspectorResult = {
  session: SessionInspectorStatus;
  relay: {
    running: boolean;
    port?: number;
    extensionConnected: boolean;
    extensionHandshakeComplete: boolean;
    annotationConnected: boolean;
    opsConnected: boolean;
    canvasConnected: boolean;
    cdpConnected: boolean;
    pairingRequired: boolean;
    health: RelayStatus["health"];
  } | null;
  targets: {
    activeTargetId: string | null;
    count: number;
    items: SessionInspectorTargets["targets"];
  };
  console: ConsoleSummary;
  network: NetworkSummary;
  proofArtifact: {
    source: "debug_trace_snapshot";
    requestId: string | null;
    generatedAt: string | null;
    blockerState: "clear" | "active" | "resolving";
    url?: string;
    title?: string;
  };
  healthState: "ok" | "warning" | "blocked";
  suggestedNextAction: string;
};

export type InspectSessionOptions = {
  sessionId: string;
  includeUrls?: boolean;
  sinceConsoleSeq?: number;
  sinceNetworkSeq?: number;
  sinceExceptionSeq?: number;
  max?: number;
  requestId?: string;
  relayStatus?: RelayStatus | null;
};

export async function inspectSession(
  handle: SessionInspectorHandle,
  options: InspectSessionOptions
): Promise<SessionInspectorResult> {
  const [session, targets, traceRaw] = await Promise.all([
    handle.status(options.sessionId),
    handle.listTargets(options.sessionId, options.includeUrls ?? true),
    handle.debugTraceSnapshot(options.sessionId, {
      sinceConsoleSeq: options.sinceConsoleSeq,
      sinceNetworkSeq: options.sinceNetworkSeq,
      sinceExceptionSeq: options.sinceExceptionSeq,
      max: options.max ?? 25,
      requestId: options.requestId
    })
  ]);

  const trace = asRecord(traceRaw);
  const tracePage = asRecord(trace.page);
  const traceMeta = asRecord(trace.meta);
  const traceConsole = summarizeConsole(readChannel(trace, "console"));
  const traceNetwork = summarizeNetwork(readChannel(trace, "network"));
  const blockerState = readBlockerState(traceMeta, session.meta);
  const relay = options.relayStatus ? summarizeRelay(options.relayStatus) : null;
  const healthState = deriveHealthState({
    blockerState,
    dialogOpen: session.meta?.dialog?.open === true,
    relay,
    activeTargetId: targets.activeTargetId,
    consoleErrors: traceConsole.errorCount,
    networkFailures: traceNetwork.failureCount
  });

  return {
    session,
    relay,
    targets: {
      activeTargetId: targets.activeTargetId,
      count: targets.targets.length,
      items: targets.targets
    },
    console: traceConsole,
    network: traceNetwork,
    proofArtifact: {
      source: "debug_trace_snapshot",
      requestId: getString(trace.requestId) ?? options.requestId ?? null,
      generatedAt: getString(trace.generatedAt) ?? null,
      blockerState,
      ...(getString(tracePage.url) || session.url ? { url: getString(tracePage.url) ?? session.url } : {}),
      ...(getString(tracePage.title) || session.title ? { title: getString(tracePage.title) ?? session.title } : {})
    },
    healthState,
    suggestedNextAction: deriveSuggestedNextAction({
      mode: session.mode,
      dialogOpen: session.meta?.dialog?.open === true,
      blockerState,
      relay,
      activeTargetId: targets.activeTargetId,
      consoleErrors: traceConsole.errorCount,
      networkFailures: traceNetwork.failureCount
    })
  };
}

function readChannel(trace: Record<string, unknown>, channelName: "console" | "network") {
  const channels = asRecord(trace.channels);
  const channel = asRecord(channels[channelName]);
  const events = asArray(channel.events);
  return {
    events,
    nextSeq: getNumber(channel.nextSeq),
    truncated: getBoolean(channel.truncated) ?? false
  };
}

function summarizeConsole(channel: {
  events: unknown[];
  nextSeq: number | null;
  truncated: boolean;
}): ConsoleSummary {
  const events = channel.events
    .map((entry) => {
      const record = asRecord(entry);
      const message = [
        getString(record.text),
        getString(record.message),
        getString(record.value)
      ].find((value) => typeof value === "string" && value.trim().length > 0);
      return {
        level: (getString(record.level) ?? getString(record.type) ?? "log").toLowerCase(),
        message: message?.trim() ?? ""
      };
    })
    .filter((entry) => entry.message.length > 0);

  const latest = events.slice(-3).reverse().map((entry) => ({
    level: entry.level,
    message: entry.message
  }));

  return {
    eventCount: channel.events.length,
    nextSeq: channel.nextSeq,
    truncated: channel.truncated,
    errorCount: events.filter((entry) => entry.level.includes("error")).length,
    warningCount: events.filter((entry) => entry.level.includes("warn")).length,
    latest
  };
}

function summarizeNetwork(channel: {
  events: unknown[];
  nextSeq: number | null;
  truncated: boolean;
}): NetworkSummary {
  const normalized = channel.events.map((entry) => {
    const record = asRecord(entry);
    return {
      status: getNumber(record.status) ?? undefined,
      method: getString(record.method) ?? undefined,
      url: getString(record.url) ?? undefined,
      error: getString(record.errorText) ?? getString(record.error) ?? undefined
    };
  });

  const failures = normalized.filter((entry) => (
    (typeof entry.status === "number" && entry.status >= 400)
    || typeof entry.error === "string"
  ));

  return {
    eventCount: channel.events.length,
    nextSeq: channel.nextSeq,
    truncated: channel.truncated,
    failureCount: failures.length,
    latestFailures: failures.slice(-3).reverse()
  };
}

function summarizeRelay(relay: RelayStatus) {
  return {
    running: relay.running,
    ...(typeof relay.port === "number" ? { port: relay.port } : {}),
    extensionConnected: relay.extensionConnected,
    extensionHandshakeComplete: relay.extensionHandshakeComplete,
    annotationConnected: relay.annotationConnected,
    opsConnected: relay.opsConnected,
    canvasConnected: relay.canvasConnected,
    cdpConnected: relay.cdpConnected,
    pairingRequired: relay.pairingRequired,
    health: relay.health
  };
}

function deriveHealthState(input: {
  blockerState: "clear" | "active" | "resolving";
  dialogOpen: boolean;
  relay: SessionInspectorResult["relay"];
  activeTargetId: string | null;
  consoleErrors: number;
  networkFailures: number;
}): SessionInspectorResult["healthState"] {
  if (
    input.blockerState === "active"
    || input.dialogOpen
    || input.activeTargetId === null
    || (input.relay && !input.relay.extensionHandshakeComplete && input.relay.extensionConnected)
  ) {
    return "blocked";
  }
  if (
    (input.relay && !input.relay.health.ok)
    || input.consoleErrors > 0
    || input.networkFailures > 0
  ) {
    return "warning";
  }
  return "ok";
}

function deriveSuggestedNextAction(input: {
  mode: SessionInspectorStatus["mode"];
  dialogOpen: boolean;
  blockerState: "clear" | "active" | "resolving";
  relay: SessionInspectorResult["relay"];
  activeTargetId: string | null;
  consoleErrors: number;
  networkFailures: number;
}): string {
  if (input.dialogOpen) {
    return "Handle the open dialog before continuing any page interaction.";
  }
  if (input.mode === "extension" && input.relay && !input.relay.extensionHandshakeComplete) {
    return "Wait for extension handshake to complete or relaunch in managed mode if the relay is unhealthy.";
  }
  if (input.blockerState === "active") {
    return "Resolve the active blocker or challenge before issuing more page actions.";
  }
  if (input.activeTargetId === null) {
    return "Create or select a target before continuing the next automation step.";
  }
  if (input.consoleErrors > 0 || input.networkFailures > 0) {
    return "Inspect the summarized trace failures, fix the page instability, then rerun snapshot or review.";
  }
  return "Capture snapshot or review and continue the normal snapshot -> action -> snapshot loop.";
}

function readBlockerState(
  traceMeta: Record<string, unknown>,
  sessionMeta?: BrowserResponseMeta
): "clear" | "active" | "resolving" {
  const raw = getString(traceMeta.blockerState) ?? sessionMeta?.blockerState ?? "clear";
  return raw === "active" || raw === "resolving" ? raw : "clear";
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function getString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function getNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function getBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}
