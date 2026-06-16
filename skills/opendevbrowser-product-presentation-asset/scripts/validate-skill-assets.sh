#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
skill_file="$root/SKILL.md"

required=(
  "artifacts/asset-pack-assembly.md"
  "artifacts/ugc-creative-guide.md"
  "assets/templates/manifest.schema.json"
  "assets/templates/copy.md"
  "assets/templates/features.md"
  "assets/templates/video-assembly.md"
  "assets/templates/user-actions.md"
  "assets/templates/ugc-concepts.md"
  "assets/templates/shot-list.md"
  "assets/templates/claims-evidence-map.md"
  "scripts/collect-product.sh"
  "scripts/capture-screenshots.sh"
  "scripts/download-images.sh"
  "scripts/write-manifest.sh"
  "scripts/render-video-brief.sh"
  "scripts/validate-skill-assets.sh"
)

status=0
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

metadata_manifest="$tmpdir/metadata-only-manifest.json"
fail_manifest="$tmpdir/fail-manifest.json"
drift_dir="$tmpdir/readiness-drift"
drift_manifest="$drift_dir/manifest.json"
mismatch_dir="$tmpdir/readiness-mismatch"
mismatch_manifest="$mismatch_dir/manifest.json"
malformed_dir="$tmpdir/readiness-malformed-pass"
malformed_manifest="$malformed_dir/manifest.json"
failed_criteria_dir="$tmpdir/readiness-failed-criteria"
failed_criteria_manifest="$failed_criteria_dir/manifest.json"
malformed_sidecar_dir="$tmpdir/readiness-malformed-sidecar"
malformed_sidecar_manifest="$malformed_sidecar_dir/manifest.json"
mixed_reason_dir="$tmpdir/readiness-mixed-reason"
mixed_reason_manifest="$mixed_reason_dir/manifest.json"
product_drift_dir="$tmpdir/readiness-product-drift"
product_drift_manifest="$product_drift_dir/manifest.json"
claim_drift_dir="$tmpdir/readiness-claim-drift"
claim_drift_manifest="$claim_drift_dir/manifest.json"
node -e '
const fs = require("fs");
const input = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
input.assets = { images: [], screenshots: [], raw: input.assets?.raw || [] };
input.readiness = {
  presentation: {
    status: "partial",
    warnings: ["missing visual assets"],
    reasonCodes: ["missing_visual_assets"],
    criteria: []
  },
  productVideo: {
    status: "partial",
    warnings: ["missing visual assets"],
    reasonCodes: ["missing_visual_assets"],
    criteria: []
  }
};
fs.writeFileSync(process.argv[2], JSON.stringify(input, null, 2));
input.readiness.presentation.status = "fail";
input.readiness.presentation.warnings = ["clean feature evidence missing"];
input.readiness.presentation.reasonCodes = ["insufficient_clean_feature_evidence", "copy_generation_blocked"];
input.readiness.productVideo = input.readiness.presentation;
fs.writeFileSync(process.argv[3], JSON.stringify(input, null, 2));
' "$root/examples/sample-manifest.json" "$metadata_manifest" "$fail_manifest"
node -e '
const fs = require("fs");
const path = require("path");
const input = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const outDir = process.argv[2];
fs.mkdirSync(outDir, { recursive: true });
input.product.presentationReadiness = {
  status: "pass",
  warnings: [],
  reasonCodes: ["positive_spec_promoted"],
  criteria: []
};
input.readiness.presentation = {
  warnings: ["malformed manifest readiness"],
  reasonCodes: ["positive_spec_promoted"],
  criteria: []
};
input.readiness.productVideo = {
  status: "pass",
  warnings: [],
  reasonCodes: ["positive_spec_promoted"],
  criteria: []
};
fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(input, null, 2));
const failedReadiness = {
  status: "fail",
  warnings: ["clean feature evidence missing"],
  reasonCodes: ["insufficient_clean_feature_evidence", "copy_generation_blocked"],
  criteria: []
};
fs.writeFileSync(path.join(outDir, "presentation-readiness.json"), JSON.stringify({
  presentationReadiness: failedReadiness,
  productVideoReadiness: failedReadiness
}, null, 2));
' "$root/examples/sample-manifest.json" "$drift_dir"
node -e '
const fs = require("fs");
const path = require("path");
const input = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const mismatchDir = process.argv[2];
const malformedDir = process.argv[3];
const failedCriteriaDir = process.argv[4];
const malformedSidecarDir = process.argv[5];
const productDriftDir = process.argv[6];
const claimDriftDir = process.argv[7];
fs.mkdirSync(mismatchDir, { recursive: true });
fs.mkdirSync(malformedDir, { recursive: true });
fs.mkdirSync(failedCriteriaDir, { recursive: true });
fs.mkdirSync(malformedSidecarDir, { recursive: true });
fs.mkdirSync(productDriftDir, { recursive: true });
fs.mkdirSync(claimDriftDir, { recursive: true });
input.product.productVideoReadiness = {
  status: "partial",
  warnings: ["product-level video readiness is gated"],
  reasonCodes: ["missing_visual_assets"],
  criteria: []
};
fs.writeFileSync(path.join(mismatchDir, "manifest.json"), JSON.stringify(input, null, 2));
const malformed = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
malformed.readiness.presentation = {
  status: "pass",
  warnings: "not an array",
  reasonCodes: ["positive_spec_promoted"],
  criteria: []
};
malformed.readiness.productVideo = {
  status: "pass",
  warnings: [],
  reasonCodes: ["positive_spec_promoted"],
  criteria: []
};
fs.writeFileSync(path.join(malformedDir, "manifest.json"), JSON.stringify(malformed, null, 2));
const failedCriteria = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
failedCriteria.readiness.presentation = {
  status: "pass",
  warnings: [],
  reasonCodes: ["positive_spec_promoted"],
  criteria: [{
    label: "Visual assets",
    observed: "0 image or screenshot asset(s)",
    threshold: "At least 1 visual asset for presentation-ready output",
    passed: false
  }]
};
fs.writeFileSync(path.join(failedCriteriaDir, "manifest.json"), JSON.stringify(failedCriteria, null, 2));
const malformedSidecar = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
fs.writeFileSync(path.join(malformedSidecarDir, "manifest.json"), JSON.stringify(malformedSidecar, null, 2));
fs.writeFileSync(path.join(malformedSidecarDir, "presentation-readiness.json"), JSON.stringify([], null, 2));
const productDrift = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const productDriftSidecar = {
  presentationReadiness: productDrift.readiness.presentation,
  productVideoReadiness: productDrift.readiness.productVideo,
  promotedClaims: productDrift.product.features.map((claim, index) => ({
    claim,
    specKey: "features",
    specLabel: "Features",
    specValue: claim,
    reasonCode: "positive_spec_promoted",
    evidenceReferences: [{
      recordId: "sample-record",
      provider: "shopping/others",
      source: "metadata_feature",
      path: `metadata.features.${index}`,
      label: "Features",
      excerpt: claim
    }]
  }))
};
fs.writeFileSync(path.join(productDriftDir, "manifest.json"), JSON.stringify(productDrift, null, 2));
fs.writeFileSync(path.join(productDriftDir, "presentation-readiness.json"), JSON.stringify(productDriftSidecar, null, 2));
fs.writeFileSync(path.join(productDriftDir, "product.json"), JSON.stringify({
  ...productDrift.product,
  presentationReadiness: productDrift.readiness.presentation,
  productVideoReadiness: {
    status: "partial",
    warnings: ["product.json video readiness is gated"],
    reasonCodes: ["missing_visual_assets"],
    criteria: []
  }
}, null, 2));
const claimDrift = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const claimDriftPromotedClaims = claimDrift.product.features.map((claim, index) => ({
  claim,
  specKey: "features",
  specLabel: "Features",
  specValue: claim,
  reasonCode: "positive_spec_promoted",
  evidenceReferences: [{
    recordId: "sample-record",
    provider: "shopping/others",
    source: "metadata_feature",
    path: `metadata.features.${index}`,
    label: "Features",
    excerpt: claim
  }]
}));
fs.writeFileSync(path.join(claimDriftDir, "manifest.json"), JSON.stringify(claimDrift, null, 2));
fs.writeFileSync(path.join(claimDriftDir, "presentation-readiness.json"), JSON.stringify({
  presentationReadiness: claimDrift.readiness.presentation,
  productVideoReadiness: claimDrift.readiness.productVideo,
  promotedClaims: claimDriftPromotedClaims
}, null, 2));
fs.writeFileSync(path.join(claimDriftDir, "product.json"), JSON.stringify({
  ...claimDrift.product,
  features: [
    "Unrelated feature row should not inherit evidence.",
    ...claimDrift.product.features.slice(1)
  ],
  presentationReadiness: claimDrift.readiness.presentation,
  productVideoReadiness: claimDrift.readiness.productVideo
}, null, 2));
' "$root/examples/sample-manifest.json" "$mismatch_dir" "$malformed_dir" "$failed_criteria_dir" "$malformed_sidecar_dir" "$product_drift_dir" "$claim_drift_dir"
node -e '
const fs = require("fs");
const path = require("path");
const input = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const outDir = process.argv[2];
fs.mkdirSync(outDir, { recursive: true });
input.readiness.presentation.reasonCodes = ["marketplace_chrome_rejected", "positive_spec_promoted"];
input.readiness.productVideo.reasonCodes = ["marketplace_chrome_rejected", "positive_spec_promoted"];
fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(input, null, 2));
const promotedClaims = input.product.features.map((claim, index) => ({
  claim,
  specKey: "features",
  specLabel: "Features",
  specValue: claim,
  reasonCode: "positive_spec_promoted",
  evidenceReferences: [{
    recordId: "sample-record",
    provider: "shopping/others",
    source: "metadata_feature",
    path: `metadata.features.${index}`,
    label: "Features",
    excerpt: claim
  }]
}));
fs.writeFileSync(path.join(outDir, "presentation-readiness.json"), JSON.stringify({
  presentationReadiness: input.readiness.presentation,
  productVideoReadiness: input.readiness.productVideo,
  promotedClaims,
  rejectedCandidates: [{
    reasonCode: "marketplace_chrome_rejected",
    reason: "transaction chrome",
    source: "raw_content"
  }]
}, null, 2));
fs.writeFileSync(path.join(outDir, "product.json"), JSON.stringify({
  ...input.product,
  presentationReadiness: input.readiness.presentation,
  productVideoReadiness: input.readiness.productVideo
}, null, 2));
' "$root/examples/sample-manifest.json" "$mixed_reason_dir"
for rel in "${required[@]}"; do
  if [[ ! -f "$root/$rel" ]]; then
    echo "Missing required asset: $rel" >&2
    status=1
  fi
  if ! grep -Fq "$rel" "$skill_file"; then
    echo "SKILL.md missing reference: $rel" >&2
    status=1
  fi
