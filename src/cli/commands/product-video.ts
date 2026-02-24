import type { ParsedArgs } from "../args";
import { callDaemon } from "../client";
import { createUsageError } from "../errors";
import { parseNumberFlag } from "../utils/parse";

type ProductVideoCommandArgs = {
  productUrl?: string;
  productName?: string;
  providerHint?: string;
  includeScreenshots?: boolean;
  includeAllImages?: boolean;
  includeCopy?: boolean;
  outputDir?: string;
  ttlHours?: number;
  timeoutMs?: number;
  useCookies?: boolean;
  cookiePolicyOverride?: "off" | "auto" | "required";
};

const requireValue = (rawArgs: string[], index: number, flag: string): string => {
  const value = rawArgs[index + 1];
  if (!value) {
    throw createUsageError(`Missing value for ${flag}`);
  }
  return value;
};

const parseBoolean = (value: string, flag: string): boolean => {
  if (value === "true") return true;
  if (value === "false") return false;
  throw createUsageError(`Invalid ${flag}: ${value}`);
};

const COOKIE_POLICY_VALUES = new Set(["off", "auto", "required"]);

const parseProductVideoArgs = (rawArgs: string[]): ProductVideoCommandArgs => {
  const parsed: ProductVideoCommandArgs = {};

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];

    if (arg === "--product-url") {
      parsed.productUrl = requireValue(rawArgs, index, "--product-url");
      index += 1;
      continue;
    }
    if (arg?.startsWith("--product-url=")) {
      parsed.productUrl = arg.split("=", 2)[1];
      continue;
    }

    if (arg === "--product-name") {
      parsed.productName = requireValue(rawArgs, index, "--product-name");
      index += 1;
      continue;
    }
    if (arg?.startsWith("--product-name=")) {
      parsed.productName = arg.split("=", 2)[1];
      continue;
    }

    if (arg === "--provider-hint") {
      parsed.providerHint = requireValue(rawArgs, index, "--provider-hint");
      index += 1;
      continue;
    }
    if (arg?.startsWith("--provider-hint=")) {
      parsed.providerHint = arg.split("=", 2)[1];
      continue;
    }

    if (arg === "--include-screenshots") {
      parsed.includeScreenshots = true;
      continue;
    }
    if (arg?.startsWith("--include-screenshots=")) {
      parsed.includeScreenshots = parseBoolean(arg.split("=", 2)[1] ?? "", "--include-screenshots");
      continue;
    }

    if (arg === "--include-all-images") {
      parsed.includeAllImages = true;
      continue;
    }
    if (arg?.startsWith("--include-all-images=")) {
      parsed.includeAllImages = parseBoolean(arg.split("=", 2)[1] ?? "", "--include-all-images");
      continue;
    }

    if (arg === "--include-copy") {
      parsed.includeCopy = true;
      continue;
    }
    if (arg?.startsWith("--include-copy=")) {
      parsed.includeCopy = parseBoolean(arg.split("=", 2)[1] ?? "", "--include-copy");
      continue;
    }

    if (arg === "--output-dir") {
      parsed.outputDir = requireValue(rawArgs, index, "--output-dir");
      index += 1;
      continue;
    }
    if (arg?.startsWith("--output-dir=")) {
      parsed.outputDir = arg.split("=", 2)[1];
      continue;
    }

    if (arg === "--ttl-hours") {
      parsed.ttlHours = parseNumberFlag(requireValue(rawArgs, index, "--ttl-hours"), "--ttl-hours", { min: 1, max: 168 });
      index += 1;
      continue;
    }
    if (arg?.startsWith("--ttl-hours=")) {
      parsed.ttlHours = parseNumberFlag(arg.split("=", 2)[1] ?? "", "--ttl-hours", { min: 1, max: 168 });
      continue;
    }

    if (arg === "--timeout-ms") {
      parsed.timeoutMs = parseNumberFlag(requireValue(rawArgs, index, "--timeout-ms"), "--timeout-ms", { min: 1 });
      index += 1;
      continue;
    }
    if (arg?.startsWith("--timeout-ms=")) {
      parsed.timeoutMs = parseNumberFlag(arg.split("=", 2)[1] ?? "", "--timeout-ms", { min: 1 });
      continue;
    }

    if (arg === "--use-cookies") {
      parsed.useCookies = true;
      continue;
    }
    if (arg?.startsWith("--use-cookies=")) {
      parsed.useCookies = parseBoolean(arg.split("=", 2)[1] ?? "", "--use-cookies");
      continue;
    }

    if (arg === "--cookie-policy-override" || arg === "--cookie-policy") {
      const value = requireValue(rawArgs, index, arg).toLowerCase();
      if (!COOKIE_POLICY_VALUES.has(value)) {
        throw createUsageError(`Invalid ${arg}: ${value}`);
      }
      parsed.cookiePolicyOverride = value as ProductVideoCommandArgs["cookiePolicyOverride"];
      index += 1;
      continue;
    }
    if (arg?.startsWith("--cookie-policy-override=") || arg?.startsWith("--cookie-policy=")) {
      const value = (arg.split("=", 2)[1] ?? "").toLowerCase();
      if (!COOKIE_POLICY_VALUES.has(value)) {
        throw createUsageError(`Invalid --cookie-policy-override: ${value}`);
      }
      parsed.cookiePolicyOverride = value as ProductVideoCommandArgs["cookiePolicyOverride"];
      continue;
    }
  }

  return parsed;
};

export async function runProductVideoCommand(args: ParsedArgs) {
  const [subcommand, ...rest] = args.rawArgs;
  if (subcommand !== "run") {
    throw createUsageError("Usage: opendevbrowser product-video run --product-url <url> | --product-name <name>");
  }

  const parsed = parseProductVideoArgs(rest);
  if (!parsed.productUrl && !parsed.productName) {
    throw createUsageError("Missing --product-url or --product-name");
  }

  const timeoutMs = parsed.timeoutMs ?? 120000;
  const data = await callDaemon("product.video.run", {
    product_url: parsed.productUrl,
    product_name: parsed.productName,
    provider_hint: parsed.providerHint,
    include_screenshots: parsed.includeScreenshots,
    include_all_images: parsed.includeAllImages,
    include_copy: parsed.includeCopy,
    output_dir: parsed.outputDir,
    ttl_hours: parsed.ttlHours,
    useCookies: parsed.useCookies,
    cookiePolicyOverride: parsed.cookiePolicyOverride
  }, { timeoutMs });

  return {
    success: true,
    message: "Product video asset workflow completed.",
    data
  };
}

export const __test__ = {
  parseProductVideoArgs,
  parseBoolean
};
