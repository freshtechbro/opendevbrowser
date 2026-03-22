#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {
  defaultArtifactPath,
  ensureCliBuilt,
  ROOT,
  runCli,
  sleep,
  writeJson
} from "./live-direct-utils.mjs";

const GOVERNANCE = [
  { op: "governance.update", block: "intent", changes: { summary: "Direct canvas workflow validation" } },
  { op: "governance.update", block: "designLanguage", changes: { profile: "clean-room" } },
  { op: "governance.update", block: "contentModel", changes: { requiredStates: ["default", "loading", "empty", "error"] } },
  { op: "governance.update", block: "layoutSystem", changes: { grid: { columns: 12, gutter: 24 } } },
  { op: "governance.update", block: "typographySystem", changes: { hierarchy: { display: "display-01" }, fontPolicy: { primary: "Local Sans" } } },
  { op: "governance.update", block: "colorSystem", changes: { roles: { primary: "#0055ff" } } },
  { op: "governance.update", block: "surfaceSystem", changes: { panels: { elevation: "medium" } } },
  { op: "governance.update", block: "iconSystem", changes: { primary: "tabler" } } ,
  { op: "governance.update", block: "motionSystem", changes: { reducedMotion: "respect-user-preference" } },
  { op: "governance.update", block: "responsiveSystem", changes: { breakpoints: { mobile: 390, tablet: 1024, desktop: 1440 } } },
  { op: "governance.update", block: "accessibilityPolicy", changes: { reducedMotion: "respect-user-preference" } },
  { op: "governance.update", block: "libraryPolicy", changes: { icons: ["tabler"], components: ["shadcn"], styling: ["tailwindcss"], motion: [], threeD: [] } },
  { op: "governance.update", block: "runtimeBudgets", changes: { defaultLivePreviewLimit: 2, maxPinnedFullPreviewExtra: 1, reconnectGraceMs: 20000, overflowRenderMode: "thumbnail_only", backgroundTelemetryMode: "sampled" } }
];

const GENERATION_PLAN = {
  targetOutcome: { mode: "high-fi-live-edit", summary: "Validate the current /canvas workflow against a real hero scenario." },
  visualDirection: { profile: "clean-room" },
  layoutStrategy: { approach: "hero-led-grid" },
  contentStrategy: { source: "document-context" },
  componentStrategy: { mode: "reuse-first" },
  motionPosture: { level: "subtle" },
  responsivePosture: { primaryViewport: "desktop" },
  accessibilityPosture: { target: "WCAG_2_2_AA" },
  validationTargets: { blockOn: ["contrast-failure"] }
};

const SURFACE_CONFIG = {
  "managed-headless": {
    launchArgs: ["launch", "--no-extension", "--headless", "--persist-profile", "false", "--start-url", "https://example.com/?canvas-managed-headless-hero=1"],
    closeBrowser: true,
    includeInventoryHistory: true,
    includeFeedback: true,
    includePreviewOverlay: false,
    designTabMode: "none",
    codeFile: "managed-headless-hero.tsx",
    bindingId: "binding_live_managed_headless_hero",
    importedText: "Hello world",
    updatedText: "Live Canvas Ready",
    saveRepoPath: ".opendevbrowser/canvas/live-workflows/managed-headless-hero.canvas.json"
  },
  "managed-headed": {
    launchArgs: ["launch", "--no-extension", "--persist-profile", "false", "--start-url", "https://example.com/?canvas-managed-headed-hero=1"],
    closeBrowser: true,
    includeInventoryHistory: true,
    includeFeedback: true,
    includePreviewOverlay: false,
    designTabMode: "none",
    codeFile: "managed-headed-hero.tsx",
    bindingId: "binding_live_managed_headed_hero",
    importedText: "Hello headed world",
    updatedText: "Live Headed Ready",
    saveRepoPath: ".opendevbrowser/canvas/live-workflows/managed-headed-hero.canvas.json"
  },
  extension: {
    launchArgs: ["launch", "--extension-only", "--wait-for-extension", "--start-url", "https://example.com/?canvas-extension-hero=1"],
    closeBrowser: false,
    includeInventoryHistory: false,
    includeFeedback: false,
    includePreviewOverlay: true,
    designTabMode: "overlay",
    codeFile: "extension-hero.tsx",
    bindingId: "binding_live_extension_hero",
    importedText: "Hello extension world",
    updatedText: "Live Extension Ready",
    saveRepoPath: ".opendevbrowser/canvas/live-workflows/extension-hero.canvas.json"
  },
  cdp: {
    connect: true,
    connectArgs: ["connect", "--ws-endpoint", "ws://127.0.0.1:8787/cdp", "--extension-legacy"],
    gotoUrl: "https://example.com/?canvas-cdp-preview=1",
    closeBrowser: false,
    includeInventoryHistory: false,
    includeFeedback: false,
    includePreviewOverlay: true,
    designTabMode: "close-only",
    codeFile: "cdp-hero.tsx",
    bindingId: "binding_live_cdp_hero",
    importedText: "Hello cdp world",
    updatedText: "Live CDP Ready",
    saveRepoPath: ".opendevbrowser/canvas/live-workflows/cdp-hero.canvas.json"
  }
};

