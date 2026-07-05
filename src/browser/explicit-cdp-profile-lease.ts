import {
  sanitizeSessionProfileId,
  type SessionProfileRecord,
  type SessionProfileRegistry
} from "./session-profile-registry";
import { isProcessAlive, probeCdpWsEndpoint } from "./explicit-cdp-profile-process";

const RESERVED_CDP_PROFILE_IDS = new Set(["default"]);

export function requireExplicitCdpProfileId(profile: string): string {
  const profileId = sanitizeSessionProfileId(profile);
  if (RESERVED_CDP_PROFILE_IDS.has(profileId)) {
    throw new Error("Explicit CDP profiles must use a named non-default OpenDevBrowser profile.");
  }
  return profileId;
}

export async function recoverOrRejectExplicitCdpLease(
  registry: SessionProfileRegistry,
  record: SessionProfileRecord | null,
  profileId?: string
): Promise<void> {
  const lease = record?.lease ?? (profileId ? registry.readLease(profileId) : null);
  const safeProfileId = record?.profileId ?? profileId;
  if (!lease || !safeProfileId) {
    return;
  }
  const pidAlive = typeof lease.pid === "number" && isProcessAlive(lease.pid);
  const portAlive = typeof lease.port === "number"
    && await probeCdpWsEndpoint(lease.port) !== null;
  if (pidAlive || portAlive) {
    throw new Error(`CDP profile "${safeProfileId}" is already running. Use cdp-profile status or cdp-profile stop before starting it again.`);
  }
  registry.releaseLease(safeProfileId, lease.launchTokenId);
}
