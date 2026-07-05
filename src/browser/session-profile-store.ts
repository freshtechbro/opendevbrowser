import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic } from "../utils/fs";
import { sanitizeSessionProfileRecord } from "./session-profile-redaction";
import { isSessionProfileLease, isSessionProfileRecord } from "./session-profile-validation";
import type { SessionProfileLease, SessionProfileRecord } from "./session-profile-types";

export function writeLease(root: string, profileId: string, lease: SessionProfileLease): void {
  if (!isSessionProfileLease(lease)) {
    throw new Error("Invalid profile lease.");
  }
  mkdirSync(root, { recursive: true });
  const path = leasePath(root, profileId);
  let fd: number | null = null;
  try {
    fd = openSync(path, "wx", 0o600);
    writeFileSync(fd, `${JSON.stringify(lease, null, 2)}\n`, { encoding: "utf8" });
  } catch (error) {
    if (isNodeErrno(error, "EEXIST")) {
      throw new Error(`Profile "${profileId}" is already running. Use a different profile name or stop the existing profile first.`);
    }
    throw error;
  } finally {
    if (fd !== null) {
      closeSync(fd);
    }
  }
}

export function readLease(root: string, profileId: string): SessionProfileLease | null {
  try {
    const parsed = JSON.parse(readFileSync(leasePath(root, profileId), "utf8")) as unknown;
    return isSessionProfileLease(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function removeLease(root: string, profileId: string): void {
  try {
    unlinkSync(leasePath(root, profileId));
  } catch (error) {
    if (!isNodeErrno(error, "ENOENT")) {
      throw error;
    }
  }
}

export function writeRecord(root: string, record: SessionProfileRecord): void {
  writeFileAtomic(recordPath(root, record.profileId), `${JSON.stringify(record, null, 2)}\n`, {
    encoding: "utf-8",
    mode: 0o600
  });
}

export function readRecord(root: string, profileId: string): SessionProfileRecord | null {
  const path = recordPath(root, profileId);
  if (!existsSync(path)) {
    return null;
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return isSessionProfileRecord(parsed) ? sanitizeSessionProfileRecord(parsed) : null;
  } catch {
    return null;
  }
}

function recordPath(root: string, profileId: string): string {
  return join(root, `${profileId}.json`);
}

function leasePath(root: string, profileId: string): string {
  return join(root, `${profileId}.lock`);
}

function isNodeErrno(error: unknown, code: string): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { readonly code?: unknown }).code === code;
}
