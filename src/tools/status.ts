import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import type { ToolDeps } from "./deps";
import { failure, ok, serializeError } from "./response";
import { fetchDaemonStatusFromMetadata } from "../cli/daemon-status";
import { isHubEnabled } from "../utils/hub-enabled";

const z = tool.schema;

function getPackageVersion(): string | undefined {
  try {
    const baseDir = dirname(fileURLToPath(import.meta.url));
    const candidates = [
      join(baseDir, "..", "..", "package.json"),
      join(baseDir, "..", "package.json")
    ];
    for (const pkgPath of candidates) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        if (typeof pkg.version === "string") {
          return pkg.version;
        }
      } catch (error) {
        void error;
      }
    }
    return undefined;
  } catch (error) {
    void error;
    return undefined;
  }
}

async function fetchLatestVersion(packageName: string): Promise<string | undefined> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`https://registry.npmjs.org/${packageName}/latest`, { signal: controller.signal });
    if (!response.ok) return undefined;
    const payload = await response.json() as { version?: unknown };
    return typeof payload.version === "string" ? payload.version : undefined;
  } catch (error) {
    console.warn("[opendevbrowser] Update check failed:", error);
    return undefined;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function createStatusTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description: "Get daemon or session status.",
    args: {
      sessionId: z.string().optional().describe("Session id (required when hub is disabled)")
    },
    async execute(args) {
      try {
        const config = deps.config.get();
        const hubEnabled = isHubEnabled(config);
        const extensionPath = deps.getExtensionPath?.() ?? null;
        const version = getPackageVersion();
        let updateHint: string | undefined;
        let sessionStatus: { mode: string; activeTargetId: string | null; url?: string; title?: string } | null = null;

        if (hubEnabled) {
          const daemonStatus = await fetchDaemonStatusFromMetadata();
          if (!daemonStatus) {
            return failure("Daemon not running. Start with `npx opendevbrowser serve`.", "status_failed");
          }
          if (args.sessionId) {
            sessionStatus = await deps.manager.status(args.sessionId);
          }

          if (config.checkForUpdates && version) {
            const latest = await fetchLatestVersion("opendevbrowser");
            if (latest && latest !== version) {
              updateHint = `Update available: ${version} -> ${latest}`;
            }
          }

          return ok({
            ...(sessionStatus ?? {}),
            daemon: daemonStatus,
            hubEnabled: true,
            extensionPath: extensionPath ?? undefined,
            version,
            updateHint
          });
        }

        if (!args.sessionId) {
          return failure("Missing sessionId for status.", "status_failed");
        }

        sessionStatus = await deps.manager.status(args.sessionId);

        if (config.checkForUpdates && version) {
          const latest = await fetchLatestVersion("opendevbrowser");
          if (latest && latest !== version) {
            updateHint = `Update available: ${version} -> ${latest}`;
          }
        }
        
        return ok({
          mode: sessionStatus.mode,
          activeTargetId: sessionStatus.activeTargetId,
          url: sessionStatus.url,
          title: sessionStatus.title,
          extensionPath: extensionPath ?? undefined,
          version,
          updateHint
        });
      } catch (error) {
        return failure(serializeError(error).message, "status_failed");
      }
    }
  });
}