export const DISCONNECT_TIMEOUT_MS = 120_000;
export const DISCONNECT_WRAPPER_TIMEOUT_MS = DISCONNECT_TIMEOUT_MS + 15_000;

export function getSurfaceConfig(surface) {
  return SURFACE_CONFIG[surface] ?? null;
}

function parseArgs(argv) {
  const options = {
    surface: "",
    out: null
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--surface") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("--surface requires a value.");
      }
      options.surface = next;
      index += 1;
      continue;
    }
    if (arg.startsWith("--surface=")) {
      options.surface = arg.slice("--surface=".length);
      continue;
    }
    if (arg === "--out") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("--out requires a value.");
      }
      options.out = next;
      index += 1;
      continue;
    }
    if (arg.startsWith("--out=")) {
      options.out = arg.slice("--out=".length);
      continue;
    }
    if (arg === "--help") {
      console.log([
        "Usage: node scripts/canvas-live-workflow.mjs --surface <managed-headless|managed-headed|extension|cdp> [--out <path>]",
        "",
        "Runs the current real-life /canvas hero workflow for one surface and writes an artifact."
      ].join("\n"));
      process.exit(0);
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  if (!SURFACE_CONFIG[options.surface]) {
    throw new Error(`Unknown --surface value: ${options.surface}`);
  }

  return {
    ...options,
    out: options.out ?? defaultArtifactPath(`odb-canvas-${options.surface}-hero`)
  };
}

function canvas(command, params, timeoutMs = 60_000) {
  const payload = runCli(
    ["canvas", "--command", command, "--params", JSON.stringify(params), "--timeout-ms", String(timeoutMs)],
    { timeoutMs: Math.max(timeoutMs + 15_000, 60_000) }
  ).json;
  return payload.data.result;
}

function classifyWorkflowFailure(surface, detail) {
  const normalized = String(detail ?? "").toLowerCase();
  if (
    normalized.includes("extension not connected")
    || normalized.includes("extension relay connection failed")
    || normalized.includes("[ops_unavailable]")
    || normalized.includes("ops_unavailable")
    || normalized.includes("extension did not acknowledge ops hello")
    || normalized.includes("connect the extension")
    || normalized.includes("failed to fetch relay config")
    || normalized.includes("daemon not running")
  ) {
    return {
      status: surface === "extension" || surface === "cdp" ? "env_limited" : "fail",
      detail
    };
  }
  return { status: "fail", detail };
}

