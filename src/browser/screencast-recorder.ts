import { copyFile, mkdir, readdir, writeFile } from "fs/promises";
import { randomUUID } from "crypto";
import { isAbsolute, join, resolve } from "path";
import type {
  BrowserScreencastEndedReason,
  BrowserScreencastResult,
  BrowserScreencastSession,
  BrowserScreencastStartOptions
} from "./manager-types";

export const DEFAULT_SCREENCAST_INTERVAL_MS = 1000;
export const MIN_SCREENCAST_INTERVAL_MS = 250;
export const DEFAULT_SCREENCAST_MAX_FRAMES = 300;

type ScreencastPageInfo = {
  url?: string;
  title?: string;
};

type ScreencastCaptureResult = ScreencastPageInfo & {
  warnings?: string[];
};

type ScreencastManifestFrame = {
  index: number;
  capturedAt: string;
  elapsedMs: number;
  relativePath: string;
};

type ScreencastManifest = {
  schemaVersion: "2026-04-10";
  screencastId: string;
  sessionId: string;
  targetId: string;
  startedAt: string;
  endedAt: string;
  endedReason: BrowserScreencastEndedReason;
  intervalMs: number;
  warnings?: string[];
  initialPage?: ScreencastPageInfo;
  finalPage?: ScreencastPageInfo;
  frames: ScreencastManifestFrame[];
};

type BrowserScreencastRecorderArgs = {
  worktree: string;
  sessionId: string;
  targetId: string;
  options?: BrowserScreencastStartOptions;
  screencastId?: string;
  captureFrame: (path: string) => Promise<ScreencastCaptureResult>;
};

const MANIFEST_SCHEMA_VERSION = "2026-04-10" as const;
const FRAMES_DIRECTORY = "frames";
const MANIFEST_FILENAME = "replay.json";
const REPLAY_FILENAME = "replay.html";
const PREVIEW_FILENAME = "preview.png";

const delay = (ms: number): Promise<void> => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));

function normalizeRelativePath(value: string): string {
  return value.replaceAll("\\", "/");
}

function ensurePositiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

function resolveIntervalMs(value?: number): number {
  if (typeof value === "undefined") {
    return DEFAULT_SCREENCAST_INTERVAL_MS;
  }
  const intervalMs = ensurePositiveInteger(value, "intervalMs");
  if (intervalMs < MIN_SCREENCAST_INTERVAL_MS) {
    throw new Error(`intervalMs must be at least ${MIN_SCREENCAST_INTERVAL_MS}.`);
  }
  return intervalMs;
}

function resolveMaxFrames(value?: number): number {
  if (typeof value === "undefined") {
    return DEFAULT_SCREENCAST_MAX_FRAMES;
  }
  return ensurePositiveInteger(value, "maxFrames");
}

async function ensureEmptyDirectory(path: string): Promise<void> {
  const existing = await readdir(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  });
  if (existing && existing.length > 0) {
    throw new Error(`Screencast output directory must be empty: ${path}`);
  }
  await mkdir(path, { recursive: true });
}

function resolveOutputDir(
  worktree: string,
  sessionId: string,
  screencastId: string,
  outputDir?: string
): string {
  if (typeof outputDir === "string" && outputDir.trim().length > 0) {
    const trimmed = outputDir.trim();
    return isAbsolute(trimmed) ? trimmed : resolve(worktree, trimmed);
  }
  return join(worktree, ".opendevbrowser", "replays", "screencasts", sessionId, screencastId);
}

