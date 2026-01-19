import type { RelayStatus } from "./relay-server";

export type RelayLike = {
  status: () => RelayStatus;
  getCdpUrl: () => string | null;
  refresh?: () => Promise<void>;
};
