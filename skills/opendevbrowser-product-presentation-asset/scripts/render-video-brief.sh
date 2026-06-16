#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: render-video-brief.sh <manifest-json> [output-dir]" >&2
  exit 1
fi

manifest="$1"
outdir="${2:-$(dirname "$manifest")}"
mkdir -p "$outdir"

node - "$manifest" "$outdir" <<'NODE'
const fs = require("fs");
const path = require("path");

const manifestPath = process.argv[2];
const outdir = process.argv[3];
const manifestDir = path.dirname(manifestPath);
const readinessArtifactPath = path.join(manifestDir, "presentation-readiness.json");

const READINESS_SEVERITY = { pass: 0, partial: 1, fail: 2 };
const SUPPORTED_STATUSES = new Set(Object.keys(READINESS_SEVERITY));

function readRequiredJsonFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Manifest not found: ${filePath}`);
  }
  const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Manifest must be a JSON object: ${filePath}`);
  }
  return value;
}

function readOptionalJsonFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeStringArray(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string" && entry.trim()).map((entry) => entry.trim()) : [];
}

function normalizeReadiness(value, label) {
  if (!value || typeof value !== "object") {
    return {
      status: "partial",
      warnings: [`${label} readiness was not present in manifest.readiness`],
      reasonCodes: ["readiness_missing"]
    };
  }
  const status = typeof value.status === "string" && SUPPORTED_STATUSES.has(value.status) ? value.status : "partial";
  const warnings = normalizeStringArray(value.warnings);
  const reasonCodes = normalizeStringArray(value.reasonCodes);
  return {
    status,
    warnings: warnings.length > 0 ? warnings : status === "pass" ? [] : [`${label} readiness requires review`],
    reasonCodes: reasonCodes.length > 0 ? reasonCodes : status === "pass" ? [] : ["readiness_review_required"]
  };
}

function unique(values) {
  return Array.from(new Set(values));
}

function combineReadiness(presentation, productVideo) {
  const status = READINESS_SEVERITY[productVideo.status] > READINESS_SEVERITY[presentation.status]
    ? productVideo.status
    : presentation.status;
  return {
    status,
    warnings: unique([...presentation.warnings, ...productVideo.warnings]),
    reasonCodes: unique([...presentation.reasonCodes, ...productVideo.reasonCodes])
  };
}

function formatList(values, fallback) {
  return values.length > 0 ? values.join(", ") : fallback;
}

function pickVisual(...candidates) {
  return candidates.find((entry) => typeof entry === "string" && entry.length > 0) || noVisualAsset;
}

