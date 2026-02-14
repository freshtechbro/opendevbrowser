import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import { createRequestId } from "../core/logging";
import type { ToolDeps } from "./deps";
import { failure, ok, serializeError } from "./response";

const z = tool.schema;

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

type CookieImportCapableManager = {
  cookieImport?: (
    sessionId: string,
    cookies: CookieRecord[],
    strict?: boolean,
    requestId?: string
  ) => Promise<{ requestId: string; imported: number; rejected: Array<{ index: number; reason: string }> }>;
};

type CookieValidationResult = {
  valid: boolean;
  reason: string;
  cookie: CookieRecord;
};

function validateCookieRecord(cookie: CookieRecord): CookieValidationResult {
  const name = cookie.name?.trim();
  if (!name) {
    return { valid: false, reason: "Cookie name is required.", cookie };
  }
  if (!/^[^\s;=]+$/.test(name)) {
    return { valid: false, reason: `Invalid cookie name: ${cookie.name}.`, cookie };
  }

  if (typeof cookie.value !== "string") {
    return { valid: false, reason: `Invalid cookie value for ${name}.`, cookie };
  }

  const value = cookie.value;
  if (/\r|\n|;/.test(value)) {
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
    if (!/^\.?[a-z0-9.-]+$/.test(normalizedDomain)) {
      return { valid: false, reason: `Cookie ${name} has invalid domain.`, cookie };
    }
    if (normalizedDomain.includes("..")) {
      return { valid: false, reason: `Cookie ${name} has invalid domain.`, cookie };
    }
  }

  const normalizedPath = typeof cookie.path === "string" ? cookie.path.trim() : undefined;
  if (typeof normalizedPath === "string" && !normalizedPath.startsWith("/")) {
    return { valid: false, reason: `Cookie ${name} path must start with '/'.`, cookie };
  }

  if (typeof cookie.expires !== "undefined") {
    if (!Number.isFinite(cookie.expires)) {
      return { valid: false, reason: `Cookie ${name} has invalid expires.`, cookie };
    }
    if ((cookie.expires as number) < -1) {
      return { valid: false, reason: `Cookie ${name} has invalid expires.`, cookie };
    }
  }

  if (cookie.sameSite === "None" && cookie.secure !== true) {
    return { valid: false, reason: `Cookie ${name} with SameSite=None must set secure=true.`, cookie };
  }

  const normalizedCookie: CookieRecord = {
    name,
    value,
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

export function createCookieImportTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description: "Import validated cookies into the current session context.",
    args: {
      sessionId: z.string().describe("Session id"),
      cookies: z.array(z.object({
        name: z.string().min(1),
        value: z.string(),
        url: z.string().optional(),
        domain: z.string().optional(),
        path: z.string().optional(),
        expires: z.number().optional(),
        httpOnly: z.boolean().optional(),
        secure: z.boolean().optional(),
        sameSite: z.enum(["Strict", "Lax", "None"]).optional()
      })).min(1).describe("Cookies to import"),
      strict: z.boolean().optional().describe("Reject on first invalid cookie (default true)"),
      requestId: z.string().optional().describe("Optional trace request id")
    },
    async execute(args) {
      try {
        const strict = args.strict ?? true;
        const requestId = args.requestId ?? createRequestId();
        const manager = deps.manager as ToolDeps["manager"] & CookieImportCapableManager;

        const normalized: CookieRecord[] = [];
        const rejected: Array<{ index: number; reason: string }> = [];

        args.cookies.forEach((cookie, index) => {
          const validation = validateCookieRecord(cookie as CookieRecord);
          if (!validation.valid) {
            rejected.push({ index, reason: validation.reason });
            return;
          }
          normalized.push(validation.cookie);
        });

        if (typeof manager.cookieImport === "function") {
          return ok(await manager.cookieImport(args.sessionId, normalized, strict, requestId));
        }

        if (strict && rejected.length > 0) {
          return failure(`Cookie import rejected ${rejected.length} entries.`, "cookie_import_failed");
        }

        if (normalized.length > 0) {
          await deps.manager.withPage(args.sessionId, null, async (page) => {
            await page.context().addCookies(normalized);
            return undefined;
          });
        }

        return ok({
          requestId,
          imported: normalized.length,
          rejected
        });
      } catch (error) {
        return failure(serializeError(error).message, "cookie_import_failed");
      }
    }
  });
}

export const __test__ = {
  validateCookieRecord
};
