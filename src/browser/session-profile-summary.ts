import { sanitizeProfileWarnings } from "./session-profile-redaction";
import type { SessionProfileRecord, SessionProfileSummary } from "./session-profile-types";

export function summarizeSessionProfileRecord(record: SessionProfileRecord): SessionProfileSummary {
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
