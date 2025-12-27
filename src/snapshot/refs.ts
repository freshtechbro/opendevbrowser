import { randomUUID } from "crypto";

export type RefEntry = {
  ref: string;
  selector: string;
  backendNodeId: number;
  frameId?: string;
  role?: string;
  name?: string;
};

export type RefSnapshot = {
  snapshotId: string;
  targetId: string;
  count: number;
};

export class RefStore {
  private refsByTarget = new Map<string, Map<string, RefEntry>>();
  private snapshotByTarget = new Map<string, string>();

  setSnapshot(targetId: string, entries: RefEntry[]): RefSnapshot {
    const map = new Map<string, RefEntry>();
    for (const entry of entries) {
      map.set(entry.ref, entry);
    }

    const snapshotId = randomUUID();
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
