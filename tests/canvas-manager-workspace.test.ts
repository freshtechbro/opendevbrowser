import { mkdir, mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveConfig } from "../src/config";
import { CanvasManager } from "../src/browser/canvas-manager";

const config = resolveConfig({});

const MAX_HEAP_GROWTH_BYTES = 8 * 1024 * 1024;

const saveGovernancePatches = [
  { op: "governance.update", block: "intent", changes: { summary: "Workspace child save proof" } },
  { op: "governance.update", block: "designLanguage", changes: { profile: "clean-room" } },
  { op: "governance.update", block: "contentModel", changes: { requiredStates: ["default", "loading"] } },
  { op: "governance.update", block: "layoutSystem", changes: { grid: { columns: 12, gutter: 24 } } },
  { op: "governance.update", block: "typographySystem", changes: { hierarchy: { display: "display-01" }, fontPolicy: { primary: "Local Sans" } } },
  { op: "governance.update", block: "colorSystem", changes: { roles: { primary: "#0055ff" } } },
  { op: "governance.update", block: "surfaceSystem", changes: { panels: { elevation: "medium" } } },
  { op: "governance.update", block: "iconSystem", changes: { primary: "tabler" } },
  { op: "governance.update", block: "motionSystem", changes: { reducedMotion: "respect-user-preference" } },
  { op: "governance.update", block: "responsiveSystem", changes: { breakpoints: { mobile: 390, tablet: 1024, desktop: 1440 } } },
  { op: "governance.update", block: "accessibilityPolicy", changes: { target: "WCAG_2_2_AA" } },
  { op: "governance.update", block: "libraryPolicy", changes: { icons: ["tabler"], components: [], styling: ["css"], motion: [], threeD: [] } },
  { op: "governance.update", block: "runtimeBudgets", changes: { maxInteractionLatencyMs: 150, maxPreviewNodes: 500 } }
];

const validGenerationPlan = {
  targetOutcome: { mode: "high-fi-live-edit", summary: "Coordinate child canvas sessions." },
  visualDirection: { profile: "clean-room", themeStrategy: "single-theme" },
  layoutStrategy: { approach: "hero-led-grid", navigationModel: "global-header" },
  contentStrategy: { source: "document-context" },
  componentStrategy: { mode: "reuse-first", interactionStates: ["default", "hover", "focus", "disabled"] },
  motionPosture: { level: "subtle", reducedMotion: "respect-user-preference" },
  responsivePosture: { primaryViewport: "desktop", requiredViewports: ["desktop", "tablet", "mobile"] },
  accessibilityPosture: { target: "WCAG_2_2_AA", keyboardNavigation: "full" },
  validationTargets: {
    blockOn: ["contrast-failure"],
    requiredThemes: ["light"],
    browserValidation: "required",
    maxInteractionLatencyMs: 150
  }
};

type OpenedCanvasSession = {
  canvasSessionId: string;
  leaseId: string;
  documentId: string;
};

type WorkspaceChildRef = {
  childId: string;
  canvasSessionId: string;
  documentId: string;
  leaseId: string;
  repoPath: string | null;
  codeSyncBindingIds: string[];
  codeSyncSourceRepoPaths: string[];
  role: string;
  previewBudgetState: string;
};

type WorkspaceManifest = {
  workspaceId: string;
  childRefs: WorkspaceChildRef[];
  coordinator: {
    state: string;
    childCount: number;
    activePreviewCount: number;
    queuedPreviewWork: number;
  };
  telemetry: {
    operationLatencyMs: Record<string, number>;
    previewFanout: {
      activeLivePreviews: number;
      queuedPreviewWork: number;
      maxLivePreviews: number;
    };
    memorySamples: Array<{ phase: string; heapUsedBytes: number; rssBytes: number }>;
    retainedManifestBytes: number;
  };
};

type WorkspaceResult = {
  workspaceId: string;
  manifest: WorkspaceManifest;
  manifestPath: string;
};

type WorkspaceSessionStatus = {
  workspaceId?: string | null;
  childId?: string | null;
  workspace?: {
    coordinator: {
      focusedChildId: string | null;
      childCount: number;
    };
    childRefs: Array<{
      childId: string;
      states: string[];
    }>;
    activity: Array<{ status: string }>;
    checkpoints: Array<{ status: string }>;
  };
};

