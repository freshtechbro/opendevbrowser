#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: analyze-market.sh <shopping-json-file> [json|md] [thresholds-json-file]" >&2
  exit 1
fi

input="$1"
mode="${2:-json}"
script_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
default_thresholds="$script_root/../assets/templates/deal-thresholds.json"
thresholds_file="${3:-$default_thresholds}"

node - "$input" "$mode" "$thresholds_file" <<'NODE'
const fs = require("fs");

const inputPath = process.argv[2];
const mode = process.argv[3] || "json";
const thresholdsPath = process.argv[4];

const nowMs = Date.now();

const defaults = {
  high_percent_threshold: 40,
  high_absolute_threshold: 100,
  min_market_gap_percent: 5,
  min_offer_count_for_confidence: 3,
  max_price_age_hours_for_freshness: 24,
  min_anchor_coverage_for_confidence: 0.5
};

const asNumber = (value, fallback = 0) => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const round2 = (value) => Number(value.toFixed(2));

const parseTimestamp = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value < 1e12 ? value * 1000 : value;
    const dt = new Date(ms);
    return Number.isFinite(dt.getTime()) ? dt : null;
  }
  if (typeof value !== "string" || value.trim() === "") return null;
  const dt = new Date(value);
  return Number.isFinite(dt.getTime()) ? dt : null;
};

const readThresholds = (filePath) => {
  if (!filePath || !fs.existsSync(filePath)) return { ...defaults };
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return {
      high_percent_threshold: asNumber(parsed.high_percent_threshold, defaults.high_percent_threshold),
      high_absolute_threshold: asNumber(parsed.high_absolute_threshold, defaults.high_absolute_threshold),
      min_market_gap_percent: asNumber(parsed.min_market_gap_percent, defaults.min_market_gap_percent),
      min_offer_count_for_confidence: Math.max(1, asNumber(parsed.min_offer_count_for_confidence, defaults.min_offer_count_for_confidence)),
      max_price_age_hours_for_freshness: Math.max(1, asNumber(parsed.max_price_age_hours_for_freshness, defaults.max_price_age_hours_for_freshness)),
      min_anchor_coverage_for_confidence: Math.min(1, Math.max(0, asNumber(parsed.min_anchor_coverage_for_confidence, defaults.min_anchor_coverage_for_confidence)))
    };
  } catch {
    return { ...defaults };
  }
};

const readAnchor = (offer) => {
  const attrs = offer && typeof offer === "object" ? (offer.attributes || {}) : {};
  const candidates = [
    attrs.list_price,
    attrs.original_price,
    attrs.msrp,
    attrs?.shopping_offer?.list_price,
    attrs?.shopping_offer?.original_price,
    attrs?.shopping_offer?.msrp
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "number") return candidate;
    if (candidate && typeof candidate === "object") {
      const amount = asNumber(candidate.amount);
      if (amount > 0) return amount;
    }
    const parsed = asNumber(candidate);
    if (parsed > 0) return parsed;
  }
  return 0;
};

const readRetrievedAt = (offer) => {
  const attrs = offer && typeof offer === "object" ? (offer.attributes || {}) : {};
  const candidates = [
    offer?.retrieved_at,
    offer?.retrievedAt,
    offer?.captured_at,
    offer?.capturedAt,
    attrs.retrieved_at,
    attrs.retrievedAt,
    attrs.captured_at,
    attrs.capturedAt,
    attrs?.shopping_offer?.retrieved_at,
    attrs?.shopping_offer?.captured_at
  ];

  for (const candidate of candidates) {
    const parsed = parseTimestamp(candidate);
    if (parsed) return parsed;
  }
  return null;
};

const pickOffers = (payload) => {
  if (Array.isArray(payload?.offers)) return payload.offers;
  if (Array.isArray(payload?.data?.offers)) return payload.data.offers;
  if (Array.isArray(payload?.context?.offers)) return payload.context.offers;
  if (Array.isArray(payload?.data?.context?.offers)) return payload.data.context.offers;
  return [];
};