done

for rel in scripts/collect-product.sh scripts/capture-screenshots.sh scripts/download-images.sh scripts/write-manifest.sh scripts/render-video-brief.sh scripts/validate-skill-assets.sh; do
  if [[ -f "$root/$rel" && ! -x "$root/$rel" ]]; then
    echo "Script is not executable: $rel" >&2
    status=1
  fi
done

for rel in scripts/collect-product.sh scripts/capture-screenshots.sh scripts/download-images.sh scripts/write-manifest.sh; do
  if [[ -f "$root/$rel" ]]; then
    if ! grep -Fq "resolve-odb-cli.sh" "$root/$rel"; then
      echo "Workflow wrapper missing shared CLI resolver: $rel" >&2
      status=1
    fi
    if ! grep -Fq "ODB_CLI" "$root/$rel"; then
      echo "Workflow wrapper missing ODB_CLI invocation: $rel" >&2
      status=1
    fi
    if [[ "$rel" == "scripts/collect-product.sh" || "$rel" == "scripts/capture-screenshots.sh" || "$rel" == "scripts/download-images.sh" || "$rel" == "scripts/write-manifest.sh" ]] && ! grep -Fq "require_odb_daemon_current" "$root/$rel"; then
      echo "Workflow wrapper missing daemon fingerprint preflight: $rel" >&2
      status=1
    fi
  fi
