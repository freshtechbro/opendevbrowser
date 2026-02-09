/* c8 ignore file */
import type { RelayStatus } from "./relay-server";

export type RelayLike = {
  status: () => RelayStatus;
  getCdpUrl: () => string | null;
  getAnnotationUrl?: () => string | null;
  getOpsUrl?: () => string | null;
  refresh?: () => Promise<void>;
};