const median = (values) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
  return sorted[mid];
};

const payload = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const thresholds = readThresholds(thresholdsPath);

const offers = pickOffers(payload).filter((offer) => offer && typeof offer === "object");
const rows = offers.map((offer) => {
  const currency = String(offer?.price?.currency || offer?.currency || "USD").toUpperCase();
  const item = asNumber(offer?.price?.amount);
  const shipping = asNumber(offer?.shipping?.amount);
  const total = item + shipping;
  const anchor = readAnchor(offer);
  const retrievedAt = readRetrievedAt(offer);
  const priceAgeHours = retrievedAt ? (nowMs - retrievedAt.getTime()) / 3600000 : null;
  const anchorSavingsAbs = anchor > total ? anchor - total : 0;
  const anchorSavingsPct = anchor > 0 ? (anchorSavingsAbs / anchor) * 100 : 0;

  return {
    provider: String(offer.provider || "unknown"),
    title: String(offer.title || "untitled"),
    url: String(offer.url || ""),
    currency,
    total,
    item,
    shipping,
    anchor,
    anchorSavingsAbs,
    anchorSavingsPct,
    dealScore: asNumber(offer?.deal_score),
    retrievedAt: retrievedAt ? retrievedAt.toISOString() : null,
    priceAgeHours
  };
}).filter((row) => row.total > 0);

const byCurrency = new Map();
for (const row of rows) {
  const list = byCurrency.get(row.currency) || [];
  list.push(row);
  byCurrency.set(row.currency, list);
}

const currencySummaries = [];
for (const [currency, list] of byCurrency.entries()) {
  const totals = list.map((row) => row.total);
  const avg = totals.reduce((sum, value) => sum + value, 0) / totals.length;
  const med = median(totals);

  const enriched = list.map((row) => {
    const marketGapAbs = avg - row.total;
    const marketGapPct = avg > 0 ? (marketGapAbs / avg) * 100 : 0;
    const tags = [];
    const flags = [];

    if (row.anchorSavingsPct >= thresholds.high_percent_threshold) tags.push("high_percent");
    if (row.anchorSavingsAbs >= thresholds.high_absolute_threshold) tags.push("high_absolute");
    if (marketGapAbs > 0 && marketGapPct >= thresholds.min_market_gap_percent) tags.push("market_beating");
    if (tags.includes("high_percent") && tags.includes("high_absolute")) tags.push("high_value");

    if (row.anchor <= 0) flags.push("missing_anchor_price");
    if (row.retrievedAt === null) flags.push("missing_price_timestamp");
    if (row.priceAgeHours !== null && row.priceAgeHours > thresholds.max_price_age_hours_for_freshness) flags.push("stale_price");
    if (marketGapAbs <= 0) flags.push("not_below_market_average");

    return {
      ...row,
      marketGapAbs,
      marketGapPct,
      tags,
      flags
    };
  });

  const sortedBest = [...enriched].sort((a, b) => {
    const scoreA = a.marketGapAbs + a.anchorSavingsAbs + a.dealScore;
    const scoreB = b.marketGapAbs + b.anchorSavingsAbs + b.dealScore;
    return scoreB - scoreA;
  });

  const topDiscounts = sortedBest.slice(0, 5).map((row) => ({
    provider: row.provider,
    title: row.title,
    total: round2(row.total),
    market_gap_abs: round2(row.marketGapAbs),
    market_gap_pct: round2(row.marketGapPct),
    anchor_savings_abs: round2(row.anchorSavingsAbs),
    anchor_savings_pct: round2(row.anchorSavingsPct),
    price_age_hours: row.priceAgeHours === null ? null : round2(row.priceAgeHours),
    tags: row.tags,
    flags: row.flags,
    url: row.url
  }));

  const best = [...enriched].sort((a, b) => a.total - b.total || b.dealScore - a.dealScore)[0];
  const savingsVsAvgAbs = avg - best.total;
  const savingsVsAvgPct = avg > 0 ? (savingsVsAvgAbs / avg) * 100 : 0;

  const anchorCoverage = enriched.filter((row) => row.anchor > 0).length / enriched.length;
  const freshCoverage = enriched.filter((row) => row.priceAgeHours !== null && row.priceAgeHours <= thresholds.max_price_age_hours_for_freshness).length / enriched.length;

  const sampleScore = Math.min(enriched.length / thresholds.min_offer_count_for_confidence, 1);
  const anchorScore = thresholds.min_anchor_coverage_for_confidence === 0
    ? 1
    : Math.min(anchorCoverage / thresholds.min_anchor_coverage_for_confidence, 1);
  const freshnessScore = freshCoverage;

  const confidenceScore = (sampleScore * 0.4) + (anchorScore * 0.3) + (freshnessScore * 0.3);
  const warnings = [];
  if (enriched.length < thresholds.min_offer_count_for_confidence) warnings.push("low_sample_size");
  if (anchorCoverage < thresholds.min_anchor_coverage_for_confidence) warnings.push("low_anchor_coverage");
  if (freshCoverage < 0.5) warnings.push("stale_or_missing_prices");

  let tier = "low";
  if (confidenceScore >= 0.75) tier = "high";
  else if (confidenceScore >= 0.5) tier = "medium";

  currencySummaries.push({
    currency,
    offer_count: enriched.length,
    market_average_total: round2(avg),
    market_median_total: round2(med),
    best_offer: {
      provider: best.provider,
      title: best.title,
      total: round2(best.total)
    },
    confidence: {
      score: round2(confidenceScore),
      tier,
      sample_size: enriched.length,
      anchor_coverage: round2(anchorCoverage),
      fresh_price_coverage: round2(freshCoverage),
      warnings
    },
    savings_vs_market_average: {
      absolute: round2(savingsVsAvgAbs),
      percent: round2(savingsVsAvgPct)
    },
    top_discounts: topDiscounts
  });
}

