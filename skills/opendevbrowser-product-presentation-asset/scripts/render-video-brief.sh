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

const data = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const product = data.product || {};
const pricing = product.price || {};

const title = product.title || "Unknown product";
const brand = product.brand || "Unknown brand";
const amount = typeof pricing.amount === "number" ? pricing.amount.toFixed(2) : "N/A";
const currency = pricing.currency || "USD";
const features = Array.isArray(product.features) ? product.features.slice(0, 5) : [];
const copy = typeof product.copy === "string" ? product.copy.trim().slice(0, 600) : "";
const images = Array.isArray(data?.assets?.images) ? data.assets.images : [];
const screenshots = Array.isArray(data?.assets?.screenshots) ? data.assets.screenshots : [];

const claimRows = (features.length ? features : ["Add verified feature claims"]).map((claim, index) => {
  const evidence = screenshots[index] || images[index] || images[0] || screenshots[0] || "<asset>";
  return `| ${claim} | ${evidence} | product.features[${index}] | no |`;
});

const videoBrief = [
  "# Video Brief",
  "",
  `- Product: ${title}`,
  `- Brand: ${brand}`,
  `- Price: ${amount} ${currency}`,
  "",
  "## Verified Features",
  ...(features.length ? features.map((entry) => `- ${entry}`) : ["- Add verified feature bullets"]),
  "",
  "## Suggested Hook",
  `- "${title} solves <problem> faster with <core benefit>."`,
  "",
  "## Copy Input",
  copy ? copy : "(No copy captured)",
  "",
  "## Assets",
  `- Images: ${images.length}`,
  `- Screenshots: ${screenshots.length}`,
  "- Claims evidence map: claims-evidence-map.md"
].join("\n");

const shotList = [
  "# Shot List",
  "",
  "| Scene | Goal | Asset | Voiceover | Duration |",
  "|---|---|---|---|---:|",
  `| 1 | Hook | ${screenshots[0] || images[0] || "<asset>"} | Problem + promise | 2s |`,
  `| 2 | Feature demo | ${images[0] || screenshots[0] || "<asset>"} | Show proof | 4s |`,
  `| 3 | Outcome + CTA | ${images[1] || screenshots[1] || images[0] || "<asset>"} | Benefit + CTA | 4s |`
].join("\n");

const ugcBrief = [
  "# UGC Brief",
  "",
  "## Creator Direction",
  "- Speak as a real user solving a real problem.",
  "- Show product in use before listing specs.",
  "- Keep claims aligned with captured assets and manifest data.",
  "",
  "## CTA",
  "- Use one clear CTA tied to the strongest verified benefit."
].join("\n");

const claimsEvidenceMap = [
  "# Claims Evidence Map",
  "",
  "| Claim | Evidence Asset | Source Field | Verified |",
  "|---|---|---|---|",
  ...claimRows
].join("\n");

fs.writeFileSync(path.join(outdir, "video-brief.md"), videoBrief);
fs.writeFileSync(path.join(outdir, "shot-list.md"), shotList);
fs.writeFileSync(path.join(outdir, "ugc-brief.md"), ugcBrief);
fs.writeFileSync(path.join(outdir, "claims-evidence-map.md"), claimsEvidenceMap);

process.stdout.write(`Video brief files written to ${outdir}\n`);
NODE
