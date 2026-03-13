/* c8 ignore file */
import type { AnnotationCommand, AnnotationResponse } from "./protocol";
import type { RelayStatus } from "./relay-server";

export type RelayLike = {
  status: () => RelayStatus;
  getCdpUrl: () => string | null;
  getAnnotationUrl?: () => string | null;
  getOpsUrl?: () => string | null;
  getCanvasUrl?: () => string | null;
  requestAnnotation?: (command: AnnotationCommand, timeoutMs?: number) => Promise<AnnotationResponse>;
  refresh?: () => Promise<void>;
};
