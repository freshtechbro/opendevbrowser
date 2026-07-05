import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic } from "../utils/fs";

const PROFILE_ID_HASH_LENGTH = 12;
const PROFILE_PATH_HASH_LENGTH = 16;
const REGISTRY_SCHEMA_VERSION = 1;
const MAX_PORT = 65_535;
const MAX_PROFILE_WARNING_COUNT = 8;
const MAX_PROFILE_WARNING_LENGTH = 240;
const PROFILE_PATH_HASH_PATTERN = /^[a-f0-9]{16}$/;
const REDACTED_PROFILE_WARNING_URL = "[redacted-url]";
const REDACTED_PROFILE_WARNING_PATH = "[redacted-path]";
const REDACTED_PROFILE_WARNING_EMAIL = "[redacted-email]";
const SESSION_PROFILE_KINDS = new Set<SessionProfileKind>([
  "extension_live",
  "managed_persistent",
  "managed_temporary",
  "explicit_cdp_profile",
  "raw_cdp_unknown",
  "storage_state",
  "cookie_import"
]);
const SESSION_PROFILE_SCOPES = new Set<SessionProfileScope>([
  "live_extension",
  "opendevbrowser_owned",
  "temporary",
  "explicit_local_cdp",
  "unknown",
  "scoped_continuity"
]);
const SESSION_AUTH_CAPABILITIES = new Set<SessionAuthCapability>([
  "public",
  "live_extension",
  "profile_continuity",
  "explicit_cdp_profile",
  "cookie_continuity",
  "blocked"
]);
const SESSION_AUTH_PROOFS = new Set<SessionAuthProof>([
  "none",
  "live_extension",
  "profile_declared",
  "cookie_observable",
  "provider_verified"
]);

export type SessionProfileKind =
  | "extension_live"
  | "managed_persistent"
  | "managed_temporary"
  | "explicit_cdp_profile"
  | "raw_cdp_unknown"
  | "storage_state"
  | "cookie_import";

export type SessionProfileScope =
  | "live_extension"
  | "opendevbrowser_owned"
  | "temporary"
  | "explicit_local_cdp"
  | "unknown"
  | "scoped_continuity";

export type SessionAuthCapability =
  | "public"
  | "live_extension"
  | "profile_continuity"
  | "explicit_cdp_profile"
  | "cookie_continuity"
  | "blocked";

export type SessionAuthProof =
  | "none"
  | "live_extension"
  | "profile_declared"
  | "cookie_observable"
  | "provider_verified";

export type SessionProfileLease = {
  readonly pid?: number;
  readonly port?: number;
  readonly launchTokenId: string;
  readonly acquiredAt: string;
  readonly lastSeenAt: string;
};

export type SessionProfileEndpoint = {
  readonly host: "127.0.0.1" | "localhost" | "::1";
  readonly port: number;
};

export type SessionProfileRecord = {
  readonly schemaVersion: typeof REGISTRY_SCHEMA_VERSION;
  readonly profileId: string;
  readonly displayName: string;
  readonly kind: SessionProfileKind;
  readonly scope: SessionProfileScope;
  readonly browserFamily: "chromium" | "chrome" | "unknown";
  readonly persistent: boolean;
  readonly headless: boolean;
  readonly authCapability: SessionAuthCapability;
  readonly authProof: SessionAuthProof;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly pathHash?: string;
  readonly endpoint?: SessionProfileEndpoint;
  readonly lease?: SessionProfileLease;
  readonly warnings?: readonly string[];
};

export type SessionProfileRecordInput = Omit<
  SessionProfileRecord,
  "schemaVersion" | "createdAt" | "updatedAt" | "pathHash"
> & {
  readonly pathForHash?: string;
  readonly createdAt?: string;
  readonly updatedAt?: string;
};

export type SessionProfileSummary = Omit<SessionProfileRecord, "schemaVersion" | "createdAt" | "updatedAt" | "lease" | "endpoint"> & {
  readonly endpoint?: SessionProfileEndpoint;
  readonly lease?: Omit<SessionProfileLease, "launchTokenId"> & { readonly active: boolean };
};