done

if [[ -f "$root/assets/templates/manifest.schema.json" ]]; then
  if ! node -e 'const fs=require("fs"); JSON.parse(fs.readFileSync(process.argv[1], "utf8"));' "$root/assets/templates/manifest.schema.json" >/dev/null 2>&1; then
    echo "Invalid JSON template: assets/templates/manifest.schema.json" >&2
    status=1
  fi
fi

"$root/scripts/render-video-brief.sh" "$mixed_reason_manifest" "$tmpdir/pass-brief" >/dev/null
if [[ -f "$tmpdir/pass-brief/video-brief.md" ]] && ! grep -Fq "Production gate: pass" "$tmpdir/pass-brief/video-brief.md"; then
  echo "render-video-brief.sh did not emit normal pass production gate." >&2
  status=1
fi
if [[ -f "$tmpdir/pass-brief/claims-evidence-map.md" ]] && ! grep -Fq "Readiness Reason Code" "$tmpdir/pass-brief/claims-evidence-map.md"; then
  echo "render-video-brief.sh did not align pass claims map columns with the template." >&2
  status=1
fi
if [[ -f "$tmpdir/pass-brief/claims-evidence-map.md" ]] && ! grep -Fq "review_required" "$tmpdir/pass-brief/claims-evidence-map.md"; then
  echo "render-video-brief.sh marked pass claims as verified before human review." >&2
  status=1
