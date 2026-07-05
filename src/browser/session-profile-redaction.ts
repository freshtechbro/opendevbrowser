import { createHash } from "node:crypto";
import {
  MAX_PROFILE_WARNING_COUNT,
  MAX_PROFILE_WARNING_LENGTH,
  PROFILE_ID_HASH_LENGTH,
  type SessionProfileRecord
} from "./session-profile-types";

const REDACTED_PROFILE_WARNING_URL = "[redacted-url]";
const REDACTED_PROFILE_WARNING_PATH = "[redacted-path]";
const REDACTED_PROFILE_WARNING_EMAIL = "[redacted-email]";

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

export function sanitizeProfileWarnings(value: readonly string[] | undefined): readonly string[] {
  if (!value) {
    return [];
  }
  return value
    .slice(0, MAX_PROFILE_WARNING_COUNT)
    .map(sanitizeProfileWarning)
    .filter((warning) => warning.length > 0);
}

export function sanitizeProfileDisplayName(value: string, profileId: string): string {
  const safeValue = sanitizeProfileWarning(value).trim();
  if (!safeValue || safeValue.includes(REDACTED_PROFILE_WARNING_PATH)) {
    return profileId;
  }
  if (safeValue.includes(REDACTED_PROFILE_WARNING_EMAIL) || safeValue.includes(REDACTED_PROFILE_WARNING_URL)) {
    return profileId;
  }
  return safeValue.slice(0, MAX_PROFILE_WARNING_LENGTH);
}

export function sanitizeSessionProfileRecord(record: SessionProfileRecord): SessionProfileRecord {
  const warnings = sanitizeProfileWarnings(record.warnings);
  const { warnings: _warnings, ...rest } = record;
  return {
    ...rest,
    ...(warnings.length > 0 ? { warnings } : {})
  };
}

export function hashString(value: string, length: number): string {
  return createHash("sha256").update(value).digest("hex").slice(0, length);
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