function tableCell(value) {
  return String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

const data = readRequiredJsonFile(manifestPath);
const readinessArtifact = readOptionalJsonFile(readinessArtifactPath);
const product = data.product || {};
const pricing = product.price || {};
const presentationReadiness = normalizeReadiness(
  data?.readiness?.presentation || product.presentationReadiness || readinessArtifact.presentationReadiness,
  "presentation"
);
const productVideoReadiness = normalizeReadiness(
  data?.readiness?.productVideo || readinessArtifact.productVideoReadiness,
  "productVideo"
);
const readiness = combineReadiness(presentationReadiness, productVideoReadiness);
const readinessStatus = readiness.status;
const reasonCodeText = formatList(readiness.reasonCodes, "none");
const warningLines = readiness.warnings.length > 0 ? readiness.warnings.map((entry) => `- ${entry}`) : ["- none"];

const title = product.title || "Unknown product";
const brand = product.brand || "Unknown brand";
const amount = typeof pricing.amount === "number" ? pricing.amount.toFixed(2) : "N/A";
const currency = pricing.currency || "USD";
const features = Array.isArray(product.features) ? product.features.slice(0, 5) : [];
const copy = typeof product.copy === "string" ? product.copy.trim().slice(0, 600) : "";
const images = Array.isArray(data?.assets?.images) ? data.assets.images : [];
const screenshots = Array.isArray(data?.assets?.screenshots) ? data.assets.screenshots : [];
const rawEvidence = Array.isArray(data?.assets?.raw) ? data.assets.raw : [];
const noVisualAsset = "metadata-only-pack:no-captured-visual";
const hasVisuals = images.length > 0 || screenshots.length > 0;
const featureClaims = readinessStatus === "fail"
  ? ["Readiness failed. Do not use copy.md or features.md as verified production input."]
  : features.length > 0
    ? features
    : ["Review manifest data and add only evidence-backed feature claims"];

const claimRows = featureClaims.map((claim, index) => {
  const evidence = pickVisual(screenshots[index], images[index], images[0], screenshots[0]);
  const verified = readinessStatus === "fail" ? "blocked" : readinessStatus === "partial" ? "gated" : "review_required";
  const sourceField = readinessStatus === "fail" ? "presentation-readiness.json" : `product.features[${index}]`;
  const reasonCode = readiness.reasonCodes[index] || readiness.reasonCodes[0] || "none";
  return `| ${tableCell(claim)} | ${tableCell(evidence)} | ${sourceField} | ${reasonCode} | ${verified} |`;
});

const productionUseLines = {
  pass: [
    "- Production use: allowed after human review of presentation-readiness.json, claims-evidence-map.md, and visual assets.",
    "- The helper is generating normal production briefs because readiness is pass."
  ],
  partial: [
    "- Production use: gated. Resolve warnings and reason codes before final publication.",
    "- The helper is generating draft briefs with constraints, not verified production input."
  ],
  fail: [
    "- Production use: blocked.",
    "- Do not label copy.md, features.md, or product.copy as verified production input."
  ]
}[readinessStatus];

const featureHeading = readinessStatus === "pass" ? "## Production Feature Claims" : "## Gated Feature Candidates";
const copyInput = readinessStatus === "fail"
  ? "Blocked by readiness fail. Do not use captured copy as verified production input."
  : copy || "(No copy captured)";
const briefTitle = readinessStatus === "fail"
  ? "# Product Video Brief Blocked"
  : readinessStatus === "partial"
    ? "# Gated Video Brief"
    : "# Video Brief";

const videoBrief = [
  briefTitle,
  "",
  `- Product: ${title}`,
  `- Brand: ${brand}`,
  `- Price: ${amount} ${currency}`,
  `- Presentation readiness: ${presentationReadiness.status}`,
  `- Product-video readiness: ${productVideoReadiness.status}`,
  `- Production gate: ${readinessStatus}`,
  `- Reason codes: ${reasonCodeText}`,
  `- Visual capture status: ${hasVisuals ? "visual-ready" : "metadata-first"}`,
  `- Raw evidence: ${rawEvidence.length > 0 ? rawEvidence.join(", ") : "not listed"}`,
  "",
  "## Production Use Rules",
  ...productionUseLines,
  "",
  "## Readiness Warnings",
  ...warningLines,
  "",
  featureHeading,
  ...featureClaims.map((entry) => `- ${entry}`),
  "",
  "## Suggested Hook",
  readinessStatus === "fail"
    ? `- "Do not script ${title} until readiness is fixed."`
    : hasVisuals
      ? `- "${title} from ${brand} should open on its strongest evidence-backed benefit and immediate proof."`
      : `- "${title} from ${brand}: finalize visuals first, then lead with the strongest evidence-backed benefit."`,
  "",
  "## Copy Input",
  copyInput,
  "",
  "## Assets",
  `- Images: ${images.length}`,
  `- Screenshots: ${screenshots.length}`,
  `- Additional visual sourcing required: ${hasVisuals ? "no" : "yes"}`,
  "- Claims evidence map: claims-evidence-map.md"
].join("\n");

const blockedAsset = readinessStatus === "fail" ? "readiness-blocked:fix-presentation-readiness" : undefined;
const shotList = [
  "# Shot List",
  "",
  `Production gate: ${readinessStatus}`,
  "",
  "| Scene | Goal | Asset | Voiceover | Duration |",
  "|---|---|---|---|---:|",
  `| 1 | ${readinessStatus === "fail" ? "Blocked" : "Hook"} | ${blockedAsset || pickVisual(screenshots[0], images[0])} | ${readinessStatus === "fail" ? "Fix readiness before scripting" : "Problem + promise"} | 2s |`,
  `| 2 | ${readinessStatus === "fail" ? "Blocked" : "Feature demo"} | ${blockedAsset || pickVisual(images[0], screenshots[0])} | ${readinessStatus === "fail" ? "No production use" : "Show proof"} | 4s |`,
  `| 3 | ${readinessStatus === "fail" ? "Blocked" : "Outcome + CTA"} | ${blockedAsset || pickVisual(images[1], screenshots[1], images[0], screenshots[0])} | ${readinessStatus === "fail" ? "No CTA until fixed" : "Benefit + CTA"} | 4s |`
].join("\n");

const ugcBrief = [
  "# UGC Brief",
  "",
  `Production gate: ${readinessStatus}`,
  "",
  "## Creator Direction",
  readinessStatus === "fail"
    ? "- Do not hand this pack to creators until presentation readiness is fixed."
    : "- Speak as a real user solving a real problem.",
  readinessStatus === "fail"
    ? "- Use presentation-readiness.json as the diagnostic source."
    : "- Show product in use before listing specs.",
  "- Keep claims aligned with captured assets, manifest data, and presentation-readiness.json.",
  "",
  "## CTA",
  readinessStatus === "fail"
    ? "- CTA blocked until readiness passes or partial warnings are resolved."
    : "- Use one clear CTA tied to the strongest evidence-backed benefit."
].join("\n");

const claimsEvidenceMap = [
  "# Claims Evidence Map",
  "",
  `Production gate: ${readinessStatus}`,
  `Reason codes: ${reasonCodeText}`,
  "",
  "| Claim | Evidence Asset Or Field | Source Field | Readiness Reason Code | Verified |",
  "|---|---|---|---|---|",
  ...claimRows
].join("\n");

fs.writeFileSync(path.join(outdir, "video-brief.md"), videoBrief);
fs.writeFileSync(path.join(outdir, "shot-list.md"), shotList);
fs.writeFileSync(path.join(outdir, "ugc-brief.md"), ugcBrief);
fs.writeFileSync(path.join(outdir, "claims-evidence-map.md"), claimsEvidenceMap);

if (readinessStatus === "fail") {
  process.stderr.write(`Product-video readiness failed. Warning-only brief files written to ${outdir}\n`);
  process.exit(2);
}

process.stdout.write(`Video brief files written to ${outdir}\n`);
NODE
