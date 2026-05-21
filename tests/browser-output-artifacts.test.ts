import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BROWSER_SCREENCAST_ARTIFACT_NAMESPACE,
  BROWSER_SCREENSHOT_ARTIFACT_NAMESPACE,
  createBrowserOutputArtifactDirectory
} from "../src/providers/browser-output-artifacts";

const cleanupPaths: string[] = [];

async function makeWorkspace(): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), "odb-browser-artifacts-"));
  cleanupPaths.push(workspace);
  return workspace;
}

afterEach(async () => {
  while (cleanupPaths.length > 0) {
    const target = cleanupPaths.pop();
    if (target) {
      await rm(target, { recursive: true, force: true });
    }
  }
});

describe("browser output artifacts", () => {
  it("creates omitted screenshot artifact directories under the workflow root", async () => {
    const workspace = await makeWorkspace();
    const artifact = createBrowserOutputArtifactDirectory({
      workspaceRoot: workspace,
      namespace: BROWSER_SCREENSHOT_ARTIFACT_NAMESPACE
    });

    expect(artifact.namespace).toBe("screenshot");
    expect(artifact.artifactPath).toBe(join(workspace, ".opendevbrowser", "screenshot", artifact.runId));
    expect((await stat(artifact.artifactPath)).isDirectory()).toBe(true);
  });

  it("creates omitted screencast artifact directories under the workflow root", async () => {
    const workspace = await makeWorkspace();
    const artifact = createBrowserOutputArtifactDirectory({
      workspaceRoot: workspace,
      namespace: BROWSER_SCREENCAST_ARTIFACT_NAMESPACE
    });

    expect(artifact.namespace).toBe("screencast");
    expect(artifact.artifactPath).toBe(join(workspace, ".opendevbrowser", "screencast", artifact.runId));
    expect((await stat(artifact.artifactPath)).isDirectory()).toBe(true);
  });

  it("rejects unsafe namespaces", async () => {
    const workspace = await makeWorkspace();

    expect(() => createBrowserOutputArtifactDirectory({
      workspaceRoot: workspace,
      namespace: "  "
    })).toThrow("Browser output artifact namespace cannot be empty.");

    expect(() => createBrowserOutputArtifactDirectory({
      workspaceRoot: workspace,
      namespace: "../escape"
    })).toThrow("Browser output artifact namespace can only contain lowercase letters, numbers, underscores, and hyphens.");
  });
});
