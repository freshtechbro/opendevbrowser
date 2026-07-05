import { resolveCachePaths } from "../cache/paths";
import { ensureLocalEndpoint } from "../utils/endpoint-validation";
import {
  createSessionProfileRegistry,
  sanitizeSessionProfileId,
  type SessionProfileRecord
} from "./session-profile-registry";
import { explicitCdpLaunchTokenMatches, readExplicitCdpLaunchToken } from "./explicit-cdp-launch-token";
import { isProcessAlive, probeCdpWsEndpoint } from "./explicit-cdp-profile-process";

export async function readExplicitCdpProfileRecord(
  worktree: string,
  profile: string
): Promise<SessionProfileRecord | null> {
  const profileId = sanitizeSessionProfileId(profile);
  const cachePaths = await resolveCachePaths(worktree, profileId);
  const registry = createSessionProfileRegistry(cachePaths.profileRegistryDir);
  return registry.read(profileId);
}

export async function requireLiveExplicitCdpProfileEndpoint(
  record: SessionProfileRecord,
  allowNonLocalCdp: boolean
): Promise<string> {
  if (record.kind !== "explicit_cdp_profile" || record.scope !== "explicit_local_cdp") {
    throw new Error("Refusing CDP profile attach because the registry record is not an explicit local CDP profile.");
  }
  const endpoint = record.endpoint;
  const lease = record.lease;
  if (!endpoint || !lease?.pid || !lease.port) {
    throw new Error("Explicit CDP profile record is missing a live OpenDevBrowser lease. Run cdp-profile start again.");
  }
  if (lease.port !== endpoint.port) {
    throw new Error("Explicit CDP profile lease does not match the recorded endpoint. Run cdp-profile start again.");
  }
  if (!isProcessAlive(lease.pid)) {
    throw new Error("Recorded OpenDevBrowser CDP profile process is no longer running. Run cdp-profile start again.");
  }
  const currentEndpoint = await probeCdpWsEndpoint(endpoint.port);
  if (!currentEndpoint) {
    throw new Error("Recorded OpenDevBrowser CDP profile endpoint is not live. Run cdp-profile start again.");
  }
  ensureLocalEndpoint(currentEndpoint, allowNonLocalCdp);
  return currentEndpoint;
}

export async function requireExplicitCdpProfileLaunchToken(
  record: SessionProfileRecord,
  profileDir: string
): Promise<void> {
  const token = await readExplicitCdpLaunchToken(profileDir);
  if (!token || !explicitCdpLaunchTokenMatches(record, token)) {
    throw new Error("Recorded OpenDevBrowser CDP profile launch token does not match the live lease. Refusing to trust this browser.");
  }
}
