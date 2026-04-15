#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {
  CANVAS_CDP_CODE_SYNC_STEP_TIMEOUT_MS,
  CANVAS_CDP_LONG_STEP_TIMEOUT_MS,
  CANVAS_CDP_PARENT_WATCHDOG_MS,
  CANVAS_CDP_TEARDOWN_RESERVE_MS,
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

export const GENERATION_PLAN = {
  targetOutcome: { mode: "high-fi-live-edit", summary: "Validate the current /canvas workflow against a real hero scenario." },
  visualDirection: { profile: "clean-room", themeStrategy: "single-theme" },
  layoutStrategy: { approach: "hero-led-grid", navigationModel: "global-header" },
  contentStrategy: { source: "document-context" },
  componentStrategy: { mode: "reuse-first", interactionStates: ["default", "hover", "focus", "disabled"] },
  motionPosture: { level: "subtle", reducedMotion: "respect-user-preference" },
  responsivePosture: { primaryViewport: "desktop", requiredViewports: ["desktop", "tablet", "mobile"] },
  accessibilityPosture: { target: "WCAG_2_2_AA", keyboardNavigation: "full" },
  validationTargets: {
    blockOn: ["contrast-failure", "responsive-mismatch"],
    requiredThemes: ["light"],
    browserValidation: "required",
    maxInteractionLatencyMs: 180
  }
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
    workflowTargetUrl: "https://example.com/?canvas-extension-hero=1",
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
    connectArgs: ["connect", "--ws-endpoint", "ws://127.0.0.1:8787/cdp", "--extension-legacy", "--start-url", "https://example.com/?canvas-cdp-preview=1"],
    workflowTargetUrl: "https://example.com/?canvas-cdp-preview=1",
    connectAttempts: 2,
    connectTimeoutMs: 45_000,
    statusTimeoutMs: 15_000,
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

export const CDP_PARENT_WATCHDOG_MS = CANVAS_CDP_PARENT_WATCHDOG_MS;
export const CDP_LONG_STEP_TIMEOUT_MS = CANVAS_CDP_LONG_STEP_TIMEOUT_MS;
export const CDP_CODE_SYNC_STEP_TIMEOUT_MS = CANVAS_CDP_CODE_SYNC_STEP_TIMEOUT_MS;
export const CDP_TEARDOWN_RESERVE_MS = CANVAS_CDP_TEARDOWN_RESERVE_MS;
export const DISCONNECT_TIMEOUT_MS = 120_000;
export const DISCONNECT_WRAPPER_TIMEOUT_MS = DISCONNECT_TIMEOUT_MS + 15_000;

export function getSurfaceConfig(surface) {
  return SURFACE_CONFIG[surface] ?? null;
}

export function resolveCanvasWorkflowTargetId({
  surface,
  capturedTargetId,
  activeTargetId,
  targets,
  preferCaptured = false
}) {
  if (surface !== "extension" && surface !== "cdp") {
    return capturedTargetId ?? null;
  }

  const targetIds = Array.isArray(targets)
    ? targets
      .map((target) => typeof target?.targetId === "string" ? target.targetId : null)
      .filter((targetId) => typeof targetId === "string" && targetId.length > 0)
    : [];

  if (preferCaptured && typeof capturedTargetId === "string" && targetIds.includes(capturedTargetId)) {
    return capturedTargetId;
  }
  if (typeof activeTargetId === "string" && targetIds.includes(activeTargetId)) {
    return activeTargetId;
  }
  if (typeof capturedTargetId === "string" && targetIds.includes(capturedTargetId)) {
    return capturedTargetId;
  }
  return targetIds[0] ?? null;
}

export function shouldCreateCanvasWorkflowTarget({ surface, targetId, createUrl }) {
  return surface === "cdp"
    && !targetId
    && typeof createUrl === "string"
    && createUrl.length > 0;
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

function updateArtifactCheckpoint(outPath, artifact, currentStep) {
  if (currentStep) {
    artifact.currentStep = currentStep;
  } else {
    delete artifact.currentStep;
  }
  writeJson(outPath, artifact);
}

export function resolveWorkflowTimeout({
  surface,
  startedAtMs,
  requestedTimeoutMs,
  stepName,
  currentTimeMs = Date.now()
}) {
  if (surface !== "cdp") {
    return requestedTimeoutMs;
  }
  const remaining = CDP_PARENT_WATCHDOG_MS - CDP_TEARDOWN_RESERVE_MS - (currentTimeMs - startedAtMs);
  if (remaining < 5_000) {
    throw new Error(`CDP workflow budget exhausted before ${stepName}.`);
  }
  const stepBudget = (stepName.startsWith("code.") || stepName === "document.patch.code")
    ? CDP_CODE_SYNC_STEP_TIMEOUT_MS
    : CDP_LONG_STEP_TIMEOUT_MS;
  return Math.min(requestedTimeoutMs, stepBudget, remaining);
}

function resolveDisconnectTimeout(surface, startedAtMs, currentTimeMs = Date.now()) {
  if (surface !== "cdp") {
    return DISCONNECT_WRAPPER_TIMEOUT_MS;
  }
  const remaining = CDP_PARENT_WATCHDOG_MS - (currentTimeMs - startedAtMs) - 5_000;
  return remaining > 0
    ? Math.min(15_000, remaining)
    : 5_000;
}

function runCanvasStep({
  artifact,
  command,
  options,
  params,
  requestedTimeoutMs = 60_000,
  startedAtMs,
  stepName
}) {
  const timeoutMs = resolveWorkflowTimeout({
    surface: options.surface,
    startedAtMs,
    requestedTimeoutMs,
    stepName
  });
  updateArtifactCheckpoint(options.out, artifact, { step: stepName, command, timeoutMs });
  const result = canvas(command, params, timeoutMs);
  updateArtifactCheckpoint(options.out, artifact, null);
  return result;
}

function classifyWorkflowFailure(surface, detail) {
  const normalized = String(detail ?? "").toLowerCase();
  if (normalized.includes("[restricted_url]") || normalized.includes("restricted url scheme")) {
    return {
      status: surface === "extension" || surface === "cdp" ? "env_limited" : "fail",
      detail
    };
  }
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

function disconnectSession(sessionId, closeBrowser, timeoutMs = DISCONNECT_WRAPPER_TIMEOUT_MS) {
  runCli(
    ["disconnect", "--session-id", sessionId, ...(closeBrowser ? ["--close-browser"] : [])],
    { allowFailure: true, timeoutMs }
  );
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
  const attempts = config.connectAttempts ?? 3;
  const connectTimeoutMs = config.connectTimeoutMs ?? 300_000;
  const statusTimeoutMs = config.statusTimeoutMs ?? 120_000;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let sessionId = null;
    try {
      const connected = runCli(config.connectArgs, { timeoutMs: connectTimeoutMs }).json;
      sessionId = connected.data.sessionId;
      const activeTargetId = connected.data.activeTargetId
        ?? runCli(["status", "--session-id", sessionId], { timeoutMs: statusTimeoutMs }).json.data.activeTargetId;
      return {
        sessionId,
        activeTargetId,
        warnings: connected.data.warnings ?? [],
        mode: connected.data.mode ?? null
      };
    } catch (error) {
      lastError = error;
      if (sessionId) {
        disconnectSession(sessionId, config.closeBrowser === true);
      }
      if (attempt < attempts) {
        await sleep(2_000);
      }
    }
  }
  throw lastError ?? new Error("Unable to establish CDP session.");
}

function refreshCanvasWorkflowTargetId({
  sessionId,
  surface,
  capturedTargetId,
  createUrl = null,
  preferCaptured = false
}) {
  if (surface !== "extension" && surface !== "cdp") {
    return {
      targetId: capturedTargetId ?? null,
      activeTargetId: capturedTargetId ?? null,
      targetCount: 0
    };
  }

  const listedTargets = runCli(["targets-list", "--session-id", sessionId], { allowFailure: true });
  if (listedTargets.status !== 0) {
    throw new Error(`Canvas workflow target reseed failed: ${listedTargets.detail}`);
  }

  const targetPayload = listedTargets.json?.data;
  const targets = Array.isArray(targetPayload?.targets) ? targetPayload.targets : [];
  const activeTargetId = typeof targetPayload?.activeTargetId === "string"
    ? targetPayload.activeTargetId
    : null;
  const targetId = resolveCanvasWorkflowTargetId({
    surface,
    capturedTargetId,
    activeTargetId,
    targets,
    preferCaptured
  });

  if (shouldCreateCanvasWorkflowTarget({ surface, targetId, createUrl })) {
    const createdTarget = runCli(
      ["target-new", "--session-id", sessionId, "--url", createUrl],
      { allowFailure: true }
    );
    if (createdTarget.status !== 0) {
      throw new Error(`Canvas workflow target reseed failed: ${createdTarget.detail}`);
    }
    const createdTargetId = typeof createdTarget.json?.data?.targetId === "string"
      ? createdTarget.json.data.targetId
      : null;
    if (!createdTargetId) {
      throw new Error("Canvas workflow target reseed failed: target-new returned no targetId.");
    }
    const focusedTarget = runCli(
      ["target-use", "--session-id", sessionId, "--target-id", createdTargetId],
      { allowFailure: true }
    );
    if (focusedTarget.status !== 0) {
      throw new Error(`Canvas workflow target reseed failed: ${focusedTarget.detail}`);
    }
    return {
      targetId: createdTargetId,
      activeTargetId,
      targetCount: targets.length,
      createdTargetId
    };
  }

  if (!targetId) {
    throw new Error("Canvas workflow target reseed failed: no active target remained after starter.apply.");
  }

  if (targetId !== activeTargetId) {
    const focusedTarget = runCli(
      ["target-use", "--session-id", sessionId, "--target-id", targetId],
      { allowFailure: true }
    );
    if (focusedTarget.status !== 0) {
      throw new Error(`Canvas workflow target reseed failed: ${focusedTarget.detail}`);
    }
  }

  return {
    targetId,
    activeTargetId,
    targetCount: targets.length
  };
}

function runCanvasTargetStep({
  artifact,
  command,
  createUrl = null,
  options,
  params,
  capturedTargetId,
  preferCaptured = false,
  requestedTimeoutMs = 60_000,
  sessionId,
  startedAtMs,
  stepName
}) {
  const refreshedTarget = refreshCanvasWorkflowTargetId({
    sessionId,
    surface: options.surface,
    capturedTargetId,
    createUrl,
    preferCaptured
  });
  artifact.steps.push({
    step: `${stepName}.target`,
    previousTargetId: capturedTargetId,
    activeTargetId: refreshedTarget.activeTargetId,
    targetId: refreshedTarget.targetId,
    targetCount: refreshedTarget.targetCount,
    createdTargetId: refreshedTarget.createdTargetId ?? null
  });
  const result = runCanvasStep({
    artifact,
    command,
    options,
    params: {
      ...params,
      targetId: refreshedTarget.targetId
    },
    requestedTimeoutMs,
    startedAtMs,
    stepName
  });
  return {
    result,
    targetId: refreshedTarget.targetId
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const config = SURFACE_CONFIG[options.surface];
  const startedAtMs = Date.now();
  ensureCliBuilt();

  const artifact = {
    surface: options.surface,
    artifactPath: options.out,
    startedAt: new Date(startedAtMs).toISOString(),
    steps: []
  };
  writeJson(options.out, artifact);

  let sessionId = null;
  let disconnected = false;

  try {
    updateArtifactCheckpoint(options.out, artifact, { step: config.connect ? "connect" : "launch" });
    const connection = await establishSession(config);
    updateArtifactCheckpoint(options.out, artifact, null);
    sessionId = connection.sessionId;
    let activeTargetId = connection.activeTargetId;
    artifact.steps.push({
      step: config.connect ? "connect" : "launch",
      sessionId,
      activeTargetId,
      mode: connection.mode,
      warnings: connection.warnings
    });

    const opened = runCanvasStep({
      artifact,
      command: "canvas.session.open",
      options,
      params: { browserSessionId: sessionId },
      startedAtMs,
      stepName: "session.open"
    });
    const { canvasSessionId, leaseId, documentId } = opened;
    artifact.steps.push({ step: "session.open", canvasSessionId, leaseId, documentId });

    const loaded = runCanvasStep({
      artifact,
      command: "canvas.document.load",
      options,
      params: { canvasSessionId, leaseId, documentId },
      startedAtMs,
      stepName: "document.load.initial"
    });
    const page = loaded.document.pages[0];
    const pageId = page.id;
    const rootNodeId = page.rootNodeId;

    const planned = runCanvasStep({
      artifact,
      command: "canvas.plan.set",
      options,
      params: { canvasSessionId, leaseId, generationPlan: GENERATION_PLAN },
      startedAtMs,
      stepName: "plan.set"
    });
    const governed = runCanvasStep({
      artifact,
      command: "canvas.document.patch",
      options,
      params: {
        canvasSessionId,
        leaseId,
        baseRevision: planned.documentRevision,
        patches: GOVERNANCE
      },
      startedAtMs,
      stepName: "document.patch.governance"
    });
    artifact.steps.push({
      step: "plan-and-governance",
      documentRevision: governed.appliedRevision,
      pageId,
      rootNodeId
    });

    const starter = runCanvasStep({
      artifact,
      command: "canvas.starter.apply",
      options,
      params: {
        canvasSessionId,
        leaseId,
        starterId: "hero.saas-product",
        frameworkId: "Next.js"
      },
      startedAtMs,
      stepName: "starter.apply"
    });
    artifact.steps.push({
      step: "starter.apply",
      starterId: starter.starterId,
      frameworkId: starter.frameworkId,
      degraded: starter.degraded ?? false,
      reason: starter.reason ?? null
    });

    if (config.includeInventoryHistory) {
      const inventory = runCanvasStep({
        artifact,
        command: "canvas.inventory.list",
        options,
        params: { canvasSessionId },
        startedAtMs,
        stepName: "inventory.list"
      });
      const metricCard = inventory.items.find((item) => item.id === "kit.dashboard.analytics-core.metric-card") ?? inventory.items[0];
      const afterStarter = runCanvasStep({
        artifact,
        command: "canvas.document.load",
        options,
        params: { canvasSessionId, leaseId, documentId },
        startedAtMs,
        stepName: "document.load.after-starter"
      });
      const inserted = runCanvasStep({
        artifact,
        command: "canvas.inventory.insert",
        options,
        params: {
          canvasSessionId,
          leaseId,
          baseRevision: afterStarter.documentRevision,
          itemId: metricCard.id,
          pageId,
          parentId: rootNodeId,
          x: 640,
          y: 180
        },
        startedAtMs,
        stepName: "inventory.insert"
      });
      const undone = runCanvasStep({
        artifact,
        command: "canvas.history.undo",
        options,
        params: { canvasSessionId, leaseId },
        startedAtMs,
        stepName: "history.undo"
      });
      const redone = runCanvasStep({
        artifact,
        command: "canvas.history.redo",
        options,
        params: { canvasSessionId, leaseId },
        startedAtMs,
        stepName: "history.redo"
      });
      artifact.steps.push({
        step: "inventory-history",
        inventoryItemId: metricCard.id,
        insertedOk: inserted.ok,
        undoOk: undone.ok,
        redoOk: redone.ok
      });
    }

    if (config.includeFeedback) {
      const subscription = runCanvasStep({
        artifact,
        command: "canvas.feedback.subscribe",
        options,
        params: { canvasSessionId, categories: ["render", "code-sync"] },
        startedAtMs,
        stepName: "feedback.subscribe"
      });
      const rendered = runCanvasStep({
        artifact,
        command: "canvas.preview.render",
        options,
        params: { canvasSessionId, leaseId, targetId: activeTargetId, prototypeId: "proto_home_default" },
        requestedTimeoutMs: 300_000,
        startedAtMs,
        stepName: "preview.render.feedback"
      });
      const nextEvent = runCanvasStep({
        artifact,
        command: "canvas.feedback.next",
        options,
        params: { canvasSessionId, subscriptionId: subscription.subscriptionId, categories: ["render", "code-sync"], timeoutMs: 5_000 },
        requestedTimeoutMs: 15_000,
        startedAtMs,
        stepName: "feedback.next"
      });
      const polled = runCanvasStep({
        artifact,
        command: "canvas.feedback.poll",
        options,
        params: { canvasSessionId, categories: ["render", "code-sync"] },
        startedAtMs,
        stepName: "feedback.poll"
      });
      runCanvasStep({
        artifact,
        command: "canvas.feedback.unsubscribe",
        options,
        params: { canvasSessionId, subscriptionId: subscription.subscriptionId, categories: ["render", "code-sync"] },
        startedAtMs,
        stepName: "feedback.unsubscribe"
      });
      artifact.steps.push({
        step: "preview-feedback",
        renderStatus: rendered.renderStatus,
        eventType: nextEvent.eventType,
        polledItems: polled.items.length
      });
    } else if (config.includePreviewOverlay) {
      const preview = runCanvasTargetStep({
        artifact,
        command: "canvas.preview.render",
        createUrl: config.workflowTargetUrl ?? null,
        options,
        params: { canvasSessionId, leaseId, prototypeId: "proto_home_default" },
        capturedTargetId: activeTargetId,
        requestedTimeoutMs: 300_000,
        sessionId,
        startedAtMs,
        stepName: "preview.render.overlay"
      });
      const mount = runCanvasTargetStep({
        artifact,
        command: "canvas.overlay.mount",
        options,
        params: {
          canvasSessionId,
          leaseId,
          prototypeId: "proto_home_default"
        },
        capturedTargetId: preview.targetId,
        preferCaptured: true,
        sessionId,
        startedAtMs,
        stepName: "overlay.mount"
      });
      const selection = runCanvasTargetStep({
        artifact,
        command: "canvas.overlay.select",
        options,
        params: {
          canvasSessionId,
          leaseId,
          mountId: mount.result.mountId,
          nodeId: rootNodeId
        },
        capturedTargetId: mount.targetId,
        preferCaptured: true,
        sessionId,
        startedAtMs,
        stepName: "overlay.select"
      });
      const unmount = runCanvasTargetStep({
        artifact,
        command: "canvas.overlay.unmount",
        options,
        params: {
          canvasSessionId,
          leaseId,
          mountId: mount.result.mountId
        },
        capturedTargetId: selection.targetId,
        preferCaptured: true,
        sessionId,
        startedAtMs,
        stepName: "overlay.unmount"
      });
      artifact.steps.push({
        step: "preview-overlay",
        renderStatus: preview.result.renderStatus,
        mountId: mount.result.mountId,
        selectedNodeId: selection.result.selection?.nodeId ?? rootNodeId,
        unmounted: unmount.result.ok ?? false
      });
    }

    if (config.designTabMode !== "none") {
      const openedTab = runCanvasStep({
        artifact,
        command: "canvas.tab.open",
        options,
        params: {
          canvasSessionId,
          leaseId,
          prototypeId: "proto_home_default",
          previewMode: "focused"
        },
        startedAtMs,
        stepName: "tab.open"
      });
      const designTargetId = openedTab.targetId;
      if (config.designTabMode === "overlay") {
        const mount = runCanvasTargetStep({
          artifact,
          command: "canvas.overlay.mount",
          options,
          params: {
            canvasSessionId,
            leaseId,
            prototypeId: "proto_home_default"
          },
          capturedTargetId: designTargetId,
          preferCaptured: true,
          sessionId,
          startedAtMs,
          stepName: "design.overlay.mount"
        });
        const selection = runCanvasTargetStep({
          artifact,
          command: "canvas.overlay.select",
          options,
          params: {
            canvasSessionId,
            leaseId,
            mountId: mount.result.mountId,
            nodeId: rootNodeId
          },
          capturedTargetId: mount.targetId,
          preferCaptured: true,
          sessionId,
          startedAtMs,
          stepName: "design.overlay.select"
        });
        const unmount = runCanvasTargetStep({
          artifact,
          command: "canvas.overlay.unmount",
          options,
          params: {
            canvasSessionId,
            leaseId,
            mountId: mount.result.mountId
          },
          capturedTargetId: selection.targetId,
          preferCaptured: true,
          sessionId,
          startedAtMs,
          stepName: "design.overlay.unmount"
        });
        const closed = runCanvasStep({
          artifact,
          command: "canvas.tab.close",
          options,
          params: { canvasSessionId, leaseId, targetId: designTargetId },
          startedAtMs,
          stepName: "design.tab.close"
        });
        artifact.steps.push({
          step: "design-tab-overlay",
          designTargetId,
          previewState: openedTab.previewState ?? null,
          mountId: mount.result.mountId,
          selectedNodeId: selection.result.selection?.nodeId ?? rootNodeId,
          unmounted: unmount.result.ok ?? false,
          closed: closed.ok ?? false
        });
      } else {
        const closed = runCanvasStep({
          artifact,
          command: "canvas.tab.close",
          options,
          params: { canvasSessionId, leaseId, targetId: designTargetId },
          startedAtMs,
          stepName: "design.tab.close"
        });
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

    const bound = runCanvasStep({
      artifact,
      command: "canvas.code.bind",
      options,
      params: {
        canvasSessionId,
        leaseId,
        nodeId: rootNodeId,
        bindingId: config.bindingId,
        repoPath: path.relative(ROOT, codePath),
        exportName: "Hero",
        syncMode: "manual"
      },
      requestedTimeoutMs: 300_000,
      startedAtMs,
      stepName: "code.bind"
    });
    const pulled = runCanvasStep({
      artifact,
      command: "canvas.code.pull",
      options,
      params: { canvasSessionId, leaseId, bindingId: config.bindingId },
      requestedTimeoutMs: 300_000,
      startedAtMs,
      stepName: "code.pull"
    });
    const afterPull = runCanvasStep({
      artifact,
      command: "canvas.document.load",
      options,
      params: { canvasSessionId, leaseId, documentId },
      startedAtMs,
      stepName: "document.load.after-pull"
    });
    const importedTextNode = afterPull.document.pages
      .flatMap((entry) => entry.nodes ?? [])
      .find((node) => typeof node?.props?.text === "string" && node.props.text.includes(config.importedText));
    if (!importedTextNode?.id) {
      throw new Error(`No imported text node found after canvas.code.pull for surface ${options.surface}`);
    }
    const patched = runCanvasStep({
      artifact,
      command: "canvas.document.patch",
      options,
      params: {
        canvasSessionId,
        leaseId,
        baseRevision: afterPull.documentRevision,
        patches: [{ op: "node.update", nodeId: importedTextNode.id, changes: { "props.text": config.updatedText } }]
      },
      startedAtMs,
      stepName: "document.patch.code"
    });
    const pushed = runCanvasStep({
      artifact,
      command: "canvas.code.push",
      options,
      params: { canvasSessionId, leaseId, bindingId: config.bindingId },
      requestedTimeoutMs: 300_000,
      startedAtMs,
      stepName: "code.push"
    });
    const codeStatus = runCanvasStep({
      artifact,
      command: "canvas.code.status",
      options,
      params: { canvasSessionId, bindingId: config.bindingId },
      startedAtMs,
      stepName: "code.status"
    });
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

    const exported = runCanvasStep({
      artifact,
      command: "canvas.document.export",
      options,
      params: { canvasSessionId, leaseId, exportTarget: "html_bundle" },
      requestedTimeoutMs: 300_000,
      startedAtMs,
      stepName: "document.export"
    });
    const saved = runCanvasStep({
      artifact,
      command: "canvas.document.save",
      options,
      params: { canvasSessionId, leaseId, repoPath: config.saveRepoPath },
      requestedTimeoutMs: 300_000,
      startedAtMs,
      stepName: "document.save"
    });
    const unbound = runCanvasStep({
      artifact,
      command: "canvas.code.unbind",
      options,
      params: { canvasSessionId, leaseId, bindingId: config.bindingId },
      startedAtMs,
      stepName: "code.unbind"
    });
    const closed = runCanvasStep({
      artifact,
      command: "canvas.session.close",
      options,
      params: { canvasSessionId, leaseId },
      startedAtMs,
      stepName: "session.close"
    });
    const disconnectArgs = ["disconnect", "--session-id", sessionId, ...(config.closeBrowser ? ["--close-browser"] : [])];
    const disconnectTimeoutMs = resolveDisconnectTimeout(options.surface, startedAtMs);
    updateArtifactCheckpoint(options.out, artifact, { step: "disconnect", timeoutMs: disconnectTimeoutMs });
    const disconnectedRun = runCli(disconnectArgs, { timeoutMs: disconnectTimeoutMs });
    updateArtifactCheckpoint(options.out, artifact, null);
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
      const disconnectTimeoutMs = resolveDisconnectTimeout(options.surface, startedAtMs);
      updateArtifactCheckpoint(options.out, artifact, { step: "disconnect", timeoutMs: disconnectTimeoutMs });
      disconnectSession(sessionId, config.closeBrowser === true, disconnectTimeoutMs);
      updateArtifactCheckpoint(options.out, artifact, null);
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
export { classifyWorkflowFailure };