export type SessionProfileRegistry = {
  readonly root: string;
  acquireLease(profileId: string, lease: SessionProfileLease): SessionProfileLease;
  readLease(profileId: string): SessionProfileLease | null;
  upsert(input: SessionProfileRecordInput): SessionProfileRecord;
  read(profileId: string): SessionProfileRecord | null;
  releaseLease(profileId: string, launchTokenId?: string): SessionProfileRecord | null;
  summarize(record: SessionProfileRecord): SessionProfileSummary;
};

export function sanitizeSessionProfileId(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  if (normalized.length > 0) {
    return normalized.slice(0, 80);
  }
  return `profile-${hashString(value || "default", PROFILE_ID_HASH_LENGTH)}`;
}

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
      const endpoint = record.endpoint
        ? { host: record.endpoint.host, port: record.endpoint.port }
        : undefined;
      return {
        profileId: record.profileId,
        displayName: record.displayName,
        kind: record.kind,
        scope: record.scope,
        browserFamily: record.browserFamily,
        persistent: record.persistent,
        headless: record.headless,
        authCapability: record.authCapability,
        authProof: record.authProof,
        ...(record.pathHash ? { pathHash: record.pathHash } : {}),
        ...(endpoint ? { endpoint } : {}),
        ...(record.lease ? {
          lease: {
            ...(typeof record.lease.pid === "number" ? { pid: record.lease.pid } : {}),
            ...(typeof record.lease.port === "number" ? { port: record.lease.port } : {}),
            acquiredAt: record.lease.acquiredAt,
            lastSeenAt: record.lease.lastSeenAt,
            active: true
          }
        } : {}),
        ...(record.warnings ? { warnings: sanitizeProfileWarnings(record.warnings) } : {})
      };
    }
  };
}

function recordPath(root: string, profileId: string): string {
  return join(root, `${profileId}.json`);
}

function leasePath(root: string, profileId: string): string {
  return join(root, `${profileId}.lock`);
}

function writeLease(root: string, profileId: string, lease: SessionProfileLease): void {
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
    if (isAlreadyExistsError(error)) {
      throw new Error(`Profile "${profileId}" is already running. Use a different profile name or stop the existing profile first.`);
    }
    throw error;
  } finally {
    if (fd !== null) {
      closeSync(fd);
    }
  }
}

