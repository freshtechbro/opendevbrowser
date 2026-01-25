import type { ParsedArgs } from "../args";
import { createUsageError } from "../errors";
import { fetchDaemonStatusFromMetadata } from "../daemon-status";
import { runSessionStatus } from "./session/status";

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

  const daemonStatus = await fetchDaemonStatusFromMetadata();
  if (!daemonStatus) {
    throw createUsageError("Daemon not running. Start with `opendevbrowser serve`.");
  }

  const baseMessage = [
    `Daemon OK (pid=${daemonStatus.pid})`,
    `Relay: port=${daemonStatus.relay.port ?? "n/a"} ext=${daemonStatus.relay.extensionConnected ? "on" : "off"} ` +
      `handshake=${daemonStatus.relay.extensionHandshakeComplete ? "on" : "off"} ` +
      `cdp=${daemonStatus.relay.cdpConnected ? "on" : "off"} ` +
      `pairing=${daemonStatus.relay.pairingRequired ? "on" : "off"}`,
    "Legend: ext=extension websocket, handshake=extension handshake, cdp=active /cdp client, pairing=token required"
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
    data: daemonStatus
  };
}