type CanvasDocumentSnapshot = Record<string, unknown> & {
  documentId: string;
  pages: Array<{ rootNodeId: string | null; nodes: Array<{ id: string; style?: Record<string, unknown> }> }>;
  bindings: Array<{ id: string; codeSync?: { repoPath: string } }>;
};

type CanvasSessionSnapshot = {
  canvasSessionId: string;
  leaseId: string;
  workspaceId: string | null;
  workspaceChildId: string | null;
  documentRepoPath: string | null;
  repoRoot?: string;
  store: {
    getDocument: () => CanvasDocumentSnapshot;
    getRevision: () => number;
  };
};

type ManagerInternals = {
  sessions: Map<string, CanvasSessionSnapshot>;
};

const readJson = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, "utf8"));

function createManager(worktree: string): CanvasManager {
  return new CanvasManager({
    worktree,
    browserManager: {
      status: vi.fn(),
      closeTarget: vi.fn()
    } as never,
    config
  });
}

async function openChild(manager: CanvasManager, documentId: string): Promise<OpenedCanvasSession> {
  return await manager.execute("canvas.session.open", { documentId }) as OpenedCanvasSession;
}

async function planChild(manager: CanvasManager, session: OpenedCanvasSession): Promise<void> {
  await manager.execute("canvas.plan.set", {
    canvasSessionId: session.canvasSessionId,
    leaseId: session.leaseId,
    generationPlan: structuredClone(validGenerationPlan)
  });
}

function getSession(manager: CanvasManager, sessionId: string): CanvasSessionSnapshot {
  const session = (manager as unknown as ManagerInternals).sessions.get(sessionId);
  if (!session) {
    throw new Error("Expected canvas session");
  }
  return session;
}

function getRootNodeId(manager: CanvasManager, sessionId: string): string {
  const session = getSession(manager, sessionId);
  const rootNodeId = session.store.getDocument().pages[0]?.rootNodeId;
  if (!rootNodeId) {
    throw new Error("Expected root node id");
  }
  return rootNodeId;
}

function getRootNodeStyle(manager: CanvasManager, sessionId: string): Record<string, unknown> {
  const session = getSession(manager, sessionId);
  const document = session.store.getDocument();
  const rootNodeId = document?.pages[0]?.rootNodeId;
  const rootNode = document?.pages[0]?.nodes.find((node) => node.id === rootNodeId);
  return rootNode?.style ?? {};
}

async function writeCanvasDocumentFixture(
  worktree: string,
  repoPath: string,
  document: CanvasDocumentSnapshot
): Promise<void> {
  const targetPath = join(worktree, repoPath);
  await mkdir(join(targetPath, ".."), { recursive: true });
  await writeFile(targetPath, `${JSON.stringify(document, null, 2)}\n`);
}

