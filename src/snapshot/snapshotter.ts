import type { Page } from "playwright-core";
import type { RefStore } from "./refs";
import { buildSnapshotFromCdp, selectorFunction, type SnapshotMode } from "./ops-snapshot";

export { selectorFunction };

export type SnapshotResult = {
  snapshotId: string;
  url?: string;
  title?: string;
  content: string;
  truncated: boolean;
  nextCursor?: string;
  refCount: number;
  timingMs: number;
  warnings?: string[];
};

export class Snapshotter {
  private refStore: RefStore;

  constructor(refStore: RefStore) {
    this.refStore = refStore;
  }

  async snapshot(page: Page, targetId: string, options: {
    mode: SnapshotMode;
    maxChars: number;
    cursor?: string;
    mainFrameOnly?: boolean;
    maxNodes?: number;
  }): Promise<SnapshotResult> {
    const startTime = Date.now();
    const session = await page.context().newCDPSession(page);
    let snapshotData: {
      entries: Array<{ ref: string; selector: string; backendNodeId: number; frameId?: string; role?: string; name?: string }>;
      lines: string[];
      warnings: string[];
    };
    try {
      snapshotData = await buildSnapshotFromCdp(
        (method, params) => session.send(method, params),
        options.mode,
        options.mainFrameOnly ?? true,
        options.maxNodes
      );
    } finally {
      await session.detach();
    }

    const snapshot = this.refStore.setSnapshot(targetId, snapshotData.entries);
    const formatted = snapshotData.lines;

    const startIndex = parseCursor(options.cursor);
    const { content, truncated, nextCursor } = paginate(formatted, startIndex, options.maxChars);

    const timingMs = Date.now() - startTime;
    let url: string | undefined;
    let title: string | undefined;

    try {
      url = page.url();
      title = await page.title();
    } catch (_err) {
      // Page may be closed or navigating; safely ignore and return undefined
      void _err;
      url = undefined;
      title = undefined;
    }

    return {
      snapshotId: snapshot.snapshotId,
      url,
      title,
      content,
      truncated,
      nextCursor,
      refCount: snapshot.count,
      timingMs,
      warnings: snapshotData.warnings
    };
  }
}

function parseCursor(cursor?: string): number {
  if (!cursor) return 0;
  const value = Number(cursor);
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

function paginate(lines: string[], startIndex: number, maxChars: number): {
  content: string;
  truncated: boolean;
  nextCursor?: string;
} {
  let total = 0;
  const parts: string[] = [];
  let idx = startIndex;

  while (idx < lines.length) {
    const line = lines[idx];
    /* v8 ignore next -- @preserve */
    if (line === undefined) {
      break;
    }
    if (total + line.length + 1 > maxChars && parts.length > 0) {
      break;
    }
    parts.push(line);
    total += line.length + 1;
    idx += 1;
  }

  const truncated = idx < lines.length;
  const nextCursor = truncated ? String(idx) : undefined;
  return {
    content: parts.join("\n"),
    truncated,
    nextCursor
  };
}
