import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import { createRequestId } from "../core/logging";
import type { ToolDeps } from "./deps";
import { failure, ok, serializeError } from "./response";

const z = tool.schema;

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

type CookieListCapableManager = {
  cookieList?: (
    sessionId: string,
    urls?: string[],
    requestId?: string
  ) => Promise<{ requestId: string; cookies: CookieListRecord[]; count: number }>;
};

function normalizeCookieUrls(urls?: string[]): string[] | undefined {
  if (!urls || urls.length === 0) {
    return undefined;
  }

  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const value of urls) {
    const trimmed = value.trim();
    if (!trimmed) {
      throw new Error("Cookie list urls must be non-empty strings.");
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(trimmed);
    } catch {
      throw new Error(`Cookie list url is invalid: ${trimmed}`);
    }
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      throw new Error(`Cookie list url must be http(s): ${trimmed}`);
    }

    const normalizedUrl = parsedUrl.toString();
    if (seen.has(normalizedUrl)) {
      continue;
    }
    seen.add(normalizedUrl);
    normalized.push(normalizedUrl);
  }

  return normalized;
}

export function createCookieListTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description: "List cookies in the current session context with optional URL filtering.",
    args: {
      sessionId: z.string().describe("Session id"),
      urls: z.array(z.string().min(1)).optional().describe("Optional URL filters for cookie scoping"),
      requestId: z.string().optional().describe("Optional trace request id")
    },
    async execute(args) {
      try {
        const manager = deps.manager as ToolDeps["manager"] & CookieListCapableManager;
        const normalizedUrls = normalizeCookieUrls(args.urls);
        const requestId = args.requestId ?? createRequestId();

        if (typeof manager.cookieList === "function") {
          return ok(await manager.cookieList(args.sessionId, normalizedUrls, requestId));
        }

        const cookies = await deps.manager.withPage(
          args.sessionId,
          null,
          async (page) => {
            const listed = normalizedUrls
              ? await page.context().cookies(normalizedUrls)
              : await page.context().cookies();
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

        return ok({
          requestId,
          cookies,
          count: cookies.length
        });
      } catch (error) {
        return failure(serializeError(error).message, "cookie_list_failed");
      }
    }
  });
}

export const __test__ = {
  normalizeCookieUrls
};
