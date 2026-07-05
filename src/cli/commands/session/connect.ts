import type { ParsedArgs } from "../../args";
import { callDaemon } from "../../client";
import { createUsageError } from "../../errors";
import { parseNumberFlag, readInlineFlagValue } from "../../utils/parse";
import { parseGoogleAuthIntent, type GoogleAuthIntent } from "../../../core/auth-intent";
import { isSessionOpsRelayEndpoint } from "../../../relay/relay-endpoints";

type ConnectArgs = {
  wsEndpoint?: string;
  host?: string;
  port?: number;
  profile?: string;
  startUrl?: string;
  headless?: boolean;
  extensionLegacy?: boolean;
  googleAuthIntent?: GoogleAuthIntent;
  disableSystemCookieBootstrap?: boolean;
  allowGoogleCookieBootstrap?: boolean;
};

const DEFAULT_CONNECT_TIMEOUT_MS = 30_000;

function parseConnectArgs(rawArgs: string[]): ConnectArgs {
  const parsed: ConnectArgs = {};
  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    if (arg === "--ws-endpoint") {
      const value = rawArgs[i + 1];
      if (!value) throw createUsageError("Missing value for --ws-endpoint");
      parsed.wsEndpoint = value;
      i += 1;
      continue;
    }
    if (arg?.startsWith("--ws-endpoint=")) {
      parsed.wsEndpoint = readInlineFlagValue(arg, "--ws-endpoint");
      continue;
    }
    if (arg === "--profile") {
      const value = rawArgs[i + 1];
      if (!value) throw createUsageError("Missing value for --profile");
      parsed.profile = value;
      i += 1;
      continue;
    }
    if (arg?.startsWith("--profile=")) {
      const value = readInlineFlagValue(arg, "--profile");
      if (!value) throw createUsageError("Missing value for --profile");
      parsed.profile = value;
      continue;
    }
    if (arg === "--host") {
      const value = rawArgs[i + 1];
      if (!value) throw createUsageError("Missing value for --host");
      parsed.host = value;
      i += 1;
      continue;
    }
    if (arg?.startsWith("--host=")) {
      const value = readInlineFlagValue(arg, "--host");
      if (!value) throw createUsageError("Missing value for --host");
      parsed.host = value;
      continue;
    }
    if (arg === "--cdp-port") {
      const value = rawArgs[i + 1];
      if (!value) throw createUsageError("Missing value for --cdp-port");
      parsed.port = parseNumberFlag(value, "--cdp-port", { min: 1, max: 65535 });
      i += 1;
      continue;
    }
    if (arg?.startsWith("--cdp-port=")) {
      const value = readInlineFlagValue(arg, "--cdp-port");
      if (!value) throw createUsageError("Missing value for --cdp-port");
      parsed.port = parseNumberFlag(value, "--cdp-port", { min: 1, max: 65535 });
      continue;
    }
    if (arg === "--start-url") {
      const value = rawArgs[i + 1];
      if (!value) throw createUsageError("Missing value for --start-url");
      parsed.startUrl = value;
      i += 1;
      continue;
    }
    if (arg?.startsWith("--start-url=")) {
      const value = readInlineFlagValue(arg, "--start-url");
      if (!value) throw createUsageError("Missing value for --start-url");
      parsed.startUrl = value;
      continue;
    }
    if (arg === "--extension-legacy") {
      parsed.extensionLegacy = true;
      continue;
    }
    if (arg === "--google-auth-intent") {
      const value = rawArgs[i + 1];
      if (!value) throw createUsageError("Missing value for --google-auth-intent");
      parsed.googleAuthIntent = parseCliGoogleAuthIntent(value);
      i += 1;
      continue;
    }
    if (arg?.startsWith("--google-auth-intent=")) {
      const value = readInlineFlagValue(arg, "--google-auth-intent");
      if (!value) throw createUsageError("Missing value for --google-auth-intent");
      parsed.googleAuthIntent = parseCliGoogleAuthIntent(value);
      continue;
    }
    if (arg === "--disable-system-cookie-bootstrap") {
      parsed.disableSystemCookieBootstrap = true;
      continue;
    }
    if (arg === "--allow-google-cookie-bootstrap") {
      parsed.allowGoogleCookieBootstrap = true;
      continue;
    }
    if (arg === "--headless") {
      parsed.headless = true;
      continue;
    }
  }
  if (parsed.profile && (parsed.wsEndpoint || parsed.host || parsed.port)) {
    throw createUsageError("Use either --profile for a registry-backed CDP profile or raw --ws-endpoint/--host/--cdp-port, not both.");
  }
  return parsed;
}

function parseCliGoogleAuthIntent(value: string): GoogleAuthIntent {
  try {
    return parseGoogleAuthIntent(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw createUsageError(message);
  }
}

export const __test__ = { parseConnectArgs };

function sanitizeConnectResult<T extends { sessionId: string } & Record<string, unknown>>(result: T): Omit<T, "wsEndpoint"> {
  const { wsEndpoint: _wsEndpoint, ...safeResult } = result;
  return safeResult;
}

export async function runSessionConnect(args: ParsedArgs) {
  const connectArgs = parseConnectArgs(args.rawArgs);
  const googleAuthUsesOpsRelay = typeof connectArgs.host === "undefined"
    && typeof connectArgs.port === "undefined"
    && typeof connectArgs.profile === "undefined"
    && connectArgs.extensionLegacy !== true
    && (!connectArgs.wsEndpoint || isSessionOpsRelayEndpoint(connectArgs.wsEndpoint));
  if (connectArgs.googleAuthIntent === "user_owned_google" && !googleAuthUsesOpsRelay) {
    throw createUsageError(
      "Google user-owned auth requires the extension /ops relay. Use a local /ops --ws-endpoint or omit --ws-endpoint/--host/--cdp-port/--extension-legacy and connect the extension, then retry."
    );
  }
  const result = await callDaemon("session.connect", connectArgs, {
    timeoutMs: DEFAULT_CONNECT_TIMEOUT_MS
  }) as { sessionId: string } & Record<string, unknown>;
  const data = sanitizeConnectResult(result);
  return {
    success: true,
    message: `Session connected: ${result.sessionId}`,
    data
  };
}