function readLease(root: string, profileId: string): SessionProfileLease | null {
  try {
    const parsed = JSON.parse(readFileSync(leasePath(root, profileId), "utf8")) as unknown;
    return isSessionProfileLease(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function removeLease(root: string, profileId: string): void {
  try {
    unlinkSync(leasePath(root, profileId));
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
  }
}

function writeRecord(root: string, record: SessionProfileRecord): void {
  writeFileAtomic(recordPath(root, record.profileId), `${JSON.stringify(record, null, 2)}\n`, {
    encoding: "utf-8",
    mode: 0o600
  });
}

function readRecord(root: string, profileId: string): SessionProfileRecord | null {
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

function isSessionProfileRecord(value: unknown): value is SessionProfileRecord {
  if (!isRecord(value)) {
    return false;
  }
  return value.schemaVersion === REGISTRY_SCHEMA_VERSION
    && typeof value.profileId === "string"
    && typeof value.displayName === "string"
    && isSessionProfileKind(value.kind)
    && isSessionProfileScope(value.scope)
    && isBrowserFamily(value.browserFamily)
    && typeof value.persistent === "boolean"
    && typeof value.headless === "boolean"
    && isSessionAuthCapability(value.authCapability)
    && isSessionAuthProof(value.authProof)
    && typeof value.createdAt === "string"
    && typeof value.updatedAt === "string"
    && (value.pathHash === undefined || isProfilePathHash(value.pathHash))
    && (value.endpoint === undefined || isSessionProfileEndpoint(value.endpoint))
    && (value.lease === undefined || isSessionProfileLease(value.lease))
    && (value.warnings === undefined || isProfileWarnings(value.warnings));
}

function sanitizeSessionProfileRecord(record: SessionProfileRecord): SessionProfileRecord {
  const warnings = sanitizeProfileWarnings(record.warnings);
  const { warnings: _warnings, ...rest } = record;
  return {
    ...rest,
    ...(warnings.length > 0 ? { warnings } : {})
  };
}

function isProfilePathHash(value: unknown): value is string {
  return typeof value === "string" && PROFILE_PATH_HASH_PATTERN.test(value);
}

function isProfileWarnings(value: unknown): value is readonly string[] {
  return Array.isArray(value)
    && value.length <= MAX_PROFILE_WARNING_COUNT
    && value.every((entry) => typeof entry === "string" && entry.length <= MAX_PROFILE_WARNING_LENGTH);
}

function sanitizeProfileWarnings(value: readonly string[] | undefined): readonly string[] {
  if (!value) {
    return [];
  }
  return value
    .slice(0, MAX_PROFILE_WARNING_COUNT)
    .map(sanitizeProfileWarning)
    .filter((warning) => warning.length > 0);
}

function sanitizeProfileDisplayName(value: string, profileId: string): string {
  const safeValue = sanitizeProfileWarning(value).trim();
  if (!safeValue || safeValue.includes(REDACTED_PROFILE_WARNING_PATH)) {
    return profileId;
  }
  if (safeValue.includes(REDACTED_PROFILE_WARNING_EMAIL) || safeValue.includes(REDACTED_PROFILE_WARNING_URL)) {
    return profileId;
  }
  return safeValue.slice(0, MAX_PROFILE_WARNING_LENGTH);
}

function sanitizeProfileWarning(value: string): string {
  return value
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, REDACTED_PROFILE_WARNING_EMAIL)
    .replace(/\b(?:wss?|https?):\/\/\S+/giu, REDACTED_PROFILE_WARNING_URL)
    .replace(/\/Users\/.*$/gu, REDACTED_PROFILE_WARNING_PATH)
    .replace(/\/home\/[^/\s]+\/.*$/gu, REDACTED_PROFILE_WARNING_PATH)
    .replace(/\/root(?:\/.*)?$/gu, REDACTED_PROFILE_WARNING_PATH)
    .replace(/[A-Z]:\\Users\\.*$/giu, REDACTED_PROFILE_WARNING_PATH)
    .replace(/devtools\/browser\/\S+/giu, "devtools/browser/[redacted]")
    .trim()
    .slice(0, MAX_PROFILE_WARNING_LENGTH);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSessionProfileKind(value: unknown): value is SessionProfileKind {
  return typeof value === "string" && SESSION_PROFILE_KINDS.has(value as SessionProfileKind);
}

function isSessionProfileScope(value: unknown): value is SessionProfileScope {
  return typeof value === "string" && SESSION_PROFILE_SCOPES.has(value as SessionProfileScope);
}

function isSessionAuthCapability(value: unknown): value is SessionAuthCapability {
  return typeof value === "string" && SESSION_AUTH_CAPABILITIES.has(value as SessionAuthCapability);
}

function isSessionAuthProof(value: unknown): value is SessionAuthProof {
  return typeof value === "string" && SESSION_AUTH_PROOFS.has(value as SessionAuthProof);
}

function isBrowserFamily(value: unknown): value is SessionProfileRecord["browserFamily"] {
  return value === "chromium" || value === "chrome" || value === "unknown";
}

function isSessionProfileEndpoint(value: unknown): value is SessionProfileEndpoint {
  if (!isRecord(value)) {
    return false;
  }
  return (value.host === "127.0.0.1" || value.host === "localhost" || value.host === "::1")
    && typeof value.port === "number"
    && Number.isInteger(value.port)
    && value.port > 0
    && value.port <= MAX_PORT
    && value.wsEndpoint === undefined;
}

function isSessionProfileLease(value: unknown): value is SessionProfileLease {
  if (!isRecord(value)) {
    return false;
  }
  return (value.pid === undefined || isPositiveInteger(value.pid))
    && (value.port === undefined || isPort(value.port))
    && typeof value.launchTokenId === "string"
    && typeof value.acquiredAt === "string"
    && typeof value.lastSeenAt === "string";
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isPort(value: unknown): value is number {
  return isPositiveInteger(value) && value <= MAX_PORT;
}

function hashString(value: string, length: number): string {
  return createHash("sha256").update(value).digest("hex").slice(0, length);
}

function isAlreadyExistsError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === "EEXIST";
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === "ENOENT";
}
