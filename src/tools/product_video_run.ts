import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import { runProductVideoWorkflow } from "../providers";
import type { ToolDeps } from "./deps";
import { failure, ok, serializeError } from "./response";
import { resolveProviderRuntime } from "./workflow-runtime";

const z = tool.schema;
const cookiePolicySchema = z.enum(["off", "auto", "required"]);

async function captureScreenshotBuffer(deps: ToolDeps, url: string): Promise<Buffer | null> {
  let sessionId: string | null = null;
  try {
    const launched = await deps.manager.launch({
      headless: true,
      startUrl: url
    });
    sessionId = launched.sessionId;
    const screenshot = await deps.manager.screenshot(sessionId);
    if (typeof screenshot.base64 === "string" && screenshot.base64.length > 0) {
      return Buffer.from(screenshot.base64, "base64");
    }
    return null;
  } catch {
    return null;
  } finally {
    if (sessionId) {
      await deps.manager.disconnect(sessionId, true).catch(() => {
        // Best effort cleanup.
      });
    }
  }
}

export function createProductVideoRunTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description: "Collect a product presentation asset pack for video/UGC workflows.",
    args: {
      product_url: z.string().optional().describe("Product URL"),
      product_name: z.string().optional().describe("Product name"),
      provider_hint: z.string().optional().describe("Optional provider hint"),
      include_screenshots: z.boolean().optional().describe("Include screenshots (default true)"),
      include_all_images: z.boolean().optional().describe("Include all discovered images (default true)"),
      include_copy: z.boolean().optional().describe("Include product copy extraction (default true)"),
      output_dir: z.string().optional().describe("Optional output directory"),
      ttl_hours: z.number().int().positive().optional().describe("Artifact retention TTL in hours"),
      useCookies: z.boolean().optional().describe("Enable/disable provider cookie injection for this run"),
      cookiePolicyOverride: cookiePolicySchema.optional().describe("Override cookie policy: off|auto|required")
    },
    async execute(args) {
      try {
        const runtime = resolveProviderRuntime(deps);
        const includeScreenshots = args.include_screenshots ?? true;
        const result = await runProductVideoWorkflow(runtime, {
          product_url: args.product_url,
          product_name: args.product_name,
          provider_hint: args.provider_hint,
          include_screenshots: includeScreenshots,
          include_all_images: args.include_all_images,
          include_copy: args.include_copy,
          output_dir: args.output_dir,
          ttl_hours: args.ttl_hours,
          useCookies: args.useCookies,
          cookiePolicyOverride: args.cookiePolicyOverride
        }, {
          captureScreenshot: includeScreenshots
            ? async (url) => captureScreenshotBuffer(deps, url)
            : undefined
        });

        return ok(result);
      } catch (error) {
        return failure(serializeError(error).message, "product_video_run_failed");
      }
    }
  });
}
