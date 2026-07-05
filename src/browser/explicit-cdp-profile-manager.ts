import { randomUUID } from "crypto";
import { spawn } from "node:child_process";
import { mkdir } from "fs/promises";
import { resolveCachePaths } from "../cache/paths";
import { findChromeExecutable } from "../cache/chrome-locator";
import { downloadChromeForTesting } from "../cache/downloader";
import { findUnsafeExplicitCdpProfileFlag } from "./explicit-cdp-profile-flags";
import {
  createSessionProfileRegistry,
  sanitizeSessionProfileId
} from "./session-profile-registry";
import {
  deleteExplicitCdpLaunchToken,
  writeExplicitCdpLaunchToken
} from "./explicit-cdp-launch-token";
import {
  isExplicitCdpProcessOwnedByProfile,
  isNodeErrno,
  isProcessAlive,
  probeCdpWsEndpoint,
  reserveLocalPort,
  terminateProcessBestEffort,
  waitForCdpWsEndpoint,
  waitForProcessExit
} from "./explicit-cdp-profile-process";
import {
  readExplicitCdpProfileRecord,
  requireExplicitCdpProfileLaunchToken,
  requireLiveExplicitCdpProfileEndpoint
} from "./explicit-cdp-profile-record";
import {
  recoverOrRejectExplicitCdpLease,
  requireExplicitCdpProfileId
} from "./explicit-cdp-profile-lease";
import type { SessionProfileRecord } from "./session-profile-registry";
import type {
  ExplicitCdpProfileLogger,
  ExplicitCdpProfileManagerInput,
  ExplicitCdpProfileResult,
  ExplicitCdpProfileStartOptions,
  ResolvedExplicitCdpProfile
} from "./explicit-cdp-profile-types";

export type {
  ExplicitCdpProfileLogger,
  ExplicitCdpProfileManagerInput,
  ExplicitCdpProfileResult,
  ExplicitCdpProfileStartOptions,
  ResolvedExplicitCdpProfile
} from "./explicit-cdp-profile-types";

export {
  deleteExplicitCdpLaunchToken,
  explicitCdpLaunchTokenMatches,
  isExplicitCdpLaunchTokenProof
} from "./explicit-cdp-launch-token";
export type { ExplicitCdpLaunchTokenProof } from "./explicit-cdp-launch-token";
export {
  recoverOrRejectExplicitCdpLease,
  requireExplicitCdpProfileId
} from "./explicit-cdp-profile-lease";

const CDP_PROFILE_START_TIMEOUT_MS = 10_000;
const CDP_PROFILE_STOP_TIMEOUT_MS = 5_000;

export class ExplicitCdpProfileManager {
  private readonly worktree: string;
  private readonly getConfig: ExplicitCdpProfileManagerInput["getConfig"];
  private readonly logger: ExplicitCdpProfileLogger;

  constructor(input: ExplicitCdpProfileManagerInput) {
    this.worktree = input.worktree;
    this.getConfig = input.getConfig;
    this.logger = input.logger;
  }