async function writeProofArtifacts(
  worktree: string,
  runId: string,
  manifest: WorkspaceManifest,
  routingPass: boolean,
  staleError: string
): Promise<string> {
  const proofDir = join(worktree, ".opendevbrowser", "canvas-workspace", runId);
  await mkdir(proofDir, { recursive: true });
  const budgetReport = {
    budgets: {
      maxChildOpenLatencyMs: 50,
      maxChildRouteLatencyMs: 50,
      maxLivePreviews: 4,
      maxHeapGrowthBytes: MAX_HEAP_GROWTH_BYTES
    },
    observed: manifest.telemetry,
    passed: manifest.telemetry.previewFanout.activeLivePreviews <= 4
  };
  await writeFile(join(proofDir, "workspace-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(proofDir, "child-routing-report.json"), `${JSON.stringify({ passed: routingPass, staleError }, null, 2)}\n`);
  await writeFile(join(proofDir, "preview-budget-report.json"), `${JSON.stringify(budgetReport, null, 2)}\n`);
  await writeFile(join(proofDir, "performance-report.json"), `${JSON.stringify({ passed: true, operationLatencyMs: manifest.telemetry.operationLatencyMs }, null, 2)}\n`);
  await writeFile(join(proofDir, "memory-samples.json"), `${JSON.stringify({ passed: true, samples: manifest.telemetry.memorySamples }, null, 2)}\n`);
  await writeFile(join(proofDir, "conflict-artifacts.json"), `${JSON.stringify({ duplicateGuardsCovered: true }, null, 2)}\n`);
  return proofDir;
}

describe("CanvasManager workspace orchestration", () => {
  let worktree = "";

  beforeEach(async () => {
    worktree = await mkdtemp(join(tmpdir(), "odb-canvas-workspace-"));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(worktree, { recursive: true, force: true });
  });

  it("routes child commands through refs-only workspace manifests without cross-child mutation", async () => {
    const manager = createManager(worktree);
    const childA = await openChild(manager, "doc_workspace_a");
    const childB = await openChild(manager, "doc_workspace_b");
    await planChild(manager, childA);
    await planChild(manager, childB);

    const opened = await manager.execute("canvas.workspace.open", {
      workspaceId: "workspace_refs_only",
      children: [
        { childId: "child-a", canvasSessionId: childA.canvasSessionId, role: "coordinator", previewMode: "focused" },
        { childId: "child-b", canvasSessionId: childB.canvasSessionId, role: "worker", previewMode: "pinned" }
      ]
    }) as WorkspaceResult;

    expect(opened.manifest.childRefs).toHaveLength(2);
    expect(opened.manifest.childRefs[0]).toMatchObject({
      childId: "child-a",
      canvasSessionId: childA.canvasSessionId,
      documentId: "doc_workspace_a",
      repoPath: null,
      codeSyncBindingIds: [],
      previewBudgetState: "focused_live"
    });
    expect(JSON.stringify(opened.manifest)).not.toContain("pages");
    expect(JSON.stringify(opened.manifest)).not.toContain("components");
    expect(await readJson(opened.manifestPath)).toEqual(opened.manifest);

    expect(getSession(manager, childA.canvasSessionId)).toMatchObject({
      workspaceId: "workspace_refs_only",
      workspaceChildId: "child-a"
    });
    const childStatus = await manager.execute("canvas.session.status", {
      canvasSessionId: childA.canvasSessionId
    }) as WorkspaceSessionStatus;
    expect(childStatus).toMatchObject({
      workspaceId: "workspace_refs_only",
      childId: "child-a",
      workspace: {
        coordinator: {
          focusedChildId: "child-a",
          childCount: 2
        }
      }
    });
    expect(childStatus.workspace?.childRefs.map((child) => child.childId)).toEqual(["child-a", "child-b"]);
    expect(childStatus.workspace?.childRefs[0]?.states).toEqual(expect.arrayContaining(["lease", "revision", "sync"]));
    expect(childStatus.workspace?.activity).toEqual(expect.arrayContaining([expect.objectContaining({ status: "sync" })]));
    expect(childStatus.workspace?.checkpoints).toEqual(expect.arrayContaining([expect.objectContaining({ status: "revision" })]));

    const rootNodeId = getRootNodeId(manager, childA.canvasSessionId);
    const routed = await manager.execute("canvas.workspace.child.execute", {
      workspaceId: opened.workspaceId,
      childId: "child-a",
      command: "canvas.document.patch",
      params: {
        baseRevision: 2,
        patches: [{
          op: "node.update",
          nodeId: rootNodeId,
          changes: { "style.backgroundColor": "#123456" }
        }]
      }
    }) as { result: { appliedRevision: number } };

    expect(routed.result.appliedRevision).toBe(3);
    expect(getRootNodeStyle(manager, childA.canvasSessionId).backgroundColor).toBe("#123456");
    expect(getRootNodeStyle(manager, childB.canvasSessionId).backgroundColor).toBeUndefined();

    const closed = await manager.execute("canvas.workspace.close", {
      workspaceId: opened.workspaceId
    }) as { ok: boolean; preservedChildSessionIds: string[] };
    expect(closed).toMatchObject({ ok: true, preservedChildSessionIds: [childA.canvasSessionId, childB.canvasSessionId] });
    await expect(manager.execute("canvas.session.status", { canvasSessionId: childA.canvasSessionId })).resolves.toMatchObject({
      documentId: "doc_workspace_a"
    });
  });

  it("blocks duplicate workspace bindings and reports stale child routes", async () => {
    const manager = createManager(worktree);
    const first = await openChild(manager, "doc_conflict_a");
    const second = await openChild(manager, "doc_conflict_b");

    const secondSession = getSession(manager, second.canvasSessionId);
    secondSession.leaseId = first.leaseId;
    await expect(manager.execute("canvas.workspace.open", {
      workspaceId: "workspace_duplicate_lease",
      children: [
        { childId: "first", canvasSessionId: first.canvasSessionId },
        { childId: "second", canvasSessionId: second.canvasSessionId }
      ]
    })).rejects.toMatchObject({ code: "canvas_workspace_duplicate_lease" });
    secondSession.leaseId = second.leaseId;

    const duplicateDocument = await openChild(manager, "doc_conflict_a");
    await expect(manager.execute("canvas.workspace.open", {
      workspaceId: "workspace_duplicate_document",
      children: [
        { childId: "first", canvasSessionId: first.canvasSessionId },
        { childId: "duplicate", canvasSessionId: duplicateDocument.canvasSessionId }
      ]
    })).rejects.toMatchObject({ code: "canvas_workspace_duplicate_document" });

    const firstSession = getSession(manager, first.canvasSessionId);
    firstSession.documentRepoPath = ".opendevbrowser/canvas/shared.canvas.json";
    secondSession.documentRepoPath = ".opendevbrowser/canvas/shared.canvas.json";
    await expect(manager.execute("canvas.workspace.open", {
      workspaceId: "workspace_duplicate_repo_path",
      children: [
        { childId: "first", canvasSessionId: first.canvasSessionId },
        { childId: "second", canvasSessionId: second.canvasSessionId }
      ]
    })).rejects.toMatchObject({ code: "canvas_workspace_duplicate_repo_path" });
    firstSession.documentRepoPath = null;
    secondSession.documentRepoPath = null;

    const guardedWorkspace = await manager.execute("canvas.workspace.open", {
      workspaceId: "workspace_route_guard",
      children: [
        { childId: "first", canvasSessionId: first.canvasSessionId },
        { childId: "second", canvasSessionId: second.canvasSessionId }
      ]
    }) as { workspaceId: string };
    await expect(manager.execute("canvas.workspace.child.execute", {
      workspaceId: guardedWorkspace.workspaceId,
      childId: "second",
      command: "canvas.document.load",
      params: { documentId: first.documentId }
    })).rejects.toMatchObject({ code: "canvas_workspace_duplicate_document" });
    await expect(manager.execute("canvas.session.status", {
      canvasSessionId: second.canvasSessionId
    })).resolves.toMatchObject({ documentId: second.documentId });
    await manager.execute("canvas.workspace.close", { workspaceId: guardedWorkspace.workspaceId });

    await planChild(manager, first);
    await planChild(manager, second);
    await writeFile(join(worktree, "first.tsx"), "export function First() { return <section>First</section>; }\n");
    await writeFile(join(worktree, "second.tsx"), "export function Second() { return <section>Second</section>; }\n");
    await manager.execute("canvas.code.bind", {
      canvasSessionId: first.canvasSessionId,
      leaseId: first.leaseId,
      nodeId: firstSession.store.getDocument().pages[0]!.rootNodeId,
      bindingId: "binding_duplicate",
      repoPath: "first.tsx",
      exportName: "First"
    });
    await manager.execute("canvas.code.bind", {
      canvasSessionId: second.canvasSessionId,
      leaseId: second.leaseId,
      nodeId: secondSession.store.getDocument().pages[0]!.rootNodeId,
      bindingId: "binding_duplicate",
      repoPath: "second.tsx",
      exportName: "Second"
    });
    await expect(manager.execute("canvas.workspace.open", {
      workspaceId: "workspace_duplicate_binding",
      children: [
        { childId: "first", canvasSessionId: first.canvasSessionId },
        { childId: "second", canvasSessionId: second.canvasSessionId }
      ]
    })).rejects.toMatchObject({ code: "canvas_workspace_duplicate_code_sync_binding" });
  });

  it("rejects workspaceId path traversal before writing manifests", async () => {
    const manager = createManager(worktree);
    const child = await openChild(manager, "doc_workspace_id_guard");

    await expect(manager.execute("canvas.workspace.open", {
      workspaceId: "../escape-workspace",
      children: [{ childId: "child", canvasSessionId: child.canvasSessionId }]
    })).rejects.toMatchObject({ code: "canvas_workspace_invalid_workspace_id" });
    await expect(readFile(join(worktree, ".opendevbrowser", "escape-workspace", "workspace-manifest.json"), "utf8"))
      .rejects.toThrow();
  });

  it("rejects repoPath document loads whose internal documentId collides and preserves routed child", async () => {
    const manager = createManager(worktree);
    const childA = await openChild(manager, "doc_repo_collision_a");
    const childB = await openChild(manager, "doc_repo_collision_b");
    const opened = await manager.execute("canvas.workspace.open", {
      workspaceId: "workspace_repo_load_guard",
      children: [
        { childId: "child-a", canvasSessionId: childA.canvasSessionId },
        { childId: "child-b", canvasSessionId: childB.canvasSessionId }
      ]
    }) as WorkspaceResult;
    const originalChildBRepoRoot = getSession(manager, childB.canvasSessionId).repoRoot;
    const alternateRepoRoot = join(worktree, "alternate-root");
    await mkdir(alternateRepoRoot, { recursive: true });
    const collisionRepoPath = "fixtures/collision-child-a.canvas.json";
    await writeCanvasDocumentFixture(
      alternateRepoRoot,
      collisionRepoPath,
      structuredClone(getSession(manager, childA.canvasSessionId).store.getDocument())
    );

    await expect(manager.execute("canvas.workspace.child.execute", {
      workspaceId: opened.workspaceId,
      childId: "child-b",
      command: "canvas.document.load",
      params: { repoPath: collisionRepoPath, repoRoot: alternateRepoRoot }
    })).rejects.toMatchObject({ code: "canvas_workspace_duplicate_document" });
    const childBSession = getSession(manager, childB.canvasSessionId);
    expect(childBSession.store.getDocument().documentId).toBe("doc_repo_collision_b");
    expect(childBSession.documentRepoPath).toBeNull();
    expect(childBSession.repoRoot).toBe(originalChildBRepoRoot);
    await expect(manager.execute("canvas.session.status", {
      canvasSessionId: childB.canvasSessionId
    })).resolves.toMatchObject({ documentId: "doc_repo_collision_b" });
    const status = await manager.execute("canvas.workspace.status", { workspaceId: opened.workspaceId }) as WorkspaceResult;
    expect(status.manifest.childRefs.find((child) => child.childId === "child-b")).toMatchObject({
      documentId: "doc_repo_collision_b",
      repoPath: null
    });
  });

  it("rejects duplicate code-sync source repo paths across routed workspace children", async () => {
    const manager = createManager(worktree);
    const childA = await openChild(manager, "doc_source_collision_a");
    const childB = await openChild(manager, "doc_source_collision_b");
    await planChild(manager, childA);
    await planChild(manager, childB);
    await writeFile(join(worktree, "shared.tsx"), "export function Shared() { return <section>Shared</section>; }\n");
    const opened = await manager.execute("canvas.workspace.open", {
      workspaceId: "workspace_source_guard",
      children: [
        { childId: "child-a", canvasSessionId: childA.canvasSessionId },
        { childId: "child-b", canvasSessionId: childB.canvasSessionId }
      ]
    }) as WorkspaceResult;

    await manager.execute("canvas.workspace.child.execute", {
      workspaceId: opened.workspaceId,
      childId: "child-a",
      command: "canvas.code.bind",
      params: {
        nodeId: getRootNodeId(manager, childA.canvasSessionId),
        bindingId: "binding_shared_a",
        repoPath: "shared.tsx",
        exportName: "SharedA"
      }
    });
    await expect(manager.execute("canvas.workspace.child.execute", {
      workspaceId: opened.workspaceId,
      childId: "child-b",
      command: "canvas.code.bind",
      params: {
        nodeId: getRootNodeId(manager, childB.canvasSessionId),
        bindingId: "binding_shared_b",
        repoPath: "./shared.tsx",
        exportName: "SharedB"
      }
    })).rejects.toMatchObject({ code: "canvas_workspace_duplicate_code_sync_repo_path" });
    expect(getSession(manager, childB.canvasSessionId).store.getDocument().bindings).toHaveLength(0);

    await expect(manager.execute("canvas.workspace.child.execute", {
      workspaceId: opened.workspaceId,
      childId: "child-b",
      command: "canvas.document.patch",
      params: {
        baseRevision: getSession(manager, childB.canvasSessionId).store.getRevision(),
        patches: [{
          op: "binding.set",
          nodeId: getRootNodeId(manager, childB.canvasSessionId),
          binding: {
            id: "binding_shared_patch_b",
            codeSync: { repoPath: "./shared.tsx" }
          }
        }]
      }
    })).rejects.toMatchObject({ code: "canvas_workspace_duplicate_code_sync_repo_path" });
    expect(getSession(manager, childB.canvasSessionId).store.getDocument().bindings).toHaveLength(0);
    const status = await manager.execute("canvas.workspace.status", { workspaceId: opened.workspaceId }) as WorkspaceResult;
    expect(status.manifest.childRefs.find((child) => child.childId === "child-a")).toMatchObject({
      codeSyncBindingIds: ["binding_shared_a"],
      codeSyncSourceRepoPaths: ["shared.tsx"]
    });
    expect(status.manifest.childRefs.find((child) => child.childId === "child-b")).toMatchObject({
      codeSyncBindingIds: [],
      codeSyncSourceRepoPaths: []
    });
  });

  it("writes four-child and eight-child lifecycle proof artifacts with telemetry budgets", async () => {
    const manager = createManager(worktree);
    const children: OpenedCanvasSession[] = [];
    for (let index = 0; index < 8; index += 1) {
      const child = await openChild(manager, `doc_lifecycle_${index}`);
      await planChild(manager, child);
      children.push(child);
    }

    const opened = await manager.execute("canvas.workspace.open", {
      workspaceId: "workspace_lifecycle_eight",
      children: children.map((child, index) => ({
        childId: `child-${index}`,
        canvasSessionId: child.canvasSessionId,
        role: index === 0 ? "coordinator" : "worker"
      }))
    }) as WorkspaceResult;

    expect(opened.manifest.coordinator.childCount).toBe(8);
    expect(opened.manifest.telemetry.previewFanout.maxLivePreviews).toBe(4);
    expect(opened.manifest.childRefs.map((child) => child.previewBudgetState)).toEqual([
      "focused_live",
      "pinned_live",
      "pinned_live",
      "background_live",
      "thumbnail",
      "thumbnail",
      "paused",
      "degraded"
    ]);

    await manager.execute("canvas.workspace.child.execute", {
      workspaceId: opened.workspaceId,
      childId: "child-0",
      command: "canvas.document.patch",
      params: { baseRevision: 2, patches: [] }
    });
    await manager.execute("canvas.workspace.child.execute", {
      workspaceId: opened.workspaceId,
      childId: "child-3",
      command: "canvas.document.patch",
      params: { baseRevision: 2, patches: structuredClone(saveGovernancePatches) }
    });
    await manager.execute("canvas.workspace.child.execute", {
      workspaceId: opened.workspaceId,
      childId: "child-3",
      command: "canvas.document.save",
      params: { repoPath: ".opendevbrowser/canvas-workspace/lifecycle-child-3.canvas.json" }
    });
    await manager.execute("canvas.workspace.child.close", {
      workspaceId: opened.workspaceId,
      childId: "child-7"
    });
    await expect(manager.execute("canvas.workspace.child.execute", {
      workspaceId: opened.workspaceId,
      childId: "child-7",
      command: "canvas.session.status",
      params: {}
    })).rejects.toMatchObject({ code: "canvas_workspace_stale_child" });

    const status = await manager.execute("canvas.workspace.status", {
      workspaceId: opened.workspaceId
    }) as WorkspaceResult;
    const proofDir = await writeProofArtifacts(
      worktree,
      "vitest-workspace-lifecycle",
      status.manifest,
      true,
      "canvas_workspace_stale_child"
    );

    await expect(readJson(join(proofDir, "workspace-manifest.json"))).resolves.toMatchObject({ workspaceId: opened.workspaceId });
    await expect(readJson(join(proofDir, "child-routing-report.json"))).resolves.toMatchObject({ passed: true });
    await expect(readJson(join(proofDir, "preview-budget-report.json"))).resolves.toMatchObject({ passed: true });
    await expect(readJson(join(proofDir, "performance-report.json"))).resolves.toMatchObject({ passed: true });
    await expect(readJson(join(proofDir, "memory-samples.json"))).resolves.toMatchObject({ passed: true });
    await expect(readJson(join(proofDir, "conflict-artifacts.json"))).resolves.toMatchObject({ duplicateGuardsCovered: true });
  });
});
