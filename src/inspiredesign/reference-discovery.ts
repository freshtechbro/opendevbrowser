import type { NormalizedRecord } from "../providers/types";

export type InspiredesignDiscoveryRejectionReason =
  | "missing_url"
  | "invalid_url"
  | "duplicate_url";

export type InspiredesignAcceptedDiscoveryCandidate = {
  status: "accepted";
  url: string;
  title?: string;
  source: NormalizedRecord["source"];
  provider: string;
  rank: number;
};

export type InspiredesignRejectedDiscoveryCandidate = {
  status: "rejected";
  title?: string;
  source: NormalizedRecord["source"];
  provider: string;
  rank: number;
  reason: InspiredesignDiscoveryRejectionReason;
  rawUrl?: string;
};

export type InspiredesignDiscoveryCandidate =
  | InspiredesignAcceptedDiscoveryCandidate
  | InspiredesignRejectedDiscoveryCandidate;

export type InspiredesignDiscoveryResult = {
  accepted: InspiredesignAcceptedDiscoveryCandidate[];
  rejected: InspiredesignRejectedDiscoveryCandidate[];
};

const normalizeHttpUrl = (value: string): string | null => {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    if (url.pathname === "/" && !/^https?:\/\/[^/]+\/[^?#]/i.test(value)) {
      return `${url.origin}${url.search}`;
    }
    return url.toString();
  } catch (error) {
    void error;
    return null;
  }
};

export const sanitizeRejectedInspiredesignDiscoveryUrl = (value: string): string | undefined => {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch (error) {
    void error;
    return undefined;
  }
};

export const extractInspiredesignDiscoveryUrl = (record: Pick<NormalizedRecord, "url">): string | null => {
  if (typeof record.url !== "string") return null;
  const trimmed = record.url.trim();
  if (!trimmed) return null;
  return normalizeHttpUrl(trimmed);
};

export const normalizeInspiredesignDiscoveryRecords = (
  records: NormalizedRecord[]
): InspiredesignDiscoveryResult => {
  const seen = new Set<string>();
  const accepted: InspiredesignAcceptedDiscoveryCandidate[] = [];
  const rejected: InspiredesignRejectedDiscoveryCandidate[] = [];

  records.forEach((record, index) => {
    const rawUrl = typeof record.url === "string" ? record.url.trim() : undefined;
    const url = extractInspiredesignDiscoveryUrl(record);
    const base = {
      ...(record.title ? { title: record.title } : {}),
      source: record.source,
      provider: record.provider,
      rank: index + 1
    };
    if (!rawUrl) {
      rejected.push({ ...base, status: "rejected", reason: "missing_url" });
      return;
    }
    if (!url) {
      const safeRawUrl = sanitizeRejectedInspiredesignDiscoveryUrl(rawUrl);
      rejected.push({
        ...base,
        status: "rejected",
        reason: "invalid_url",
        ...(safeRawUrl ? { rawUrl: safeRawUrl } : {})
      });
      return;
    }
    if (seen.has(url)) {
      const safeRawUrl = sanitizeRejectedInspiredesignDiscoveryUrl(rawUrl);
      rejected.push({
        ...base,
        status: "rejected",
        reason: "duplicate_url",
        ...(safeRawUrl ? { rawUrl: safeRawUrl } : {})
      });
      return;
    }
    seen.add(url);
    accepted.push({ ...base, status: "accepted", url });
  });

  return { accepted, rejected };
};

export const mergeInspiredesignReferenceUrls = (
  explicitUrls: string[],
  discoveredUrls: string[],
  maxReferences: number
): string[] => {
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const url of [...explicitUrls, ...discoveredUrls]) {
    const normalized = normalizeHttpUrl(url.trim());
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    merged.push(normalized);
    if (merged.length >= maxReferences) return merged;
  }
  return merged;
};

export const normalizeInspiredesignProviders = (providers: string[] | undefined): string[] => {
  const normalized = (providers ?? [])
    .map((provider) => provider.trim())
    .filter((provider) => provider.length > 0);
  return [...new Set(normalized)];
};
