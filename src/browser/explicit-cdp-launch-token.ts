import { readFile, unlink, writeFile } from "fs/promises";
import { join } from "path";
import type { SessionProfileRecord } from "./session-profile-registry";
import { getNodeErrnoCode, isNodeErrno } from "./explicit-cdp-profile-process";
import type { ExplicitCdpProfileLogger } from "./explicit-cdp-profile-types";

const CDP_PROFILE_LAUNCH_TOKEN_FILE = ".opendevbrowser-cdp-launch-token.json";

export type ExplicitCdpLaunchTokenProof = {
  readonly version: 1;
  readonly profileId: string;
  readonly launchTokenId: string;
  readonly port: number;
  readonly pid?: number;
  readonly createdAt: string;
};

export async function writeExplicitCdpLaunchToken(
  profileDir: string,
  token: ExplicitCdpLaunchTokenProof
): Promise<void> {
  await writeFile(
    explicitCdpLaunchTokenPath(profileDir),
    `${JSON.stringify(token, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 }
  );
}

export async function readExplicitCdpLaunchToken(profileDir: string): Promise<ExplicitCdpLaunchTokenProof | null> {
  try {
    const raw = await readFile(explicitCdpLaunchTokenPath(profileDir), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return isExplicitCdpLaunchTokenProof(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function deleteExplicitCdpLaunchToken(
  profileDir: string,
  logger?: ExplicitCdpProfileLogger
): Promise<void> {
  try {
    await unlink(explicitCdpLaunchTokenPath(profileDir));
  } catch (error) {
    if (isNodeErrno(error, "ENOENT")) {
      return;
    }
    logger?.warn("cdp.profile_launch_token.cleanup_failed", {
      data: { errorCode: getNodeErrnoCode(error) }
    });
  }
}

export function isExplicitCdpLaunchTokenProof(value: unknown): value is ExplicitCdpLaunchTokenProof {
  if (!isRecord(value)) {
    return false;
  }
  return value.version === 1
    && typeof value.profileId === "string"
    && typeof value.launchTokenId === "string"
    && typeof value.port === "number"
    && Number.isInteger(value.port)
    && value.port > 0
    && (value.pid === undefined || typeof value.pid === "number")
    && typeof value.createdAt === "string";
}

export function explicitCdpLaunchTokenMatches(
  record: SessionProfileRecord,
  token: ExplicitCdpLaunchTokenProof
): boolean {
  const lease = record.lease;
  const endpoint = record.endpoint;
  if (!lease || !endpoint) {
    return false;
  }
  return token.profileId === record.profileId
    && token.launchTokenId === lease.launchTokenId
    && token.port === lease.port
    && token.port === endpoint.port
    && (typeof lease.pid !== "number" || token.pid === lease.pid);
}

function explicitCdpLaunchTokenPath(profileDir: string): string {
  return join(profileDir, CDP_PROFILE_LAUNCH_TOKEN_FILE);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
