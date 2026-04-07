import { describe, expect, it, vi } from "vitest";
import { buildBrowserReviewResult } from "../src/browser/review-surface";

describe("buildBrowserReviewResult", () => {
  it("merges dialog state into existing status meta and preserves snapshot extras", async () => {
    const manager = {
      status: vi.fn().mockResolvedValue({
        mode: "managed",
        activeTargetId: "tab-status",
        url: "https://status.example",
        title: "Status Title",
        meta: { blockerState: "blocked" }
      }),
      snapshot: vi.fn().mockResolvedValue({
        snapshotId: "snap-1",
        url: "https://snapshot.example",
        title: "Snapshot Title",
        content: "content",
        truncated: false,
        nextCursor: "cursor-2",
        refCount: 3,
        timingMs: 9,
        warnings: ["warn-1"]
      }),
      dialog: vi.fn().mockResolvedValue({
        dialog: {
          open: true,
          targetId: "tab-explicit",
          type: "prompt",
          message: "Enter value"
        }
      })
    };

    const result = await buildBrowserReviewResult({
      manager,
      sessionId: "session-1",
      targetId: "tab-explicit",
      maxChars: 500,
      cursor: "cursor-1"
    });

    expect(manager.snapshot).toHaveBeenCalledWith("session-1", "actionables", 500, "cursor-1", "tab-explicit");
    expect(manager.dialog).toHaveBeenCalledWith("session-1", {
      targetId: "tab-explicit",
      action: "status"
    });
    expect(result).toMatchObject({
      sessionId: "session-1",
      targetId: "tab-explicit",
      url: "https://snapshot.example",
      title: "Snapshot Title",
      nextCursor: "cursor-2",
      warnings: ["warn-1"],
      meta: {
        blockerState: "blocked",
        dialog: {
          open: true,
          targetId: "tab-explicit",
          type: "prompt",
          message: "Enter value"
        }
      }
    });
  });

  it("omits dialog work and optional output fields when no review target exists", async () => {
    const manager = {
      status: vi.fn().mockResolvedValue({
        mode: "managed",
        activeTargetId: null,
        url: "https://status.example",
        title: "Status Title"
      }),
      snapshot: vi.fn().mockResolvedValue({
        snapshotId: "snap-2",
        content: "content",
        truncated: true,
        refCount: 0,
        timingMs: 4
      }),
      dialog: vi.fn()
    };

    const result = await buildBrowserReviewResult({
      manager,
      sessionId: "session-2",
      maxChars: 200
    });

    expect(manager.dialog).not.toHaveBeenCalled();
    expect(result.targetId).toBeNull();
    expect(result.url).toBe("https://status.example");
    expect(result.title).toBe("Status Title");
    expect("nextCursor" in result).toBe(false);
    expect("warnings" in result).toBe(false);
    expect("meta" in result).toBe(false);
  });

  it("synthesizes clear meta when dialog state exists without status meta", async () => {
    const manager = {
      status: vi.fn().mockResolvedValue({
        mode: "extension",
        activeTargetId: "tab-status",
        url: "https://status.example",
        title: "Status Title"
      }),
      snapshot: vi.fn().mockResolvedValue({
        snapshotId: "snap-3",
        content: "content",
        truncated: false,
        refCount: 1,
        timingMs: 5
      }),
      dialog: vi.fn().mockResolvedValue({
        dialog: {
          open: true,
          targetId: "tab-status",
          type: "confirm",
          message: "Proceed?"
        }
      })
    };

    const result = await buildBrowserReviewResult({
      manager,
      sessionId: "session-3",
      maxChars: 250
    });

    expect(manager.dialog).toHaveBeenCalledWith("session-3", {
      targetId: "tab-status",
      action: "status"
    });
    expect(result.meta).toEqual({
      blockerState: "clear",
      dialog: {
        open: true,
        targetId: "tab-status",
        type: "confirm",
        message: "Proceed?"
      }
    });
  });
});
