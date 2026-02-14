import { ProviderRuntimeError } from "../../providers/errors";
import type { MacroDefinition, MacroValue, ParsedMacro } from "../registry";

const stringArg = (parsed: ParsedMacro, key: string, position: number, required = true): string => {
  const named = parsed.named[key];
  const positional = parsed.positional[position];
  const value = named ?? positional;

  if (value === undefined || value === null || value === "") {
    if (!required) return "";
    throw new ProviderRuntimeError("invalid_input", `Macro ${parsed.name} requires argument: ${key}`, {
      retryable: false
    });
  }

  return String(value);
};

const numberArg = (parsed: ParsedMacro, key: string, position: number, fallback: number): number => {
  const value = (parsed.named[key] ?? parsed.positional[position]) as MacroValue | undefined;
  if (value === undefined) return fallback;

  const numeric = typeof value === "number" ? value : Number(value);
  if (Number.isNaN(numeric)) {
    throw new ProviderRuntimeError("invalid_input", `Macro ${parsed.name} expects numeric argument: ${key}`, {
      retryable: false
    });
  }
  return numeric;
};

const booleanArg = (parsed: ParsedMacro, key: string, position: number, fallback: boolean): boolean => {
  const value = (parsed.named[key] ?? parsed.positional[position]) as MacroValue | undefined;
  if (value === undefined) return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value === "true") return true;
    if (value === "false") return false;
  }
  throw new ProviderRuntimeError("invalid_input", `Macro ${parsed.name} expects boolean argument: ${key}`, {
    retryable: false
  });
};

export const createCoreMacroPack = (): MacroDefinition[] => {
  return [
    {
      name: "web.search",
      pack: "core:web",
      resolve: (parsed) => ({
        source: "web",
        operation: "search",
        input: {
          query: stringArg(parsed, "query", 0),
          limit: numberArg(parsed, "limit", 1, 10),
          providerId: "web/default"
        }
      })
    },
    {
      name: "web.fetch",
      pack: "core:web",
      resolve: (parsed) => ({
        source: "web",
        operation: "fetch",
        input: {
          url: stringArg(parsed, "url", 0),
          providerId: "web/default"
        }
      })
    },
    {
      name: "developer.docs",
      pack: "core:developer",
      resolve: (parsed) => {
        const topic = stringArg(parsed, "topic", 0);
        return {
          source: "web",
          operation: "search",
          input: {
            query: `site:developer.mozilla.org ${topic}`,
            limit: numberArg(parsed, "limit", 1, 10),
            providerId: "web/default"
          }
        };
      }
    },
    {
      name: "community.search",
      pack: "core:community",
      resolve: (parsed) => ({
        source: "community",
        operation: "search",
        input: {
          query: stringArg(parsed, "query", 0),
          limit: numberArg(parsed, "limit", 1, 10),
          providerId: "community/default"
        }
      })
    },
    {
      name: "community.post",
      pack: "core:community",
      resolve: (parsed) => ({
        source: "community",
        operation: "post",
        input: {
          target: stringArg(parsed, "target", 0),
          content: stringArg(parsed, "content", 1),
          confirm: booleanArg(parsed, "confirm", 2, true),
          riskAccepted: booleanArg(parsed, "riskAccepted", 3, true),
          providerId: "community/default"
        }
      })
    },
    {
      name: "media.search",
      pack: "core:media",
      resolve: (parsed) => {
        const platform = stringArg(parsed, "platform", 1, false) || "x";
        return {
          source: "social",
          operation: "search",
          input: {
            query: stringArg(parsed, "query", 0),
            limit: numberArg(parsed, "limit", 2, 10),
            platform,
            providerId: `social/${platform}`
          }
        };
      }
    },
    {
      name: "media.trend",
      pack: "core:media",
      resolve: (parsed) => {
        const platform = stringArg(parsed, "platform", 0, false) || "x";
        return {
          source: "social",
          operation: "search",
          input: {
            query: stringArg(parsed, "query", 1, false) || "trending",
            limit: numberArg(parsed, "limit", 2, 10),
            platform,
            providerId: `social/${platform}`
          }
        };
      }
    },
    {
      name: "social.post",
      pack: "core:media",
      resolve: (parsed) => {
        const platform = stringArg(parsed, "platform", 0);
        return {
          source: "social",
          operation: "post",
          input: {
            platform,
            target: stringArg(parsed, "target", 1),
            content: stringArg(parsed, "content", 2),
            confirm: booleanArg(parsed, "confirm", 3, true),
            riskAccepted: booleanArg(parsed, "riskAccepted", 4, true),
            providerId: `social/${platform}`
          }
        };
      }
    }
  ];
};