fi
if [[ -f "$tmpdir/pass-brief/claims-evidence-map.md" ]] && grep -Fq "| yes |" "$tmpdir/pass-brief/claims-evidence-map.md"; then
  echo "render-video-brief.sh oververified pass claims before human review." >&2
  status=1
fi
"$root/scripts/render-video-brief.sh" "$mixed_reason_manifest" "$tmpdir/mixed-reason-brief" >/dev/null
if [[ -f "$tmpdir/mixed-reason-brief/claims-evidence-map.md" ]] && ! grep -Fq "| metadata.features.0 | positive_spec_promoted | review_required |" "$tmpdir/mixed-reason-brief/claims-evidence-map.md"; then
  echo "render-video-brief.sh did not use promoted-claim evidence for pass claim rows." >&2
  status=1
fi
if [[ -f "$tmpdir/mixed-reason-brief/claims-evidence-map.md" ]] && grep -Fq "| marketplace_chrome_rejected | review_required |" "$tmpdir/mixed-reason-brief/claims-evidence-map.md"; then
  echo "render-video-brief.sh assigned package-level marketplace rejection to promoted claim rows." >&2
  status=1
fi
if "$root/scripts/render-video-brief.sh" "$root/examples/sample-manifest.json" "$tmpdir/missing-sidecar-brief" >/dev/null 2>/dev/null; then
  echo "render-video-brief.sh did not fail closed for pass readiness without promoted sidecar evidence." >&2
  status=1
fi
if [[ -f "$tmpdir/missing-sidecar-brief/video-brief.md" ]] && ! grep -Fq "readiness_invalid" "$tmpdir/missing-sidecar-brief/video-brief.md"; then
  echo "render-video-brief.sh did not report missing promoted sidecar evidence." >&2
  status=1
fi
if "$root/scripts/render-video-brief.sh" "$tmpdir/missing-manifest.json" "$tmpdir/missing-brief" >/dev/null 2>/dev/null; then
  echo "render-video-brief.sh did not fail for a missing manifest." >&2
  status=1
fi

"$root/scripts/render-video-brief.sh" "$metadata_manifest" "$tmpdir/brief" >/dev/null
for generated in video-brief.md shot-list.md ugc-brief.md claims-evidence-map.md; do
  if [[ ! -f "$tmpdir/brief/$generated" ]]; then
    echo "render-video-brief.sh missing generated file: $generated" >&2
    status=1
  fi
done
if [[ -f "$tmpdir/brief/video-brief.md" ]] && ! grep -Fq "metadata-first" "$tmpdir/brief/video-brief.md"; then
  echo "render-video-brief.sh did not preserve metadata-first output when visuals are absent." >&2
  status=1
