export type RobotsMode = "strict" | "warn" | "off";

export interface WebCrawlPolicy {
  robotsMode?: RobotsMode;
  allowDomains?: string[];
  denyDomains?: string[];
  robotsBlockedDomains?: string[];
}

export interface CrawlPolicyDecision {
  allowed: boolean;
  warnings: string[];
  reason?: string;
}

const normalizeDomain = (value: string): string => value.trim().toLowerCase();

const includesDomain = (list: string[] | undefined, value: string): boolean => {
  if (!list || list.length === 0) return false;
  const normalized = normalizeDomain(value);
  return list.some((entry) => normalized === normalizeDomain(entry));
};

export const evaluateWebCrawlPolicy = (
  rawUrl: string,
  policy: WebCrawlPolicy = {}
): CrawlPolicyDecision => {
  let hostname = "";
  try {
    hostname = new URL(rawUrl).hostname;
  } catch {
    return {
      allowed: false,
      warnings: [],
      reason: "Invalid URL"
    };
  }

  if (includesDomain(policy.denyDomains, hostname)) {
    return {
      allowed: false,
      warnings: [],
      reason: "Domain denied by policy"
    };
  }

  if ((policy.allowDomains?.length ?? 0) > 0 && !includesDomain(policy.allowDomains, hostname)) {
    return {
      allowed: false,
      warnings: [],
      reason: "Domain not in allow list"
    };
  }

  const mode = policy.robotsMode ?? "warn";
  if (!includesDomain(policy.robotsBlockedDomains, hostname)) {
    return { allowed: true, warnings: [] };
  }

  if (mode === "off") {
    return { allowed: true, warnings: [] };
  }

  if (mode === "warn") {
    return {
      allowed: true,
      warnings: ["Blocked by robots policy but allowed due to warn mode"]
    };
  }

  return {
    allowed: false,
    warnings: [],
    reason: "Blocked by robots policy"
  };
};
