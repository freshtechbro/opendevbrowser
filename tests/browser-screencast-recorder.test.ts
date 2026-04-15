import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BrowserScreencastRecorder,
  DEFAULT_SCREENCAST_INTERVAL_MS,
  DEFAULT_SCREENCAST_MAX_FRAMES
} from "../src/browser/screencast-recorder";

const cleanupPaths: string[] = [];

async function makeWorktree(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  cleanupPaths.push(directory);
  return directory;
}

function createDeferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value?: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value?: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(async () => {
  vi.useRealTimers();
  while (cleanupPaths.length > 0) {
    const target = cleanupPaths.pop();
    if (target) {
      await rm(target, { recursive: true, force: true });
    }
  }
});

describe("BrowserScreencastRecorder", () => {
  it("writes replay artifacts and auto-stops when maxFrames is reached", async () => {
    const worktree = await makeWorktree("odb-screencast-recorder-");
    const captureFrame = vi.fn(async (capturePath: string) => {
      await writeFile(capturePath, `frame-${captureFrame.mock.calls.length}`);
      return {
        url: `https://example.com/${captureFrame.mock.calls.length}`,
        title: `Frame ${captureFrame.mock.calls.length}`
      };
    });
    const recorder = new BrowserScreencastRecorder({
      worktree,
      sessionId: "session-1",
      targetId: "target-1",
      options: {
        intervalMs: 250,
        maxFrames: 2
      },
      captureFrame
    });

    const session = await recorder.start();
    expect(session.intervalMs).toBe(250);
    expect(session.maxFrames).toBe(2);

    await vi.advanceTimersByTimeAsync(250);

    const result = await recorder.resultPromise;
    const manifest = JSON.parse(await readFile(result.manifestPath, "utf8")) as {
      endedReason: string;
      frames: Array<{ relativePath: string }>;
      initialPage?: { title?: string };
      finalPage?: { title?: string };
    };
    const replayHtml = await readFile(result.replayHtmlPath, "utf8");
    const frameFiles = await readdir(path.join(result.outputDir, "frames"));

    expect(result).toMatchObject({
      sessionId: "session-1",
      targetId: "target-1",
      endedReason: "max_frames_reached",
      frameCount: 2
    });
    expect(manifest.endedReason).toBe("max_frames_reached");
    expect(manifest.frames).toHaveLength(2);
    expect(manifest.initialPage?.title).toBe("Frame 1");
    expect(manifest.finalPage?.title).toBe("Frame 2");
    expect(frameFiles).toEqual(["000001.png", "000002.png"]);
    expect(replayHtml).toContain(result.screencastId);
    expect(replayHtml).toContain("frames/000001.png");
    expect(await stat(result.previewPath ?? "")).toMatchObject({ isFile: expect.any(Function) });
  });

  it("finalizes capture failures after the initial frame", async () => {
    const worktree = await makeWorktree("odb-screencast-failure-");
    let captureCount = 0;
    const recorder = new BrowserScreencastRecorder({
      worktree,
      sessionId: "session-2",
      targetId: "target-2",
      options: {
        intervalMs: 250,
        maxFrames: 4
      },
      captureFrame: async (capturePath: string) => {
        captureCount += 1;
        if (captureCount === 1) {
          await writeFile(capturePath, "frame-1");
          return { warnings: ["initial-warning"] };
        }
        throw new Error("capture exploded");
      }
    });

    await recorder.start();
    await vi.advanceTimersByTimeAsync(250);

    const result = await recorder.resultPromise;
    expect(result.endedReason).toBe("capture_failed");
    expect(result.frameCount).toBe(1);
    expect(result.warnings).toEqual(["initial-warning"]);
  });

  it("uses defaults, rejects non-empty output directories, and keeps stop idempotent", async () => {
    const worktree = await makeWorktree("odb-screencast-defaults-");
    const outputDir = path.join(worktree, "custom-output");
    await writeFile(path.join(worktree, "occupied"), "value");
    const recorder = new BrowserScreencastRecorder({
      worktree,
      sessionId: "session-3",
      targetId: "target-3",
      captureFrame: async (capturePath: string) => {
        await writeFile(capturePath, "frame");
        return {};
      }
    });

    expect(recorder.intervalMs).toBe(DEFAULT_SCREENCAST_INTERVAL_MS);
    expect(recorder.maxFrames).toBe(DEFAULT_SCREENCAST_MAX_FRAMES);

    const occupied = new BrowserScreencastRecorder({
      worktree,
      sessionId: "session-3",
      targetId: "target-3",
      options: { outputDir: worktree },
      captureFrame: async (capturePath: string) => {
        await writeFile(capturePath, "frame");
        return {};
      }
    });
    await expect(occupied.start()).rejects.toThrow("Screencast output directory must be empty");

    const stoppable = new BrowserScreencastRecorder({
      worktree,
      sessionId: "session-4",
      targetId: "target-4",
      options: { outputDir },
      captureFrame: async (capturePath: string) => {
        await writeFile(capturePath, "frame");
        return {};
      }
    });
    await stoppable.start();
    const first = await stoppable.stop("target_closed");
    const second = await stoppable.stop("stopped");

    expect(first.endedReason).toBe("target_closed");
    expect(second).toEqual(first);
  });

  it("validates option edges and rejects non-directory output paths", async () => {
    const worktree = await makeWorktree("odb-screencast-invalid-");
    const captureFrame = async (capturePath: string) => {
      await writeFile(capturePath, "frame");
      return {};
    };

    expect(() => new BrowserScreencastRecorder({
      worktree,
      sessionId: "session-invalid-1",
      targetId: "target-invalid-1",
      options: { intervalMs: 0 },
      captureFrame
    })).toThrow("intervalMs must be a positive integer.");

    expect(() => new BrowserScreencastRecorder({
      worktree,
      sessionId: "session-invalid-2",
      targetId: "target-invalid-2",
      options: { intervalMs: 249 },
      captureFrame
    })).toThrow("intervalMs must be at least 250.");

    expect(() => new BrowserScreencastRecorder({
      worktree,
      sessionId: "session-invalid-3",
      targetId: "target-invalid-3",
      options: { maxFrames: 0 },
      captureFrame
    })).toThrow("maxFrames must be a positive integer.");

    const occupiedPath = path.join(worktree, "occupied.txt");
    await writeFile(occupiedPath, "value");
    const recorder = new BrowserScreencastRecorder({
      worktree,
      sessionId: "session-invalid-4",
      targetId: "target-invalid-4",
      options: { outputDir: occupiedPath },
      captureFrame
    });

    await expect(recorder.start()).rejects.toMatchObject({ code: "ENOTDIR" });
  });

  it("resolves relative output paths and auto-stops when the first frame exhausts the budget", async () => {
    const worktree = await makeWorktree("odb-screencast-relative-");
    const recorder = new BrowserScreencastRecorder({
      worktree,
      sessionId: "session-relative",
      targetId: "target-relative",
      options: {
        outputDir: " casts/test-run ",
        maxFrames: 1
      },
      captureFrame: async (capturePath: string) => {
        await writeFile(capturePath, "frame-1");
        return {
          url: "https://example.com/replay",
          warnings: ["relative-warning"]
        };
      }
    });

    const session = await recorder.start();
    const result = await recorder.resultPromise;
    const manifest = JSON.parse(await readFile(result.manifestPath, "utf8")) as {
      initialPage?: { url?: string; title?: string };
      finalPage?: { url?: string; title?: string };
    };

    expect(session.outputDir).toBe(path.resolve(worktree, "casts/test-run"));
    expect(session.warnings).toEqual(["relative-warning"]);
    expect(result.endedReason).toBe("max_frames_reached");
    expect(result.frameCount).toBe(1);
    expect(manifest.initialPage).toEqual({ url: "https://example.com/replay" });
    expect(manifest.finalPage).toEqual({ url: "https://example.com/replay" });
  });

  it("waits for an in-flight capture before stopping and preserves the completed frame", async () => {
    const worktree = await makeWorktree("odb-screencast-inflight-stop-");
    const releaseSecondFrame = createDeferred<void>();
    let captureCount = 0;
    const recorder = new BrowserScreencastRecorder({
      worktree,
      sessionId: "session-inflight-stop",
      targetId: "target-inflight-stop",
      options: {
        intervalMs: 250,
        maxFrames: 3
      },
      captureFrame: async (capturePath: string) => {
        captureCount += 1;
        if (captureCount === 2) {
          await releaseSecondFrame.promise;
        }
        await writeFile(capturePath, `frame-${captureCount}`);
        return captureCount === 1
          ? { title: "Frame One" }
          : { url: "https://example.com/frame-2" };
      }
    });

    await recorder.start();
    await vi.advanceTimersByTimeAsync(250);

    const privateRecorder = recorder as unknown as {
      capturePromise: Promise<void> | null;
    };
    await vi.waitFor(() => {
      expect(privateRecorder.capturePromise).not.toBeNull();
    });

    const stopPromise = recorder.stop("stopped");
    releaseSecondFrame.resolve();

    const result = await stopPromise;
    const manifest = JSON.parse(await readFile(result.manifestPath, "utf8")) as {
      initialPage?: { title?: string };
      finalPage?: { url?: string };
    };

    expect(result.endedReason).toBe("stopped");
    expect(result.frameCount).toBe(2);
    expect(manifest.initialPage).toEqual({ title: "Frame One" });
    expect(manifest.finalPage).toEqual({ url: "https://example.com/frame-2" });
  });

  it("preserves the requested teardown reason when an in-flight capture rejects", async () => {
    const worktree = await makeWorktree("odb-screencast-stop-race-");
    const releaseSecondFrame = createDeferred<void>();
    let captureCount = 0;
    const recorder = new BrowserScreencastRecorder({
      worktree,
      sessionId: "session-stop-race",
      targetId: "target-stop-race",
      options: {
        intervalMs: 250,
        maxFrames: 3
      },
      captureFrame: async (capturePath: string) => {
        captureCount += 1;
        if (captureCount === 1) {
          await writeFile(capturePath, "frame-1");
          return { title: "Frame One" };
        }
        await releaseSecondFrame.promise;
        throw new Error("capture exploded");
      }
    });

    await recorder.start();
    await vi.advanceTimersByTimeAsync(250);

    const stopPromise = recorder.stop("session_closed");
    releaseSecondFrame.resolve();

    const result = await stopPromise;
    expect(result.endedReason).toBe("session_closed");
    expect(result.frameCount).toBe(1);
  });

  it("does not schedule another frame when stop is requested during the first capture", async () => {
    const worktree = await makeWorktree("odb-screencast-first-capture-stop-");
    let captureCount = 0;
    let stopPromise: Promise<Awaited<ReturnType<BrowserScreencastRecorder["stop"]>>> | null = null;
    const recorder = new BrowserScreencastRecorder({
      worktree,
      sessionId: "session-first-capture-stop",
      targetId: "target-first-capture-stop",
      options: {
        intervalMs: 250,
        maxFrames: 3
      },
      captureFrame: async (capturePath: string) => {
        captureCount += 1;
        if (captureCount === 1) {
          stopPromise = recorder.stop("target_closed");
        }
        await writeFile(capturePath, `frame-${captureCount}`);
        return { title: `Frame ${captureCount}` };
      }
    });

    const startResult = await recorder.start();
    expect(startResult.targetId).toBe("target-first-capture-stop");
    expect(stopPromise).not.toBeNull();

    const privateRecorder = recorder as unknown as {
      timer: NodeJS.Timeout | null;
    };
    expect(privateRecorder.timer).toBeNull();

    const result = await stopPromise;
    await vi.runOnlyPendingTimersAsync();

    expect(result.endedReason).toBe("target_closed");
    expect(result.frameCount).toBe(1);
    expect(captureCount).toBe(1);
  });

  it("stops during the post-capture delay without scheduling another frame", async () => {
    const worktree = await makeWorktree("odb-screencast-post-capture-stop-");
    let captureCount = 0;
    const secondCaptureSeen = createDeferred<void>();
    let stopPromise: Promise<Awaited<ReturnType<BrowserScreencastRecorder["stop"]>>> | null = null;
    const recorder = new BrowserScreencastRecorder({
      worktree,
      sessionId: "session-post-delay",
      targetId: "target-post-delay",
      options: {
        intervalMs: 250,
        maxFrames: 3
      },
      captureFrame: async (capturePath: string) => {
        captureCount += 1;
        await writeFile(capturePath, `frame-${captureCount}`);
        if (captureCount === 2) {
          setTimeout(() => {
            stopPromise = recorder.stop("target_closed");
          }, 0);
          secondCaptureSeen.resolve();
        }
        return { title: `Frame ${captureCount}` };
      }
    });

    await recorder.start();
    await vi.advanceTimersByTimeAsync(250);
    await secondCaptureSeen.promise;
    await vi.runOnlyPendingTimersAsync();

    expect(stopPromise).not.toBeNull();

    const result = await stopPromise;
    expect(result.endedReason).toBe("target_closed");
    expect(result.frameCount).toBe(2);
    expect(captureCount).toBe(2);
  });

  it("returns an existing completion when finalize waits on a pending capture promise", async () => {
    const worktree = await makeWorktree("odb-screencast-pending-completion-");
    const recorder = new BrowserScreencastRecorder({
      worktree,
      sessionId: "session-pending-completion",
      targetId: "target-pending-completion",
      captureFrame: async (capturePath: string) => {
        await writeFile(capturePath, "unused");
        return {};
      }
    });
    await mkdir(recorder.outputDir, { recursive: true });

    const privateRecorder = recorder as unknown as {
      finalize: (
        reason: "capture_failed" | "max_frames_reached" | "session_closed" | "stopped" | "target_closed",
        awaitCapture: boolean
      ) => Promise<{
        endedReason: string;
        frameCount: number;
      }>;
      capturePromise: Promise<void> | null;
    };
    privateRecorder.capturePromise = Promise.resolve().then(async () => {
      await privateRecorder.finalize("capture_failed", false);
    });

    const result = await privateRecorder.finalize("stopped", true);
    expect(result.endedReason).toBe("capture_failed");
    expect(result.frameCount).toBe(0);
  });

  it("can finalize an empty recording without a preview artifact", async () => {
    const worktree = await makeWorktree("odb-screencast-empty-finalize-");
    const recorder = new BrowserScreencastRecorder({
      worktree,
      sessionId: "session-empty",
      targetId: "target-empty",
      captureFrame: async (capturePath: string) => {
        await writeFile(capturePath, "unused");
        return {};
      }
    });
    await mkdir(recorder.outputDir, { recursive: true });

    const privateRecorder = recorder as unknown as {
      finalize: (
        reason: "capture_failed" | "max_frames_reached" | "session_closed" | "stopped" | "target_closed",
        awaitCapture: boolean
      ) => Promise<{
        previewPath?: string;
        manifestPath: string;
      }>;
    };
    const result = await privateRecorder.finalize("capture_failed", false);
    const manifest = JSON.parse(await readFile(result.manifestPath, "utf8")) as {
      frames: unknown[];
    };

    expect(result.previewPath).toBeUndefined();
    expect(manifest.frames).toEqual([]);
  });

  it("leaves a replaced private capturePromise intact after capture completion", async () => {
    const worktree = await makeWorktree("odb-screencast-capture-promise-");
    const releaseCapture = createDeferred<void>();
    const recorder = new BrowserScreencastRecorder({
      worktree,
      sessionId: "session-capture-promise",
      targetId: "target-capture-promise",
      captureFrame: async (capturePath: string) => {
        await releaseCapture.promise;
        await writeFile(capturePath, "frame");
        return {};
      }
    });
    await mkdir(recorder.outputDir, { recursive: true });
    await mkdir(path.join(recorder.outputDir, "frames"), { recursive: true });

    const privateRecorder = recorder as unknown as {
      captureFrame: () => Promise<boolean>;
      capturePromise: Promise<void> | null;
    };
    const capture = privateRecorder.captureFrame();
    await vi.waitFor(() => {
      expect(privateRecorder.capturePromise).not.toBeNull();
    });

    const sentinel = Promise.resolve();
    privateRecorder.capturePromise = sentinel;
    releaseCapture.resolve();

    await capture;
    expect(privateRecorder.capturePromise).toBe(sentinel);
  });

  it("does not schedule another frame after completion", async () => {
    const worktree = await makeWorktree("odb-screencast-complete-schedule-");
    const recorder = new BrowserScreencastRecorder({
      worktree,
      sessionId: "session-complete",
      targetId: "target-complete",
      captureFrame: async (capturePath: string) => {
        await writeFile(capturePath, "unused");
        return {};
      }
    });
    await mkdir(recorder.outputDir, { recursive: true });

    const privateRecorder = recorder as unknown as {
      finalize: (
        reason: "capture_failed" | "max_frames_reached" | "session_closed" | "stopped" | "target_closed",
        awaitCapture: boolean
      ) => Promise<void>;
      scheduleNextFrame: () => void;
      timer: ReturnType<typeof setTimeout> | null;
    };

    await privateRecorder.finalize("stopped", false);
    privateRecorder.scheduleNextFrame();

    expect(privateRecorder.timer).toBeNull();
  });

  it("returns the existing completion from stop and ignores captureScheduledFrame after completion", async () => {
    const worktree = await makeWorktree("odb-screencast-stop-after-complete-");
    let captureCount = 0;
    const recorder = new BrowserScreencastRecorder({
      worktree,
      sessionId: "session-stop-after-complete",
      targetId: "target-stop-after-complete",
      options: {
        intervalMs: 250,
        maxFrames: 1
      },
      captureFrame: async (capturePath: string) => {
        captureCount += 1;
        await writeFile(capturePath, `frame-${captureCount}`);
        return {};
      }
    });

    await recorder.start();
    const completed = await recorder.resultPromise;
    const stopped = await recorder.stop("stopped");

    const privateRecorder = recorder as unknown as {
      captureScheduledFrame: () => Promise<void>;
    };
    await privateRecorder.captureScheduledFrame();

    expect(stopped).toEqual(completed);
    expect(stopped.endedReason).toBe("max_frames_reached");
    expect(captureCount).toBe(1);
  });
});
