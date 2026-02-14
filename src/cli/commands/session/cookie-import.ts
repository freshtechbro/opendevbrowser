import { readFileSync } from "fs";
import type { ParsedArgs } from "../../args";
import { callDaemon } from "../../client";
import { createUsageError } from "../../errors";

type CookieImportArgs = {
  sessionId?: string;
  cookies?: string;
  cookiesFile?: string;
  strict?: boolean;
  requestId?: string;
};

type CookieRecord = {
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

const requireValue = (value: string | undefined, flag: string): string => {
  if (!value) {
    throw createUsageError(`Missing value for ${flag}`);
  }
  return value;
};

const parseStrictValue = (value: string, flag: string): boolean => {
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw createUsageError(`Invalid ${flag}: ${value}`);
};

const parseCookieImportArgs = (rawArgs: string[]): CookieImportArgs => {
  const parsed: CookieImportArgs = {};

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];

    if (arg === "--session-id") {
      parsed.sessionId = requireValue(rawArgs[index + 1], "--session-id");
      index += 1;
      continue;
    }
    if (arg?.startsWith("--session-id=")) {
      parsed.sessionId = requireValue(arg.split("=", 2)[1], "--session-id");
      continue;
    }

    if (arg === "--cookies") {
      parsed.cookies = requireValue(rawArgs[index + 1], "--cookies");
      index += 1;
      continue;
    }
    if (arg?.startsWith("--cookies=")) {
      parsed.cookies = requireValue(arg.split("=", 2)[1], "--cookies");
      continue;
    }

    if (arg === "--cookies-file") {
      parsed.cookiesFile = requireValue(rawArgs[index + 1], "--cookies-file");
      index += 1;
      continue;
    }
    if (arg?.startsWith("--cookies-file=")) {
      parsed.cookiesFile = requireValue(arg.split("=", 2)[1], "--cookies-file");
      continue;
    }

    if (arg === "--strict") {
      parsed.strict = true;
      continue;
    }
    if (arg?.startsWith("--strict=")) {
      parsed.strict = parseStrictValue(requireValue(arg.split("=", 2)[1], "--strict"), "--strict");
      continue;
    }

    if (arg === "--request-id") {
      parsed.requestId = requireValue(rawArgs[index + 1], "--request-id");
      index += 1;
      continue;
    }
    if (arg?.startsWith("--request-id=")) {
      parsed.requestId = requireValue(arg.split("=", 2)[1], "--request-id");
      continue;
    }
  }

  return parsed;
};

const parseCookiesJson = (raw: string, source: string): CookieRecord[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid JSON";
    throw createUsageError(`Invalid JSON from ${source}: ${message}`);
  }

  if (!Array.isArray(parsed)) {
    throw createUsageError(`Invalid JSON from ${source}: expected array`);
  }

  const cookies: CookieRecord[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw createUsageError(`Invalid JSON from ${source}: expected cookie object entries`);
    }
    const cookie = entry as Record<string, unknown>;
    if (typeof cookie.name !== "string" || typeof cookie.value !== "string") {
      throw createUsageError(`Invalid JSON from ${source}: each cookie requires string name and value`);
    }
    if (typeof cookie.sameSite !== "undefined" && cookie.sameSite !== "Strict" && cookie.sameSite !== "Lax" && cookie.sameSite !== "None") {
      throw createUsageError(`Invalid JSON from ${source}: sameSite must be Strict, Lax, or None`);
    }

    cookies.push({
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

  return cookies;
};

const resolveCookies = (parsed: CookieImportArgs): CookieRecord[] => {
  const hasInline = typeof parsed.cookies === "string";
  const hasFile = typeof parsed.cookiesFile === "string";

  if (!hasInline && !hasFile) {
    throw createUsageError("Missing --cookies or --cookies-file");
  }
  if (hasInline && hasFile) {
    throw createUsageError("Provide only one cookies source: --cookies or --cookies-file.");
  }

  if (hasInline) {
    return parseCookiesJson(parsed.cookies ?? "", "--cookies");
  }

  let raw = "";
  try {
    raw = readFileSync(parsed.cookiesFile ?? "", "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to read file";
    throw createUsageError(`Invalid --cookies-file: ${message}`);
  }

  if (!raw.trim()) {
    throw createUsageError("Invalid JSON from --cookies-file: empty input");
  }

  return parseCookiesJson(raw, "--cookies-file");
};

export async function runCookieImport(args: ParsedArgs) {
  const parsed = parseCookieImportArgs(args.rawArgs);
  if (!parsed.sessionId) {
    throw createUsageError("Missing --session-id");
  }

  const cookies = resolveCookies(parsed);
  const result = await callDaemon("session.cookieImport", {
    sessionId: parsed.sessionId,
    cookies,
    strict: parsed.strict ?? true,
    requestId: parsed.requestId
  });

  const imported = typeof (result as { imported?: unknown }).imported === "number"
    ? (result as { imported: number }).imported
    : cookies.length;

  return {
    success: true,
    message: `Cookies imported: ${imported}`,
    data: result
  };
}

export const __test__ = {
  parseCookieImportArgs,
  parseCookiesJson,
  resolveCookies
};