fi
if [[ -f "$tmpdir/brief/video-brief.md" ]] && ! grep -Fq "Production use: gated" "$tmpdir/brief/video-brief.md"; then
  echo "render-video-brief.sh did not gate partial readiness output." >&2
  status=1
fi
if [[ -f "$tmpdir/brief/claims-evidence-map.md" ]] && ! grep -Fq "metadata-only-pack:no-captured-visual" "$tmpdir/brief/claims-evidence-map.md"; then
  echo "render-video-brief.sh did not emit the metadata-only evidence placeholder." >&2
  status=1
fi
if [[ -f "$tmpdir/brief/claims-evidence-map.md" ]] && ! grep -Fq "missing_visual_assets" "$tmpdir/brief/claims-evidence-map.md"; then
  echo "render-video-brief.sh did not include partial reason codes in the claims map." >&2
  status=1
fi
if [[ -f "$tmpdir/brief/claims-evidence-map.md" ]] && ! grep -Fq "gated" "$tmpdir/brief/claims-evidence-map.md"; then
  echo "render-video-brief.sh did not mark partial claims as gated." >&2
  status=1
fi
if "$root/scripts/render-video-brief.sh" "$fail_manifest" "$tmpdir/fail-brief" >/dev/null 2>/dev/null; then
  echo "render-video-brief.sh did not exit nonzero for fail readiness." >&2
  status=1
fi
if [[ -f "$tmpdir/fail-brief/video-brief.md" ]] && ! grep -Fq "Production use: blocked" "$tmpdir/fail-brief/video-brief.md"; then
  echo "render-video-brief.sh did not write fail readiness diagnostic." >&2
  status=1
fi
if [[ -f "$tmpdir/fail-brief/video-brief.md" ]] && grep -Fq "## Verified Features" "$tmpdir/fail-brief/video-brief.md"; then
  echo "render-video-brief.sh labeled fail readiness features as verified." >&2
  status=1
fi
if [[ -f "$tmpdir/fail-brief/claims-evidence-map.md" ]] && ! grep -Fq "blocked" "$tmpdir/fail-brief/claims-evidence-map.md"; then
  echo "render-video-brief.sh did not mark fail claims as blocked." >&2
  status=1
fi
if "$root/scripts/render-video-brief.sh" "$drift_manifest" "$tmpdir/drift-brief" >/dev/null 2>/dev/null; then
  echo "render-video-brief.sh did not fail closed for readiness surface drift." >&2
  status=1
fi
if [[ -f "$tmpdir/drift-brief/video-brief.md" ]] && ! grep -Fq "readiness_invalid" "$tmpdir/drift-brief/video-brief.md"; then
  echo "render-video-brief.sh did not report invalid readiness surface drift." >&2
  status=1
fi
if [[ -f "$tmpdir/drift-brief/video-brief.md" ]] && ! grep -Fq "Production use: blocked" "$tmpdir/drift-brief/video-brief.md"; then
  echo "render-video-brief.sh did not block readiness surface drift." >&2
  status=1
fi
if "$root/scripts/render-video-brief.sh" "$mismatch_manifest" "$tmpdir/mismatch-brief" >/dev/null 2>/dev/null; then
  echo "render-video-brief.sh did not fail closed for pass-vs-partial readiness surface mismatch." >&2
  status=1
fi
if [[ -f "$tmpdir/mismatch-brief/video-brief.md" ]] && ! grep -Fq "readiness_surface_mismatch" "$tmpdir/mismatch-brief/video-brief.md"; then
  echo "render-video-brief.sh did not report readiness surface mismatch." >&2
  status=1
fi
if [[ -f "$tmpdir/mismatch-brief/video-brief.md" ]] && ! grep -Fq "Production use: blocked" "$tmpdir/mismatch-brief/video-brief.md"; then
  echo "render-video-brief.sh did not block readiness surface mismatch." >&2
  status=1
fi
if "$root/scripts/render-video-brief.sh" "$product_drift_manifest" "$tmpdir/product-drift-brief" >/dev/null 2>/dev/null; then
  echo "render-video-brief.sh did not fail closed for product.json readiness drift." >&2
  status=1
