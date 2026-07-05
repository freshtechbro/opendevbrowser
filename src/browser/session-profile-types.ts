export const REGISTRY_SCHEMA_VERSION = 1;
export const MAX_PORT = 65_535;
export const MAX_PROFILE_WARNING_COUNT = 8;
export const MAX_PROFILE_WARNING_LENGTH = 240;
export const PROFILE_ID_HASH_LENGTH = 12;
export const PROFILE_PATH_HASH_LENGTH = 16;
export const PROFILE_PATH_HASH_PATTERN = /^[a-f0-9]{16}$/;

export const SESSION_PROFILE_KINDS = [
  "extension_live",
  "managed_persistent",
  "managed_temporary",
  "explicit_cdp_profile",
  "raw_cdp_unknown",
  "storage_state",
  "cookie_import"
] as const;

export const SESSION_PROFILE_SCOPES = [
  "live_extension",
  "opendevbrowser_owned",
  "temporary",
  "explicit_local_cdp",
  "unknown",
  "scoped_continuity"
] as const;

export const SESSION_AUTH_CAPABILITIES = [
  "public",
  "live_extension",
  "profile_continuity",
  "explicit_cdp_profile",
  "cookie_continuity",
  "blocked"
] as const;

export const SESSION_AUTH_PROOFS = [
  "none",
  "live_extension",
  "profile_declared",
  "cookie_observable",
  "provider_verified"
] as const;

export type SessionProfileKind = (typeof SESSION_PROFILE_KINDS)[number];
export type SessionProfileScope = (typeof SESSION_PROFILE_SCOPES)[number];
export type SessionAuthCapability = (typeof SESSION_AUTH_CAPABILITIES)[number];
export type SessionAuthProof = (typeof SESSION_AUTH_PROOFS)[number];

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