  async start(options: ExplicitCdpProfileStartOptions): Promise<ExplicitCdpProfileResult> {
    const config = this.getConfig();
    const profileId = requireExplicitCdpProfileId(options.profile);
    const cachePaths = await resolveCachePaths(this.worktree, profileId);
    const registry = createSessionProfileRegistry(cachePaths.profileRegistryDir);
    await recoverOrRejectExplicitCdpLease(registry, registry.read(profileId), profileId);
    const executable = await findChromeExecutable(options.chromePath ?? config.chromePath);
    const warnings: string[] = [];
    let executablePath = executable;
    if (!executablePath) {
      const download = await downloadChromeForTesting(cachePaths.chromeDir);
      warnings.push("System Chrome not found. Downloaded Chrome for Testing.");
      executablePath = download.executablePath;
    }
    const port = options.port ?? await reserveLocalPort();
    const occupiedEndpoint = await probeCdpWsEndpoint(port);
    if (occupiedEndpoint) {
      throw new Error(`Port ${port} already exposes a Chrome DevTools endpoint; choose another --cdp-port or stop the existing browser first.`);
    }
    const launchTokenId = randomUUID();
    const profileDir = cachePaths.profileDir;
    await mkdir(profileDir, { recursive: true });
    const flags = options.flags ?? config.flags;
    const unsafeFlag = findUnsafeExplicitCdpProfileFlag(flags);
    if (unsafeFlag) {
      throw new Error(`Refusing explicit CDP profile start with unsafe Chrome flag ${unsafeFlag}; OpenDevBrowser manages profile and CDP endpoint flags.`);
    }
    const args = [
      `--user-data-dir=${profileDir}`,
      "--remote-debugging-address=127.0.0.1",
      `--remote-debugging-port=${port}`,
      "--no-first-run",
      "--no-default-browser-check",
      ...flags,
      options.startUrl?.trim() || "about:blank"
    ];
    const lease = registry.acquireLease(profileId, {
      port,
      launchTokenId,
      acquiredAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString()
    });
    const child = spawn(executablePath, args, { detached: true, stdio: "ignore" });
    child.unref();
    try {
      await waitForCdpWsEndpoint(port, options.readinessTimeoutMs ?? CDP_PROFILE_START_TIMEOUT_MS);
      const now = new Date().toISOString();
      await writeExplicitCdpLaunchToken(profileDir, {
        version: 1,
        profileId,
        launchTokenId,
        port,
        ...(child.pid ? { pid: child.pid } : {}),
        createdAt: now
      });
      const record = registry.upsert({
        profileId,
        displayName: options.profile,
        kind: "explicit_cdp_profile",
        scope: "explicit_local_cdp",
        browserFamily: "chrome",
        persistent: true,
        headless: false,
        pathForHash: profileDir,
        authCapability: "explicit_cdp_profile",
        authProof: "profile_declared",
        endpoint: { host: "127.0.0.1", port },
        lease: {
          ...lease,
          ...(child.pid ? { pid: child.pid } : {}),
          lastSeenAt: now
        }
      });
      return {
        profile: registry.summarize(record),
        ...(child.pid ? { pid: child.pid } : {}),
        port,
        warnings
      };
    } catch (error) {
      await terminateProcessBestEffort(child.pid, CDP_PROFILE_STOP_TIMEOUT_MS);
      registry.releaseLease(profileId, launchTokenId);
      await deleteExplicitCdpLaunchToken(profileDir, this.logger);
      throw error;
    }
  }

  async status(profile: string): Promise<ExplicitCdpProfileResult> {
    const record = await readExplicitCdpProfileRecord(this.worktree, profile);
    if (!record) {
      throw new Error(`No OpenDevBrowser CDP profile record exists for profile "${sanitizeSessionProfileId(profile)}".`);
    }
    const registry = createSessionProfileRegistry((await resolveCachePaths(this.worktree, record.profileId)).profileRegistryDir);
    const staleRecord = record.lease?.pid && !isProcessAlive(record.lease.pid)
      ? registry.releaseLease(record.profileId, record.lease.launchTokenId) ?? record
      : record;
    return {
      profile: registry.summarize(staleRecord),
      ...(staleRecord.lease?.pid ? { pid: staleRecord.lease.pid } : {}),
      ...(staleRecord.endpoint?.port ? { port: staleRecord.endpoint.port } : {}),
      warnings: staleRecord === record ? [] : ["Recorded CDP browser process had exited; released stale profile lease."]
    };
  }