function renderReplayHtml(manifest: ScreencastManifest): string {
  const encodedManifest = JSON.stringify(manifest).replaceAll("<", "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>OpenDevBrowser Screencast Replay</title>
  <style>
    :root { color-scheme: light dark; }
    body { margin: 0; font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; background: #111; color: #f5f5f5; }
    main { display: grid; gap: 16px; min-height: 100vh; place-items: center; padding: 24px; }
    img { max-width: min(1200px, 100%); max-height: 75vh; border: 1px solid rgba(255,255,255,0.15); border-radius: 12px; background: #000; object-fit: contain; }
    section { width: min(1200px, 100%); display: grid; gap: 8px; }
    progress { width: 100%; height: 12px; }
    button { width: fit-content; padding: 8px 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.2); background: transparent; color: inherit; cursor: pointer; }
    code { white-space: pre-wrap; }
  </style>
</head>
<body>
  <main>
    <img id="frame" alt="OpenDevBrowser screencast frame" src="" />
    <section>
      <button id="toggle" type="button">Pause</button>
      <progress id="progress" max="1" value="0"></progress>
      <code id="meta"></code>
    </section>
  </main>
  <script>
    const manifest = ${encodedManifest};
    const frame = document.getElementById("frame");
    const progress = document.getElementById("progress");
    const toggle = document.getElementById("toggle");
    const meta = document.getElementById("meta");
    const frames = manifest.frames ?? [];
    let frameIndex = 0;
    let playing = true;
    let timer = null;

    function render() {
      const current = frames[frameIndex] ?? null;
      if (!current) {
        frame.removeAttribute("src");
        meta.textContent = JSON.stringify(manifest, null, 2);
        return;
      }
      frame.src = current.relativePath;
      progress.max = Math.max(frames.length - 1, 1);
      progress.value = frameIndex;
      meta.textContent = JSON.stringify({
        screencastId: manifest.screencastId,
        sessionId: manifest.sessionId,
        targetId: manifest.targetId,
        frame: current.index,
        capturedAt: current.capturedAt,
        elapsedMs: current.elapsedMs,
        endedReason: manifest.endedReason,
        warnings: manifest.warnings ?? []
      }, null, 2);
    }

    function schedule() {
      if (!playing || frameIndex >= frames.length - 1) {
        return;
      }
      const current = frames[frameIndex];
      const next = frames[frameIndex + 1];
      const waitMs = Math.max((next.elapsedMs - current.elapsedMs) || 1, 1);
      timer = setTimeout(() => {
        frameIndex += 1;
        render();
        schedule();
      }, waitMs);
    }

    toggle.addEventListener("click", () => {
      playing = !playing;
      toggle.textContent = playing ? "Pause" : "Play";
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (playing) {
        schedule();
      }
    });

    render();
    schedule();
  </script>
</body>
</html>
`;
}

export class BrowserScreencastRecorder {
  readonly screencastId: string;
  readonly sessionId: string;
  readonly targetId: string;
  readonly outputDir: string;
  readonly startedAt: string;
  readonly intervalMs: number;
  readonly maxFrames: number;
  readonly manifestPath: string;
  readonly replayHtmlPath: string;
  readonly previewPath: string;

  private readonly captureFrameImpl: (path: string) => Promise<ScreencastCaptureResult>;
  private readonly framesDir: string;
  private readonly startedAtMs: number;
  private readonly warnings = new Set<string>();
  private readonly completionPromise: Promise<BrowserScreencastResult>;
  private resolveCompletion!: (result: BrowserScreencastResult) => void;
  private timer: NodeJS.Timeout | null = null;
  private capturePromise: Promise<void> | null = null;
  private completion: BrowserScreencastResult | null = null;
  private requestedStopReason: Extract<BrowserScreencastEndedReason, "stopped" | "session_closed" | "target_closed"> | null = null;
  private initialPage: ScreencastPageInfo | undefined;
  private finalPage: ScreencastPageInfo | undefined;
  private readonly frames: ScreencastManifestFrame[] = [];

  constructor(args: BrowserScreencastRecorderArgs) {
    this.screencastId = args.screencastId ?? randomUUID();
    this.sessionId = args.sessionId;
    this.targetId = args.targetId;
    this.outputDir = resolveOutputDir(args.worktree, args.sessionId, this.screencastId, args.options?.outputDir);
    this.intervalMs = resolveIntervalMs(args.options?.intervalMs);
    this.maxFrames = resolveMaxFrames(args.options?.maxFrames);
    this.startedAt = new Date().toISOString();
    this.startedAtMs = Date.parse(this.startedAt);
    this.framesDir = join(this.outputDir, FRAMES_DIRECTORY);
    this.manifestPath = join(this.outputDir, MANIFEST_FILENAME);
    this.replayHtmlPath = join(this.outputDir, REPLAY_FILENAME);
    this.previewPath = join(this.outputDir, PREVIEW_FILENAME);
    this.captureFrameImpl = args.captureFrame;
    this.completionPromise = new Promise<BrowserScreencastResult>((resolvePromise) => {
      this.resolveCompletion = resolvePromise;
    });
  }

  get resultPromise(): Promise<BrowserScreencastResult> {
    return this.completionPromise;
  }

  isComplete(): boolean {
    return this.completion !== null;
  }

  async start(): Promise<BrowserScreencastSession> {
    await ensureEmptyDirectory(this.outputDir);
    await mkdir(this.framesDir, { recursive: true });
    await this.captureFrame();
    if (this.requestedStopReason) {
      await this.finalize(this.requestedStopReason, false);
    } else if (this.frames.length >= this.maxFrames) {
      await this.finalize("max_frames_reached", false);
    } else {
      this.scheduleNextFrame();
    }
    return this.buildSession();
  }

  async stop(reason: Extract<BrowserScreencastEndedReason, "stopped" | "session_closed" | "target_closed">): Promise<BrowserScreencastResult> {
    if (!this.completion && !this.requestedStopReason) {
      this.requestedStopReason = reason;
    }
    return await this.finalize(this.requestedStopReason ?? reason, true);
  }

  private buildSession(): BrowserScreencastSession {
    const warnings = Array.from(this.warnings);
    return {
      screencastId: this.screencastId,
      sessionId: this.sessionId,
      targetId: this.targetId,
      outputDir: this.outputDir,
      startedAt: this.startedAt,
      intervalMs: this.intervalMs,
      maxFrames: this.maxFrames,
      ...(warnings.length > 0 ? { warnings } : {})
    };
  }

  private scheduleNextFrame(): void {
    if (this.isComplete() || this.requestedStopReason) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.captureScheduledFrame();
    }, this.intervalMs);
  }

  private async captureScheduledFrame(): Promise<void> {
    if (this.requestedStopReason || this.isComplete()) {
      return;
    }
    const captured = await this.captureFrame().catch(async () => {
      if (!this.requestedStopReason) {
        await this.finalize("capture_failed", false);
      }
      return false;
    });
    if (!captured || this.isComplete()) {
      return;
    }
    if (this.requestedStopReason) {
      return;
    }
    if (this.frames.length >= this.maxFrames) {
      await this.finalize("max_frames_reached", false);
      return;
    }
    await delay(0);
    if (this.requestedStopReason || this.isComplete()) {
      return;
    }
    this.scheduleNextFrame();
  }

  private async captureFrame(): Promise<boolean> {
    const index = this.frames.length + 1;
    const frameFilename = `${String(index).padStart(6, "0")}.png`;
    const framePath = join(this.framesDir, frameFilename);
    // Defer the capture body so stop() calls inside captureFrameImpl can still
    // observe this.capturePromise and wait for the in-flight first frame.
    const task = Promise.resolve().then(async () => {
      const capturedAt = new Date().toISOString();
      const result = await this.captureFrameImpl(framePath);
      if (Array.isArray(result.warnings)) {
        result.warnings.forEach((warning) => this.warnings.add(warning));
      }
      const pageInfo = this.toPageInfo(result);
      if (!this.initialPage) {
        this.initialPage = pageInfo;
      }
      this.finalPage = pageInfo;
      this.frames.push({
        index,
        capturedAt,
        elapsedMs: Math.max(Date.parse(capturedAt) - this.startedAtMs, 0),
        relativePath: normalizeRelativePath(join(FRAMES_DIRECTORY, frameFilename))
      });
      if (this.frames.length === 1) {
        await copyFile(framePath, this.previewPath);
      }
    });
    this.capturePromise = task;
    try {
      await task;
      return true;
    } finally {
      if (this.capturePromise === task) {
        this.capturePromise = null;
      }
    }
  }

  private toPageInfo(result: ScreencastCaptureResult): ScreencastPageInfo | undefined {
    const pageInfo: ScreencastPageInfo = {};
    if (typeof result.url === "string" && result.url.length > 0) {
      pageInfo.url = result.url;
    }
    if (typeof result.title === "string" && result.title.length > 0) {
      pageInfo.title = result.title;
    }
    return Object.keys(pageInfo).length > 0 ? pageInfo : undefined;
  }

  private async finalize(reason: BrowserScreencastEndedReason, awaitCapture: boolean): Promise<BrowserScreencastResult> {
    if (this.completion) {
      return this.completion;
    }
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (awaitCapture && this.capturePromise) {
      await this.capturePromise.catch(() => undefined);
      if (this.completion) {
        return this.completion;
      }
    }
    const endedAt = new Date().toISOString();
    const warnings = Array.from(this.warnings);
    const manifest: ScreencastManifest = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      screencastId: this.screencastId,
      sessionId: this.sessionId,
      targetId: this.targetId,
      startedAt: this.startedAt,
      endedAt,
      endedReason: reason,
      intervalMs: this.intervalMs,
      ...(warnings.length > 0 ? { warnings } : {}),
      ...(this.initialPage ? { initialPage: this.initialPage } : {}),
      ...(this.finalPage ? { finalPage: this.finalPage } : {}),
      frames: [...this.frames]
    };
    await writeFile(this.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await writeFile(this.replayHtmlPath, renderReplayHtml(manifest), "utf8");
    const previewPath = this.frames.length > 0 ? this.previewPath : undefined;
    const result: BrowserScreencastResult = {
      screencastId: this.screencastId,
      sessionId: this.sessionId,
      targetId: this.targetId,
      outputDir: this.outputDir,
      startedAt: this.startedAt,
      endedAt,
      endedReason: reason,
      frameCount: this.frames.length,
      manifestPath: this.manifestPath,
      replayHtmlPath: this.replayHtmlPath,
      ...(previewPath ? { previewPath } : {}),
      ...(warnings.length > 0 ? { warnings } : {})
    };
    this.completion = result;
    this.resolveCompletion(result);
    return result;
  }
}