async function establishSession(config) {
  if (!config.connect) {
    const launch = runCli(config.launchArgs, { timeoutMs: 300_000 }).json;
    return {
      sessionId: launch.data.sessionId,
      activeTargetId: launch.data.activeTargetId,
      warnings: launch.data.warnings ?? [],
      mode: launch.data.mode ?? null
    };
  }

  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const connected = runCli(config.connectArgs, { timeoutMs: 300_000 }).json;
      const sessionId = connected.data.sessionId;
      runCli(
        ["goto", "--session-id", sessionId, "--url", config.gotoUrl, "--wait-until", "load", "--timeout-ms", "30000"],
        { timeoutMs: 120_000 }
      );
      const refreshed = runCli(["status", "--session-id", sessionId], { timeoutMs: 120_000 }).json;
      return {
        sessionId,
        activeTargetId: refreshed.data.activeTargetId,
        warnings: connected.data.warnings ?? [],
        mode: connected.data.mode ?? null
      };
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await sleep(2_000);
      }
    }
  }
  throw lastError ?? new Error("Unable to establish CDP session.");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const config = SURFACE_CONFIG[options.surface];
  ensureCliBuilt();

  const artifact = {
    surface: options.surface,
    artifactPath: options.out,
    steps: []
  };

  let sessionId = null;
  let disconnected = false;

  try {
    const connection = await establishSession(config);
    sessionId = connection.sessionId;
    const activeTargetId = connection.activeTargetId;
    artifact.steps.push({
      step: config.connect ? "connect" : "launch",
      sessionId,
      activeTargetId,
      mode: connection.mode,
      warnings: connection.warnings
    });

    const opened = canvas("canvas.session.open", { browserSessionId: sessionId });
    const { canvasSessionId, leaseId, documentId } = opened;
    artifact.steps.push({ step: "session.open", canvasSessionId, leaseId, documentId });

    const loaded = canvas("canvas.document.load", { canvasSessionId, leaseId, documentId });
    const page = loaded.document.pages[0];
    const pageId = page.id;
    const rootNodeId = page.rootNodeId;

    const planned = canvas("canvas.plan.set", { canvasSessionId, leaseId, generationPlan: GENERATION_PLAN });
    const governed = canvas("canvas.document.patch", {
      canvasSessionId,
      leaseId,
      baseRevision: planned.documentRevision,
      patches: GOVERNANCE
    });
    artifact.steps.push({
      step: "plan-and-governance",
      documentRevision: governed.appliedRevision,
      pageId,
      rootNodeId
    });

    const starter = canvas("canvas.starter.apply", {
      canvasSessionId,
      leaseId,
      starterId: "hero.saas-product",
      frameworkId: "Next.js"
    });
    artifact.steps.push({
      step: "starter.apply",
      starterId: starter.starterId,
      frameworkId: starter.frameworkId,
      degraded: starter.degraded ?? false,
      reason: starter.reason ?? null
    });

    if (config.includeInventoryHistory) {
      const inventory = canvas("canvas.inventory.list", { canvasSessionId });
      const metricCard = inventory.items.find((item) => item.id === "kit.dashboard.analytics-core.metric-card") ?? inventory.items[0];
      const afterStarter = canvas("canvas.document.load", { canvasSessionId, leaseId, documentId });
      const inserted = canvas("canvas.inventory.insert", {
        canvasSessionId,
        leaseId,
        baseRevision: afterStarter.documentRevision,
        itemId: metricCard.id,
        pageId,
        parentId: rootNodeId,
        x: 640,
        y: 180
      });
      const undone = canvas("canvas.history.undo", { canvasSessionId, leaseId });
      const redone = canvas("canvas.history.redo", { canvasSessionId, leaseId });
      artifact.steps.push({
        step: "inventory-history",
        inventoryItemId: metricCard.id,
        insertedOk: inserted.ok,
        undoOk: undone.ok,
        redoOk: redone.ok
      });
    }

    if (config.includeFeedback) {
      const subscription = canvas("canvas.feedback.subscribe", { canvasSessionId, categories: ["render", "code-sync"] });
      const rendered = canvas(
        "canvas.preview.render",
        { canvasSessionId, leaseId, targetId: activeTargetId, prototypeId: "proto_home_default" },
        300_000
      );
      const nextEvent = canvas(
        "canvas.feedback.next",
        { canvasSessionId, subscriptionId: subscription.subscriptionId, categories: ["render", "code-sync"], timeoutMs: 5_000 },
        15_000
      );
      const polled = canvas("canvas.feedback.poll", { canvasSessionId, categories: ["render", "code-sync"] });
      canvas("canvas.feedback.unsubscribe", { canvasSessionId, subscriptionId: subscription.subscriptionId, categories: ["render", "code-sync"] });
      artifact.steps.push({
        step: "preview-feedback",
        renderStatus: rendered.renderStatus,
        eventType: nextEvent.eventType,
        polledItems: polled.items.length
      });
    } else if (config.includePreviewOverlay) {
      const rendered = canvas(
        "canvas.preview.render",
        { canvasSessionId, leaseId, targetId: activeTargetId, prototypeId: "proto_home_default" },
        300_000
      );
      const mount = canvas("canvas.overlay.mount", {
        canvasSessionId,
        leaseId,
        targetId: activeTargetId,
        prototypeId: "proto_home_default"
      });
      const selection = canvas("canvas.overlay.select", {
        canvasSessionId,
        leaseId,
        mountId: mount.mountId,
        targetId: activeTargetId,
        nodeId: rootNodeId
      });
      const unmount = canvas("canvas.overlay.unmount", {
        canvasSessionId,
        leaseId,
        mountId: mount.mountId,
        targetId: activeTargetId
      });
      artifact.steps.push({
        step: "preview-overlay",
        renderStatus: rendered.renderStatus,
        mountId: mount.mountId,
        selectedNodeId: selection.selection?.nodeId ?? rootNodeId,
        unmounted: unmount.ok ?? false
      });
    }

    if (config.designTabMode !== "none") {
      const openedTab = canvas("canvas.tab.open", {
        canvasSessionId,
        leaseId,
        prototypeId: "proto_home_default",
        previewMode: "focused"
      });
      const designTargetId = openedTab.targetId;
      if (config.designTabMode === "overlay") {
        const mount = canvas("canvas.overlay.mount", {
          canvasSessionId,
          leaseId,
          targetId: designTargetId,
          prototypeId: "proto_home_default"
        });
        const selection = canvas("canvas.overlay.select", {
          canvasSessionId,
          leaseId,
          mountId: mount.mountId,
          targetId: designTargetId,
          nodeId: rootNodeId
        });
        const unmount = canvas("canvas.overlay.unmount", {
          canvasSessionId,
          leaseId,
          mountId: mount.mountId,
          targetId: designTargetId
        });
        const closed = canvas("canvas.tab.close", { canvasSessionId, leaseId, targetId: designTargetId });
        artifact.steps.push({
          step: "design-tab-overlay",
          designTargetId,
          previewState: openedTab.previewState ?? null,
          mountId: mount.mountId,
          selectedNodeId: selection.selection?.nodeId ?? rootNodeId,
          unmounted: unmount.ok ?? false,
          closed: closed.ok ?? false
        });
      } else {
        const closed = canvas("canvas.tab.close", { canvasSessionId, leaseId, targetId: designTargetId });
        artifact.steps.push({
          step: "design-tab",
          designTargetId,
          previewState: openedTab.previewState ?? null,
          closed: closed.ok ?? false
        });
      }
    }

    const workflowDir = path.join(ROOT, ".opendevbrowser", "canvas", "live-workflows");
    fs.mkdirSync(workflowDir, { recursive: true });
    const codePath = path.join(workflowDir, config.codeFile);
    fs.writeFileSync(
      codePath,
      [
        "export function Hero() {",
        `  return <section className="hero-shell"><span>${config.importedText}</span></section>;`,
        "}",
        ""
      ].join("\n")
    );

    const bound = canvas("canvas.code.bind", {
      canvasSessionId,
      leaseId,
      nodeId: rootNodeId,
      bindingId: config.bindingId,
      repoPath: path.relative(ROOT, codePath),
      exportName: "Hero",
      syncMode: "manual"
    }, 300_000);
    const pulled = canvas("canvas.code.pull", { canvasSessionId, leaseId, bindingId: config.bindingId }, 300_000);
    const afterPull = canvas("canvas.document.load", { canvasSessionId, leaseId, documentId });
    const importedTextNode = afterPull.document.pages
      .flatMap((entry) => entry.nodes ?? [])
      .find((node) => typeof node?.props?.text === "string" && node.props.text.includes(config.importedText));
    if (!importedTextNode?.id) {
      throw new Error(`No imported text node found after canvas.code.pull for surface ${options.surface}`);
    }
    const patched = canvas("canvas.document.patch", {
      canvasSessionId,
      leaseId,
      baseRevision: afterPull.documentRevision,
      patches: [{ op: "node.update", nodeId: importedTextNode.id, changes: { "props.text": config.updatedText } }]
    });
    const pushed = canvas("canvas.code.push", { canvasSessionId, leaseId, bindingId: config.bindingId }, 300_000);
    const codeStatus = canvas("canvas.code.status", { canvasSessionId, bindingId: config.bindingId });
    const updatedSource = fs.readFileSync(codePath, "utf8");
    artifact.steps.push({
      step: "code-sync",
      bindState: bound.bindingStatus.state,
      pullOk: pulled.ok,
      patchedRevision: patched.appliedRevision,
      pushOk: pushed.ok,
      codeSyncState: codeStatus.codeSyncState ?? null,
      sourceHasUpdatedText: updatedSource.includes(config.updatedText)
    });

    const exported = canvas("canvas.document.export", { canvasSessionId, leaseId, exportTarget: "html_bundle" }, 300_000);
    const saved = canvas("canvas.document.save", { canvasSessionId, leaseId, repoPath: config.saveRepoPath }, 300_000);
    const unbound = canvas("canvas.code.unbind", { canvasSessionId, leaseId, bindingId: config.bindingId });
    const closed = canvas("canvas.session.close", { canvasSessionId, leaseId });
    const disconnectArgs = ["disconnect", "--session-id", sessionId, ...(config.closeBrowser ? ["--close-browser"] : [])];
    const disconnectedRun = runCli(disconnectArgs, { timeoutMs: DISCONNECT_WRAPPER_TIMEOUT_MS });
    disconnected = true;
    artifact.steps.push({
      step: "export-save-close",
      exportArtifactRefs: exported.artifactRefs ?? [],
      savedRepoPath: saved.repoPath,
      unbindOk: unbound.ok ?? true,
      closeOk: closed.ok ?? true,
      disconnectStatus: disconnectedRun.status
    });

    artifact.status = "pass";
    artifact.ok = true;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const classified = classifyWorkflowFailure(options.surface, detail);
    artifact.status = classified.status;
    artifact.ok = classified.status !== "fail";
    artifact.detail = classified.detail;
    artifact.error = detail;
    if (!artifact.ok) {
      process.exitCode = 1;
    }
  } finally {
    if (sessionId && !disconnected) {
      const disconnectArgs = ["disconnect", "--session-id", sessionId, ...(config.closeBrowser ? ["--close-browser"] : [])];
      runCli(disconnectArgs, { allowFailure: true, timeoutMs: DISCONNECT_WRAPPER_TIMEOUT_MS });
    }
    writeJson(options.out, artifact);
    console.log(JSON.stringify({
      ok: artifact.ok === true,
      status: artifact.status ?? (artifact.ok === true ? "pass" : "fail"),
      detail: artifact.detail ?? null,
      artifactPath: options.out,
      summary: artifact
    }, null, 2));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

export { parseArgs };