const summary = {
  generated_at: new Date().toISOString(),
  offers_count: rows.length,
  thresholds_used: thresholds,
  currency_summaries: currencySummaries
};

if (mode === "md") {
  const lines = [
    "# Market Deal Analysis",
    "",
    `Offers analyzed: ${summary.offers_count}`,
    ""
  ];

  for (const group of summary.currency_summaries) {
    lines.push(`## ${group.currency}`);
    lines.push(`- Market average total: ${group.market_average_total.toFixed(2)}`);
    lines.push(`- Market median total: ${group.market_median_total.toFixed(2)}`);
    lines.push(`- Best offer: ${group.best_offer.provider} (${group.best_offer.total.toFixed(2)})`);
    lines.push(`- Savings vs average: ${group.savings_vs_market_average.absolute.toFixed(2)} (${group.savings_vs_market_average.percent.toFixed(2)}%)`);
    lines.push(`- Confidence: ${group.confidence.tier} (${group.confidence.score.toFixed(2)})`);
    if (group.confidence.warnings.length > 0) {
      lines.push(`- Warnings: ${group.confidence.warnings.join(", ")}`);
    }
    lines.push("");
    lines.push("| Provider | Product | Total | Market Gap | Anchor Discount | Age(h) | Tags | Flags |");
    lines.push("|---|---|---:|---:|---:|---:|---|---|");
    for (const offer of group.top_discounts) {
      const age = offer.price_age_hours === null ? "n/a" : offer.price_age_hours.toFixed(2);
      lines.push(`| ${offer.provider} | ${offer.title} | ${offer.total.toFixed(2)} | ${offer.market_gap_abs.toFixed(2)} (${offer.market_gap_pct.toFixed(2)}%) | ${offer.anchor_savings_abs.toFixed(2)} (${offer.anchor_savings_pct.toFixed(2)}%) | ${age} | ${offer.tags.join(", ")} | ${offer.flags.join(", ")} |`);
    }
    lines.push("");
  }

  process.stdout.write(lines.join("\n"));
} else {
  process.stdout.write(JSON.stringify(summary, null, 2));
}
NODE
