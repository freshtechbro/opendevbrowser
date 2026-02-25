import metricsData from "@/content/metrics.json";

export type LandingMetric = {
  label: string;
  value: string;
  as_of_utc: string;
  source_command_or_file: string;
  verification_owner: string;
  verification_status: string;
  verification_evidence_ref: string;
};

const data = metricsData as { generatedAt: string; metrics: LandingMetric[] };

export function getVerifiedMetrics(): LandingMetric[] {
  return data.metrics.filter((metric) => metric.verification_status === "verified");
}

export function latestMetricAsOf(): string {
  const timestamps = getVerifiedMetrics().map((metric) => metric.as_of_utc);
  return timestamps.sort().at(-1) ?? new Date().toISOString();
}
