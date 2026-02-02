import type { ParsedArgs } from "../args";
import { createUsageError, EXIT_DISCONNECTED } from "../errors";
import { fetchDaemonStatusFromMetadata } from "../daemon-status";
import { runSessionStatus } from "./session/status";
import { getNativeStatusSnapshot } from "./native";

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
    if (!nativeStatus.installed) {
      return {
        success: false,
        message: "Native host not installed.",
        data: nativeStatus,
        exitCode: EXIT_DISCONNECTED
      };
    }
    return {
      success: true,
      message: nativeStatus.extensionId
        ? `Native host installed for extension ${nativeStatus.extensionId}.`
        : "Native host installed.",
      data: nativeStatus
    };
  }

  const daemonStatus = await fetchDaemonStatusFromMetadata();
  if (!daemonStatus) {
    throw createUsageError("Daemon not running. Start with `opendevbrowser serve`.");
  }

  const nativeStatus = getNativeStatusSnapshot();

  const baseMessage = [
    `Daemon OK (pid=${daemonStatus.pid})`,
    `Relay: port=${daemonStatus.relay.port ?? "n/a"} ext=${daemonStatus.relay.extensionConnected ? "on" : "off"} ` +
      `handshake=${daemonStatus.relay.extensionHandshakeComplete ? "on" : "off"} ` +
      `cdp=${daemonStatus.relay.cdpConnected ? "on" : "off"} ` +
      `annotate=${daemonStatus.relay.annotationConnected ? "on" : "off"} ` +
      `ops=${daemonStatus.relay.opsConnected ? "on" : "off"} ` +
      `pairing=${daemonStatus.relay.pairingRequired ? "on" : "off"} ` +
      `health=${daemonStatus.relay.health?.reason ?? "n/a"}`,
    `Native: ${nativeStatus.installed ? "installed" : "not installed"}${nativeStatus.extensionId ? ` (${nativeStatus.extensionId})` : ""}`,
    daemonStatus.relay.lastHandshakeError
      ? `Relay last handshake error: ${daemonStatus.relay.lastHandshakeError.code} (${daemonStatus.relay.lastHandshakeError.message})`
      : "Relay last handshake error: none",
    "Legend: ext=extension websocket, handshake=extension handshake, cdp=active /cdp client, annotate=annotation channel, ops=ops clients, pairing=token required, health=relay status"
  ].join("\n");

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
