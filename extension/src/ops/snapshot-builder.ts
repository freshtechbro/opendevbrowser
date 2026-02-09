import { buildSnapshotFromCdp, type SnapshotMode } from "./snapshot-shared.js";

export type { SnapshotMode };

export async function buildSnapshot(
  send: (method: string, params: object) => Promise<unknown>,
  mode: SnapshotMode,
  mainFrameOnly: boolean = true,
  maxNodes?: number
): Promise<{
  entries: Array<{ ref: string; selector: string; backendNodeId: number; frameId?: string; role?: string; name?: string }>;
  lines: string[];
  warnings: string[];
}> {
  return await buildSnapshotFromCdp(send, mode, mainFrameOnly, maxNodes);
}
