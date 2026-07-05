import {
  MAX_PORT,
  MAX_PROFILE_WARNING_COUNT,
  MAX_PROFILE_WARNING_LENGTH,
  PROFILE_PATH_HASH_PATTERN,
  REGISTRY_SCHEMA_VERSION,
  SESSION_AUTH_CAPABILITIES,
  SESSION_AUTH_PROOFS,
  SESSION_PROFILE_KINDS,
  SESSION_PROFILE_SCOPES,
  type SessionAuthCapability,
  type SessionAuthProof,
  type SessionProfileKind,
  type SessionProfileLease,
  type SessionProfileRecord,
  type SessionProfileScope
} from "./session-profile-types";

const SESSION_PROFILE_KIND_SET = new Set<string>(SESSION_PROFILE_KINDS);
const SESSION_PROFILE_SCOPE_SET = new Set<string>(SESSION_PROFILE_SCOPES);
const SESSION_AUTH_CAPABILITY_SET = new Set<string>(SESSION_AUTH_CAPABILITIES);
const SESSION_AUTH_PROOF_SET = new Set<string>(SESSION_AUTH_PROOFS);

export function isSessionProfileRecord(value: unknown): value is SessionProfileRecord {
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

export function isSessionProfileLease(value: unknown): value is SessionProfileLease {
  if (!isRecord(value)) {
    return false;
  }
  return (value.pid === undefined || isPositiveInteger(value.pid))
    && (value.port === undefined || isPort(value.port))
    && typeof value.launchTokenId === "string"
    && typeof value.acquiredAt === "string"
    && typeof value.lastSeenAt === "string";
}

function isSessionProfileEndpoint(value: unknown): boolean {
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

function isProfileWarnings(value: unknown): value is readonly string[] {
  return Array.isArray(value)
    && value.length <= MAX_PROFILE_WARNING_COUNT
    && value.every((entry) => typeof entry === "string" && entry.length <= MAX_PROFILE_WARNING_LENGTH);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSessionProfileKind(value: unknown): value is SessionProfileKind {
  return typeof value === "string" && SESSION_PROFILE_KIND_SET.has(value);
}

function isSessionProfileScope(value: unknown): value is SessionProfileScope {
  return typeof value === "string" && SESSION_PROFILE_SCOPE_SET.has(value);
}

function isSessionAuthCapability(value: unknown): value is SessionAuthCapability {
  return typeof value === "string" && SESSION_AUTH_CAPABILITY_SET.has(value);
}

function isSessionAuthProof(value: unknown): value is SessionAuthProof {
  return typeof value === "string" && SESSION_AUTH_PROOF_SET.has(value);
}

function isBrowserFamily(value: unknown): value is SessionProfileRecord["browserFamily"] {
  return value === "chromium" || value === "chrome" || value === "unknown";
}

function isProfilePathHash(value: unknown): value is string {
  return typeof value === "string" && PROFILE_PATH_HASH_PATTERN.test(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isPort(value: unknown): value is number {
  return isPositiveInteger(value) && value <= MAX_PORT;
}
