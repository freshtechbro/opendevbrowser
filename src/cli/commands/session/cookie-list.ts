import type { ParsedArgs } from "../../args";
import { callDaemon } from "../../client";
import { createUsageError } from "../../errors";

type CookieListArgs = {
  sessionId?: string;
  urls: string[];
  requestId?: string;
};

const requireValue = (value: string | undefined, flag: string): string => {
  if (!value) {
    throw createUsageError(`Missing value for ${flag}`);
  }
  return value;
};

const normalizeCookieUrls = (values: string[]): string[] => {
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(trimmed);
    } catch {
      throw createUsageError(`Invalid --url value: ${trimmed}`);
    }
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      throw createUsageError(`Invalid --url protocol: ${trimmed}`);
    }

    const normalizedUrl = parsedUrl.toString();
    if (seen.has(normalizedUrl)) {
      continue;
    }
    seen.add(normalizedUrl);
    normalized.push(normalizedUrl);
  }

  return normalized;
};

const parseCookieListArgs = (rawArgs: string[]): CookieListArgs => {
  const parsed: CookieListArgs = { urls: [] };

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

    if (arg === "--url") {
      const rawValue = requireValue(rawArgs[index + 1], "--url");
      parsed.urls.push(...rawValue.split(","));
      index += 1;
      continue;
    }
    if (arg?.startsWith("--url=")) {
      parsed.urls.push(...requireValue(arg.split("=", 2)[1], "--url").split(","));
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

  parsed.urls = normalizeCookieUrls(parsed.urls);
  return parsed;
};

export async function runCookieList(args: ParsedArgs) {
  const parsed = parseCookieListArgs(args.rawArgs);
  if (!parsed.sessionId) {
    throw createUsageError("Missing --session-id");
  }

  const result = await callDaemon("session.cookieList", {
    sessionId: parsed.sessionId,
    ...(parsed.urls.length > 0 ? { urls: parsed.urls } : {}),
    requestId: parsed.requestId
  });

  const count = typeof (result as { count?: unknown }).count === "number"
    ? (result as { count: number }).count
    : Array.isArray((result as { cookies?: unknown[] }).cookies)
      ? (result as { cookies: unknown[] }).cookies.length
      : 0;

  return {
    success: true,
    message: `Cookies listed: ${count}`,
    data: result
  };
}

export const __test__ = {
  parseCookieListArgs,
  normalizeCookieUrls
};
