import { randomUUID } from "crypto";

export type RefEntry = {
  ref: string;
  selector: string;
  backendNodeId: number;
  snapshotId: string;
  frameId?: string;
  role?: string;
  name?: string;
};

export type RefSnapshot = {
  snapshotId: string;
  targetId: string;
  count: number;
};

type PendingRefEntry = Omit<RefEntry, "snapshotId">;

export class RefStore {
  private refsByTarget = new Map<string, Map<string, RefEntry>>();
  private snapshotByTarget = new Map<string, string>();
  private refCounterByTarget = new Map<string, number>();

  nextRef(targetId: string): string {
    const next = (this.refCounterByTarget.get(targetId) ?? 0) + 1;
    this.refCounterByTarget.set(targetId, next);
    return `r${next}`;
  }

  setSnapshot(targetId: string, entries: PendingRefEntry[]): RefSnapshot {
    const map = new Map<string, RefEntry>();
    const snapshotId = randomUUID();
    for (const entry of entries) {
      map.set(entry.ref, {
        ...entry,
        snapshotId
      });
    }
    this.refsByTarget.set(targetId, map);
    this.snapshotByTarget.set(targetId, snapshotId);

    return { snapshotId, targetId, count: entries.length };
  }

  resolve(targetId: string, ref: string): RefEntry | null {
    const map = this.refsByTarget.get(targetId);
    if (!map) return null;
    return map.get(ref) ?? null;
  }

  getSnapshotId(targetId: string): string | null {
    return this.snapshotByTarget.get(targetId) ?? null;
  }

  getRefCount(targetId: string): number {
    const map = this.refsByTarget.get(targetId);
    return map ? map.size : 0;
  }

  clearTarget(targetId: string): void {
    this.refsByTarget.delete(targetId);
    this.snapshotByTarget.delete(targetId);
  }
}
