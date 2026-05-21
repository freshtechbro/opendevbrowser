import { randomUUID } from "crypto";
import { mkdirSync } from "fs";
import { join } from "path";
import { resolveWorkflowArtifactRoot } from "./workflow-output-root";

export const BROWSER_SCREENSHOT_ARTIFACT_NAMESPACE = "screenshot";
export const BROWSER_SCREENCAST_ARTIFACT_NAMESPACE = "screencast";

export type BrowserOutputArtifactDirectoryInput = {
  workspaceRoot?: string;
  namespace: string;
};

export type BrowserOutputArtifactDirectory = {
  artifactPath: string;
  namespace: string;
  runId: string;
};

const SAFE_BROWSER_ARTIFACT_NAMESPACE_PATTERN = /^[a-z0-9_-]+$/;

export function createBrowserOutputArtifactDirectory(
  input: BrowserOutputArtifactDirectoryInput
): BrowserOutputArtifactDirectory {
  const namespace = input.namespace.trim();
  if (namespace.length === 0) {
    throw new Error("Browser output artifact namespace cannot be empty.");
  }
  if (!SAFE_BROWSER_ARTIFACT_NAMESPACE_PATTERN.test(namespace)) {
    throw new Error("Browser output artifact namespace can only contain lowercase letters, numbers, underscores, and hyphens.");
  }

  const root = resolveWorkflowArtifactRoot(undefined, { workspaceRoot: input.workspaceRoot });
  const runId = randomUUID();
  const artifactPath = join(root, namespace, runId);
  mkdirSync(artifactPath, { recursive: true, mode: 0o700 });

  return { artifactPath, namespace, runId };
}
