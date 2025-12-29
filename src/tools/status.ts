import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { tool } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin";
import type { ToolDeps } from "./deps";
import { failure, ok, serializeError } from "./response";

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
  try {
    const response = await fetch(`https://registry.npmjs.org/${packageName}/latest`);
    if (!response.ok) return undefined;
    const payload = await response.json() as { version?: unknown };
    return typeof payload.version === "string" ? payload.version : undefined;
  } catch (error) {
    void error;
    return undefined;
  }
}

export function createStatusTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description: "Get status of a browser session.",
    args: {
      sessionId: z.string().describe("Session id")
    },
    async execute(args) {
      try {
        const status = await deps.manager.status(args.sessionId);
        const extensionPath = deps.getExtensionPath?.() ?? null;
        const config = deps.config.get();
        const version = getPackageVersion();
        let updateHint: string | undefined;

        if (config.checkForUpdates && version) {
          const latest = await fetchLatestVersion("opendevbrowser");
          if (latest && latest !== version) {
            updateHint = `Update available: ${version} -> ${latest}`;
          }
        }
        
        return ok({
          mode: status.mode,
          activeTargetId: status.activeTargetId,
          url: status.url,
          title: status.title,
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
