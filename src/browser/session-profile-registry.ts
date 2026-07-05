import {
  hashString,
  sanitizeProfileDisplayName,
  sanitizeProfileWarnings,
  sanitizeSessionProfileId
} from "./session-profile-redaction";
import { readLease, readRecord, removeLease, writeLease, writeRecord } from "./session-profile-store";
import { PROFILE_PATH_HASH_LENGTH, REGISTRY_SCHEMA_VERSION, type SessionProfileRegistry } from "./session-profile-types";
import { summarizeSessionProfileRecord } from "./session-profile-summary";
import type { SessionProfileRecord } from "./session-profile-types";

export type {
  SessionAuthCapability,
  SessionAuthProof,
  SessionProfileEndpoint,
  SessionProfileKind,
  SessionProfileLease,
  SessionProfileRecord,
  SessionProfileRecordInput,
  SessionProfileRegistry,
  SessionProfileScope,
  SessionProfileSummary
} from "./session-profile-types";

export { sanitizeSessionProfileId } from "./session-profile-redaction";

export function createSessionProfileRegistry(root: string): SessionProfileRegistry {
  return {
    root,
    acquireLease(profileId, lease) {
      const safeProfileId = sanitizeSessionProfileId(profileId);
      writeLease(root, safeProfileId, lease);
      return lease;
    },
    readLease(profileId) {
      return readLease(root, sanitizeSessionProfileId(profileId));
    },
    upsert(input) {
      const profileId = sanitizeSessionProfileId(input.profileId);
      const existing = readRecord(root, profileId);
      const now = input.updatedAt ?? new Date().toISOString();
      const { pathForHash, warnings, ...safeInput } = input;
      const safeWarnings = sanitizeProfileWarnings(warnings);
      const displayName = sanitizeProfileDisplayName(input.displayName, profileId);
      const record: SessionProfileRecord = {
        schemaVersion: REGISTRY_SCHEMA_VERSION,
        ...safeInput,
        profileId,
        displayName,
        createdAt: input.createdAt ?? existing?.createdAt ?? now,
        updatedAt: now,
        ...(pathForHash ? { pathHash: hashString(pathForHash, PROFILE_PATH_HASH_LENGTH) } : {}),
        ...(safeWarnings.length > 0 ? { warnings: safeWarnings } : {})
      };
      writeRecord(root, record);
      return record;
    },
    read(profileId) {
      return readRecord(root, sanitizeSessionProfileId(profileId));
    },
    releaseLease(profileId, launchTokenId) {
      const safeProfileId = sanitizeSessionProfileId(profileId);
      const lease = readLease(root, safeProfileId);
      if (launchTokenId && lease && lease.launchTokenId !== launchTokenId) {
        throw new Error("Refusing to release profile lease because the launch token does not match.");
      }
      removeLease(root, safeProfileId);
      const record = readRecord(root, safeProfileId);
      if (!record) {
        return null;
      }
      if (launchTokenId && record.lease && record.lease.launchTokenId !== launchTokenId) {
        throw new Error("Refusing to update profile record because the launch token does not match.");
      }
      const { lease: _lease, ...rest } = record;
      const next: SessionProfileRecord = {
        ...rest,
        updatedAt: new Date().toISOString()
      };
      writeRecord(root, next);
      return next;
    },
    summarize(record) {
      return summarizeSessionProfileRecord(record);
    }
  };
}