  async stop(profile: string): Promise<ExplicitCdpProfileResult> {
    const config = this.getConfig();
    const record = await readExplicitCdpProfileRecord(this.worktree, profile);
    if (!record) {
      throw new Error(`No OpenDevBrowser CDP profile record exists for profile "${sanitizeSessionProfileId(profile)}".`);
    }
    if (record.kind !== "explicit_cdp_profile" || record.scope !== "explicit_local_cdp") {
      throw new Error("Refusing to stop a browser without an OpenDevBrowser-owned explicit CDP profile record.");
    }
    if (!record.lease?.pid) {
      throw new Error("No OpenDevBrowser-owned CDP browser process is recorded for this profile.");
    }
    const pid = record.lease.pid;
    const cachePaths = await resolveCachePaths(this.worktree, record.profileId);
    const registry = createSessionProfileRegistry(cachePaths.profileRegistryDir);
    if (!isProcessAlive(pid)) {
      return this.releaseExplicitCdpProfileLease(
        record,
        registry,
        cachePaths.profileDir,
        "Recorded CDP browser process was already stopped; released stale profile lease."
      );
    }
    await requireLiveExplicitCdpProfileEndpoint(record, config.security.allowNonLocalCdp);
    await requireExplicitCdpProfileLaunchToken(record, cachePaths.profileDir);
    const leasePort = record.lease.port;
    if (!leasePort) {
      throw new Error("Explicit CDP profile lease is missing a recorded port. Run cdp-profile start again.");
    }
    if (!isExplicitCdpProcessOwnedByProfile(pid, cachePaths.profileDir, leasePort)) {
      return this.releaseExplicitCdpProfileLease(
        record,
        registry,
        cachePaths.profileDir,
        "Recorded CDP browser PID could not be verified as OpenDevBrowser-owned; released the stale profile lease without stopping the process."
      );
    }
    try {
      process.kill(pid, "SIGTERM");
    } catch (error) {
      if (!isNodeErrno(error, "ESRCH")) {
        throw error;
      }
      return this.releaseExplicitCdpProfileLease(
        record,
        registry,
        cachePaths.profileDir,
        "Recorded CDP browser process was already stopped; released stale profile lease."
      );
    }
    await waitForProcessExit(pid, CDP_PROFILE_STOP_TIMEOUT_MS);
    const released = registry.releaseLease(record.profileId, record.lease.launchTokenId) ?? record;
    await deleteExplicitCdpLaunchToken(cachePaths.profileDir, this.logger);
    return {
      profile: registry.summarize(released),
      ...(released.endpoint?.port ? { port: released.endpoint.port } : {}),
      warnings: []
    };
  }

  async resolve(profile: string): Promise<ResolvedExplicitCdpProfile> {
    const config = this.getConfig();
    const profileId = requireExplicitCdpProfileId(profile);
    const cachePaths = await resolveCachePaths(this.worktree, profileId);
    const registry = createSessionProfileRegistry(cachePaths.profileRegistryDir);
    const record = registry.read(profileId);
    if (!record) {
      throw new Error(`No OpenDevBrowser CDP profile record exists for profile "${profileId}". Run cdp-profile start first.`);
    }
    const wsEndpoint = await requireLiveExplicitCdpProfileEndpoint(record, config.security.allowNonLocalCdp);
    await requireExplicitCdpProfileLaunchToken(record, cachePaths.profileDir);
    const lease = record.lease;
    if (!lease?.pid || !lease.port) {
      throw new Error("Explicit CDP profile record is missing a live OpenDevBrowser lease. Run cdp-profile start again.");
    }
    if (!isExplicitCdpProcessOwnedByProfile(lease.pid, cachePaths.profileDir, lease.port)) {
      throw new Error("Recorded OpenDevBrowser CDP profile process could not be verified as profile-owned. Run cdp-profile start again.");
    }
    return { record, wsEndpoint };
  }

  private async releaseExplicitCdpProfileLease(
    record: SessionProfileRecord,
    registry: ReturnType<typeof createSessionProfileRegistry>,
    profileDir: string,
    warning: string
  ): Promise<ExplicitCdpProfileResult> {
    const released = registry.releaseLease(record.profileId, record.lease?.launchTokenId) ?? record;
    await deleteExplicitCdpLaunchToken(profileDir, this.logger);
    return {
      profile: registry.summarize(released),
      ...(released.endpoint?.port ? { port: released.endpoint.port } : {}),
      warnings: [warning]
    };
  }
}