fi
if [[ -f "$tmpdir/product-drift-brief/video-brief.md" ]] && ! grep -Fq "product.json.productVideoReadiness:partial" "$tmpdir/product-drift-brief/video-brief.md"; then
  echo "render-video-brief.sh did not report product.json readiness drift." >&2
  status=1
fi
if [[ -f "$tmpdir/product-drift-brief/video-brief.md" ]] && ! grep -Fq "Production use: blocked" "$tmpdir/product-drift-brief/video-brief.md"; then
  echo "render-video-brief.sh did not block product.json readiness drift." >&2
  status=1
fi
if "$root/scripts/render-video-brief.sh" "$claim_drift_manifest" "$tmpdir/claim-drift-brief" >/dev/null 2>/dev/null; then
  echo "render-video-brief.sh did not fail closed for pass claim text drift." >&2
  status=1
fi
if [[ -f "$tmpdir/claim-drift-brief/video-brief.md" ]] && ! grep -Fq "promotedClaims with evidence references" "$tmpdir/claim-drift-brief/video-brief.md"; then
  echo "render-video-brief.sh did not report pass claim text drift." >&2
  status=1
fi
if [[ -f "$tmpdir/claim-drift-brief/claims-evidence-map.md" ]] && grep -Fq "Unrelated feature row should not inherit evidence. |" "$tmpdir/claim-drift-brief/claims-evidence-map.md"; then
  echo "render-video-brief.sh emitted a drifted claim as evidence-backed output." >&2
  status=1
fi
if "$root/scripts/render-video-brief.sh" "$malformed_manifest" "$tmpdir/malformed-brief" >/dev/null 2>/dev/null; then
  echo "render-video-brief.sh did not fail closed for malformed pass readiness." >&2
  status=1
fi
if [[ -f "$tmpdir/malformed-brief/video-brief.md" ]] && ! grep -Fq "readiness_invalid" "$tmpdir/malformed-brief/video-brief.md"; then
  echo "render-video-brief.sh did not report malformed pass readiness." >&2
  status=1
fi
if [[ -f "$tmpdir/malformed-brief/video-brief.md" ]] && ! grep -Fq "Production use: blocked" "$tmpdir/malformed-brief/video-brief.md"; then
  echo "render-video-brief.sh did not block malformed pass readiness." >&2
  status=1
fi
if "$root/scripts/render-video-brief.sh" "$failed_criteria_manifest" "$tmpdir/failed-criteria-brief" >/dev/null 2>/dev/null; then
  echo "render-video-brief.sh did not fail closed for pass readiness with failed criteria." >&2
  status=1
fi
if [[ -f "$tmpdir/failed-criteria-brief/video-brief.md" ]] && ! grep -Fq "readiness_invalid" "$tmpdir/failed-criteria-brief/video-brief.md"; then
  echo "render-video-brief.sh did not report pass readiness with failed criteria." >&2
  status=1
fi
if [[ -f "$tmpdir/failed-criteria-brief/video-brief.md" ]] && ! grep -Fq "Production use: blocked" "$tmpdir/failed-criteria-brief/video-brief.md"; then
  echo "render-video-brief.sh did not block pass readiness with failed criteria." >&2
  status=1
fi
if "$root/scripts/render-video-brief.sh" "$malformed_sidecar_manifest" "$tmpdir/malformed-sidecar-brief" >/dev/null 2>/dev/null; then
  echo "render-video-brief.sh did not fail closed for malformed readiness sidecar." >&2
  status=1
fi
if [[ -f "$tmpdir/malformed-sidecar-brief/video-brief.md" ]] && ! grep -Fq "readiness_invalid" "$tmpdir/malformed-sidecar-brief/video-brief.md"; then
  echo "render-video-brief.sh did not report malformed readiness sidecar." >&2
  status=1
fi
if [[ -f "$tmpdir/malformed-sidecar-brief/video-brief.md" ]] && ! grep -Fq "Production use: blocked" "$tmpdir/malformed-sidecar-brief/video-brief.md"; then
  echo "render-video-brief.sh did not block malformed readiness sidecar." >&2
  status=1
fi

if [[ $status -ne 0 ]]; then
  exit $status
fi

echo "Product presentation asset skill pack validated."
