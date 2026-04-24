import type { ParsedArgs } from "../args";
import { createDisconnectedError, createUsageError } from "../errors";
import { fetchDaemonStatusFromMetadata } from "../daemon-status";
import { DEFAULT_DAEMON_STATUS_FETCH_OPTIONS } from "../daemon-status-policy";
import { runSessionStatus } from "./session/status";
import { assessNativeStatus, getNativeStatusSnapshot } from "./native";

type StatusArgs = {
  sessionId?: string;
  daemon: boolean;
};

const parseStatusArgs = (rawArgs: string[]): StatusArgs => {
  const parsed: StatusArgs = { daemon: false };
  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    if (arg === "--daemon") {
      parsed.daemon = true;
      continue;
    }
    if (arg === "--session-id") {
      const value = rawArgs[i + 1];
      if (!value) throw createUsageError("Missing value for --session-id");
      parsed.sessionId = value;
      i += 1;
      continue;
    }
    if (arg?.startsWith("--session-id=")) {
      parsed.sessionId = arg.split("=", 2)[1];
      continue;
    }
  }
  return parsed;
};

export async function runStatus(args: ParsedArgs) {
  const { sessionId, daemon } = parseStatusArgs(args.rawArgs);
  if (sessionId && daemon) {
    throw createUsageError("Use --session-id or --daemon, not both.");
  }

  if (sessionId) {
    return runSessionStatus(args);
  }

  if (!daemon && args.transport === "native") {
    const nativeStatus = getNativeStatusSnapshot();
    const assessment = assessNativeStatus(nativeStatus);
    return {
      success: assessment.success,
      message: assessment.message,
      data: nativeStatus,
      exitCode: assessment.exitCode ?? undefined
    };
  }

  const daemonStatus = await fetchDaemonStatusFromMetadata(undefined, DEFAULT_DAEMON_STATUS_FETCH_OPTIONS);
  if (!daemonStatus) {
    throw createDisconnectedError("Daemon not running. Start with `opendevbrowser serve`.");
  }

  const nativeStatus = getNativeStatusSnapshot();
  const nativeAssessment = assessNativeStatus(nativeStatus);
  const fingerprintLine = daemonStatus.fingerprintCurrent === false
    ? "Daemon fingerprint: mismatch with current build"
    : "Daemon fingerprint: current";

  const baseLines = [
    `Daemon OK (pid=${daemonStatus.pid})`,
    fingerprintLine,
    `Relay: port=${daemonStatus.relay.port ?? "n/a"} ext=${daemonStatus.relay.extensionConnected ? "on" : "off"} ` +
      `handshake=${daemonStatus.relay.extensionHandshakeComplete ? "on" : "off"} ` +
      `cdp=${daemonStatus.relay.cdpConnected ? "on" : "off"} ` +
      `annotate=${daemonStatus.relay.annotationConnected ? "on" : "off"} ` +
      `ops=${daemonStatus.relay.opsConnected ? "on" : "off"} ` +
      `canvas=${daemonStatus.relay.canvasConnected ? "on" : "off"} ` +
      `pairing=${daemonStatus.relay.pairingRequired ? "on" : "off"} ` +
      `health=${daemonStatus.relay.health?.reason ?? "n/a"}`,
    `Native: ${nativeAssessment.summary}`,
    daemonStatus.relay.lastHandshakeError
      ? `Relay last handshake error: ${daemonStatus.relay.lastHandshakeError.code} (${daemonStatus.relay.lastHandshakeError.message})`
      : "Relay last handshake error: none",
    "Legend: ext=extension websocket, handshake=extension handshake, cdp=active /cdp client, annotate=annotation channel, ops=ops clients, canvas=canvas clients, pairing=token required, health=relay status"
  ];
  if (!nativeAssessment.success) {
    baseLines.splice(4, 0, `Native detail: ${nativeAssessment.message}`);
  }
  const baseMessage = baseLines.join("\n");

  const message = daemon || args.outputFormat !== "text"
    ? baseMessage
    : [
      "Warning: `status` defaults to daemon status. Use --daemon explicitly or --session-id for session status.",
      baseMessage
    ].join("\n");

  return {
    success: true,
    message,
    data: { ...daemonStatus, native: nativeStatus }
  };
}
