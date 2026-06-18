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
pass_structure_drift_dir="$tmpdir/readiness-pass-structure-drift"
pass_structure_drift_manifest="$pass_structure_drift_dir/manifest.json"
partial_structure_drift_dir="$tmpdir/readiness-partial-structure-drift"
partial_structure_drift_manifest="$partial_structure_drift_dir/manifest.json"
polluted_copy_dir="$tmpdir/public-copy-polluted"
polluted_copy_manifest="$polluted_copy_dir/manifest.json"
polluted_title_dir="$tmpdir/public-title-polluted"
polluted_title_manifest="$polluted_title_dir/manifest.json"
polluted_brand_dir="$tmpdir/public-brand-polluted"
polluted_brand_manifest="$polluted_brand_dir/manifest.json"
unsupported_feature_dir="$tmpdir/public-feature-unsupported"
unsupported_feature_manifest="$unsupported_feature_dir/manifest.json"
site_feature_dir="$tmpdir/public-feature-site-chrome"
site_feature_manifest="$site_feature_dir/manifest.json"
site_title_dir="$tmpdir/public-title-site-chrome"
site_title_manifest="$site_title_dir/manifest.json"
unsupported_title_dir="$tmpdir/public-title-unsupported"
unsupported_title_manifest="$unsupported_title_dir/manifest.json"
late_feature_dir="$tmpdir/public-feature-late-polluted"
late_feature_manifest="$late_feature_dir/manifest.json"
unbacked_late_feature_dir="$tmpdir/public-feature-late-unbacked"
unbacked_late_feature_manifest="$unbacked_late_feature_dir/manifest.json"
late_copy_dir="$tmpdir/public-copy-late-polluted"
late_copy_manifest="$late_copy_dir/manifest.json"
unbacked_copy_dir="$tmpdir/public-copy-unbacked"
unbacked_copy_manifest="$unbacked_copy_dir/manifest.json"
partial_unbacked_copy_dir="$tmpdir/partial-copy-unbacked"
partial_unbacked_copy_manifest="$partial_unbacked_copy_dir/manifest.json"
manifest_polluted_dir="$tmpdir/public-manifest-polluted"
manifest_polluted_manifest="$manifest_polluted_dir/manifest.json"
clean_product_drift_dir="$tmpdir/public-clean-product-drift"
clean_product_drift_manifest="$clean_product_drift_dir/manifest.json"
insufficient_claims_dir="$tmpdir/pass-insufficient-promoted-claims"
insufficient_claims_manifest="$insufficient_claims_dir/manifest.json"
insufficient_dimensions_dir="$tmpdir/pass-insufficient-evidence-dimensions"
insufficient_dimensions_manifest="$insufficient_dimensions_dir/manifest.json"
missing_clean_criterion_dir="$tmpdir/pass-missing-clean-benefit-criterion"
missing_clean_criterion_manifest="$missing_clean_criterion_dir/manifest.json"
long_claim_dir="$tmpdir/pass-long-promoted-claim"
long_claim_manifest="$long_claim_dir/manifest.json"
long_claim_drift_dir="$tmpdir/pass-long-promoted-claim-drift"
long_claim_drift_manifest="$long_claim_drift_dir/manifest.json"
pass_no_visual_dir="$tmpdir/pass-no-visual-assets"
pass_no_visual_manifest="$pass_no_visual_dir/manifest.json"
missing_visual_file_dir="$tmpdir/pass-missing-visual-files"
missing_visual_file_manifest="$missing_visual_file_dir/manifest.json"
polluted_warning_dir="$tmpdir/readiness-warning-polluted"
polluted_warning_manifest="$polluted_warning_dir/manifest.json"
polluted_reason_dir="$tmpdir/readiness-reason-polluted"
polluted_reason_manifest="$polluted_reason_dir/manifest.json"
missing_manifest_readiness_dir="$tmpdir/readiness-missing-manifest-gate"
missing_manifest_readiness_manifest="$missing_manifest_readiness_dir/manifest.json"
missing_product_readiness_dir="$tmpdir/readiness-missing-product-gate"
missing_product_readiness_manifest="$missing_product_readiness_dir/manifest.json"
missing_product_json_dir="$tmpdir/readiness-missing-product-json"
missing_product_json_manifest="$missing_product_json_dir/manifest.json"
summary_drift_dir="$tmpdir/readiness-sidecar-summary-drift"
summary_drift_manifest="$summary_drift_dir/manifest.json"
summary_only_dir="$tmpdir/readiness-sidecar-summary-only"
summary_only_manifest="$summary_only_dir/manifest.json"
polluted_copy_markdown_dir="$tmpdir/public-copy-markdown-polluted"
polluted_copy_markdown_manifest="$polluted_copy_markdown_dir/manifest.json"
polluted_features_markdown_dir="$tmpdir/public-features-markdown-polluted"
polluted_features_markdown_manifest="$polluted_features_markdown_dir/manifest.json"
node -e '
const fs = require("fs");
const path = require("path");
const { createHash } = require("crypto");
const input = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const hashClaim = (claim) => createHash("sha1").update(claim).digest("hex").slice(0, 16);
const claimIdentity = (claim) => ({
  claimHash: hashClaim(claim),
  claimLength: claim.length,
  specValueHash: hashClaim(claim),
  specValueLength: claim.length
});
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
fs.writeFileSync(path.join(path.dirname(process.argv[2]), "product.json"), JSON.stringify({
  ...input.product,
  presentationReadiness: input.readiness.presentation,
  productVideoReadiness: input.readiness.productVideo
}, null, 2));
fs.writeFileSync(path.join(path.dirname(process.argv[2]), "presentation-readiness.json"), JSON.stringify({
  presentationReadiness: input.readiness.presentation,
  productVideoReadiness: input.readiness.productVideo,
  summary: {
    status: input.readiness.presentation.status,
    promotedFeatureCount: input.product.features.length,
    promotedClaimCount: input.product.features.length,
    rejectedCandidateCount: 0,
    evidenceReferenceCount: input.product.features.length,
    imageCount: 0,
    screenshotCount: 0
  },
  promotedClaims: input.product.features.map((claim, index) => ({
    claim,
    ...claimIdentity(claim),
    specKey: ["connectivity", "maximum_dpi", "features"][index] || "features",
    specLabel: ["Connectivity", "Maximum DPI", "Features"][index] || "Features",
    specValue: claim,
    reasonCode: "positive_spec_promoted",
    evidenceReferences: [{
      recordId: "sample-record",
      provider: "shopping/others",
      source: index === 2 ? "metadata_feature" : "metadata_spec",
      path: ["metadata.specs.connectivity", "metadata.specs.maximum_dpi", "metadata.features.0"][index] || `metadata.features.${index}`,
      label: ["Connectivity", "Maximum DPI", "Features"][index] || "Features",
      excerpt: claim
    }]
  }))
}, null, 2));
input.readiness.presentation.status = "fail";
input.readiness.presentation.warnings = ["clean feature evidence missing"];
input.readiness.presentation.reasonCodes = ["insufficient_clean_feature_evidence", "copy_generation_blocked"];
input.readiness.productVideo = input.readiness.presentation;
fs.writeFileSync(process.argv[3], JSON.stringify(input, null, 2));
' "$root/examples/sample-manifest.json" "$metadata_manifest" "$fail_manifest"
node -e '
const fs = require("fs");
const path = require("path");
const { createHash } = require("crypto");
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
const { createHash } = require("crypto");
const input = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const mismatchDir = process.argv[2];
const malformedDir = process.argv[3];
const failedCriteriaDir = process.argv[4];
const malformedSidecarDir = process.argv[5];
const productDriftDir = process.argv[6];
const claimDriftDir = process.argv[7];
const passStructureDriftDir = process.argv[8];
fs.mkdirSync(mismatchDir, { recursive: true });
fs.mkdirSync(malformedDir, { recursive: true });
fs.mkdirSync(failedCriteriaDir, { recursive: true });
fs.mkdirSync(malformedSidecarDir, { recursive: true });
fs.mkdirSync(productDriftDir, { recursive: true });
fs.mkdirSync(claimDriftDir, { recursive: true });
fs.mkdirSync(passStructureDriftDir, { recursive: true });
const claimSpec = (index) => [
  { key: "connectivity", label: "Connectivity", source: "metadata_spec", path: "metadata.specs.connectivity" },
  { key: "maximum_dpi", label: "Maximum DPI", source: "metadata_spec", path: "metadata.specs.maximum_dpi" },
  { key: "features", label: "Features", source: "metadata_feature", path: "metadata.features.0" }
][index] || { key: "features", label: "Features", source: "metadata_feature", path: `metadata.features.${index}` };
const hashClaim = (claim) => createHash("sha1").update(claim).digest("hex").slice(0, 16);
const claimIdentity = (claim) => ({
  claimHash: hashClaim(claim),
  claimLength: claim.length,
  specValueHash: hashClaim(claim),
  specValueLength: claim.length
});
function promotedClaim(claim, index) {
  const spec = claimSpec(index);
  return {
    claim,
    ...claimIdentity(claim),
    specKey: spec.key,
    specLabel: spec.label,
    specValue: claim,
    reasonCode: "positive_spec_promoted",
    evidenceReferences: [{
      recordId: "sample-record",
      provider: "shopping/others",
      source: spec.source,
      path: spec.path,
      label: spec.label,
      excerpt: claim
    }]
  };
}
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
  promotedClaims: productDrift.product.features.map(promotedClaim)
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
const claimDriftPromotedClaims = claimDrift.product.features.map(promotedClaim);
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
const passStructureDrift = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
fs.writeFileSync(path.join(passStructureDriftDir, "manifest.json"), JSON.stringify(passStructureDrift, null, 2));
const passStructureSidecar = {
  presentationReadiness: {
    ...passStructureDrift.readiness.presentation,
    warnings: ["sidecar warning should not differ on pass readiness"]
  },
  productVideoReadiness: passStructureDrift.readiness.productVideo,
  promotedClaims: passStructureDrift.product.features.map(promotedClaim)
};
fs.writeFileSync(path.join(passStructureDriftDir, "presentation-readiness.json"), JSON.stringify(passStructureSidecar, null, 2));
' "$root/examples/sample-manifest.json" "$mismatch_dir" "$malformed_dir" "$failed_criteria_dir" "$malformed_sidecar_dir" "$product_drift_dir" "$claim_drift_dir" "$pass_structure_drift_dir"
node -e '
const fs = require("fs");
const path = require("path");
const { createHash } = require("crypto");
const input = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const pollutedCopyDir = process.argv[2];
const pollutedTitleDir = process.argv[3];
const pollutedBrandDir = process.argv[4];
const unsupportedFeatureDir = process.argv[5];
const lateFeatureDir = process.argv[6];
const unbackedLateFeatureDir = process.argv[7];
const lateCopyDir = process.argv[8];
const unbackedCopyDir = process.argv[9];
const partialUnbackedCopyDir = process.argv[10];
const manifestPollutedDir = process.argv[11];
const passNoVisualDir = process.argv[12];
const pollutedWarningDir = process.argv[13];
const pollutedReasonDir = process.argv[14];
const siteFeatureDir = process.argv[15];
const siteTitleDir = process.argv[16];
const missingManifestReadinessDir = process.argv[17];
const missingProductReadinessDir = process.argv[18];
const missingProductJsonDir = process.argv[19];
const unsupportedTitleDir = process.argv[20];
const partialStructureDriftDir = process.argv[21];
fs.mkdirSync(pollutedCopyDir, { recursive: true });
fs.mkdirSync(pollutedTitleDir, { recursive: true });
fs.mkdirSync(pollutedBrandDir, { recursive: true });
fs.mkdirSync(unsupportedFeatureDir, { recursive: true });
fs.mkdirSync(lateFeatureDir, { recursive: true });
fs.mkdirSync(unbackedLateFeatureDir, { recursive: true });
fs.mkdirSync(lateCopyDir, { recursive: true });
fs.mkdirSync(unbackedCopyDir, { recursive: true });
fs.mkdirSync(partialUnbackedCopyDir, { recursive: true });
fs.mkdirSync(manifestPollutedDir, { recursive: true });
fs.mkdirSync(passNoVisualDir, { recursive: true });
fs.mkdirSync(pollutedWarningDir, { recursive: true });
fs.mkdirSync(pollutedReasonDir, { recursive: true });
fs.mkdirSync(siteFeatureDir, { recursive: true });
fs.mkdirSync(siteTitleDir, { recursive: true });
fs.mkdirSync(missingManifestReadinessDir, { recursive: true });
fs.mkdirSync(missingProductReadinessDir, { recursive: true });
fs.mkdirSync(missingProductJsonDir, { recursive: true });
fs.mkdirSync(unsupportedTitleDir, { recursive: true });
fs.mkdirSync(partialStructureDriftDir, { recursive: true });
const claimSpec = (index) => [
  { key: "connectivity", label: "Connectivity", source: "metadata_spec", path: "metadata.specs.connectivity" },
  { key: "maximum_dpi", label: "Maximum DPI", source: "metadata_spec", path: "metadata.specs.maximum_dpi" },
  { key: "features", label: "Features", source: "metadata_feature", path: "metadata.features.0" }
][index] || { key: "features", label: "Features", source: "metadata_feature", path: `metadata.features.${index}` };
const hashClaim = (claim) => createHash("sha1").update(claim).digest("hex").slice(0, 16);
const claimIdentity = (claim) => ({
  claimHash: hashClaim(claim),
  claimLength: claim.length,
  specValueHash: hashClaim(claim),
  specValueLength: claim.length
});
function promotedClaims(manifest) {
  return manifest.product.features.map((claim, index) => ({
    claim,
    ...claimIdentity(claim),
    specKey: claimSpec(index).key,
    specLabel: claimSpec(index).label,
    specValue: claim,
    reasonCode: "positive_spec_promoted",
    evidenceReferences: [{
      recordId: "sample-record",
      provider: "shopping/others",
      source: claimSpec(index).source,
      path: claimSpec(index).path,
      label: claimSpec(index).label,
      excerpt: claim
    }]
  }));
}
function writeFixture(outDir, mutator) {
  const manifest = JSON.parse(JSON.stringify(input));
  mutator(manifest);
  fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(outDir, "presentation-readiness.json"), JSON.stringify({
    presentationReadiness: manifest.readiness.presentation,
    productVideoReadiness: manifest.readiness.productVideo,
    promotedClaims: promotedClaims(manifest)
  }, null, 2));
}
writeFixture(pollutedCopyDir, (manifest) => {
  manifest.product.copy = "Buy It Now checkout copy should never become public production input.";
});
writeFixture(pollutedTitleDir, (manifest) => {
  manifest.product.title = "Brand Aurora Labs Type Vertical Trackball Mouse Maximum DPI 1600 Connectivity Wireless Features Thumb rest";
});
writeFixture(pollutedBrandDir, (manifest) => {
  manifest.product.brand = "Seller feedback 99 percent";
});
writeFixture(unsupportedFeatureDir, (manifest) => {
  manifest.product.features = [
    "Best vertical mouse comfort for every user.",
    ...manifest.product.features.slice(1)
  ];
});
writeFixture(siteFeatureDir, (manifest) => {
  manifest.product.features = [
    "Find a Store",
    ...manifest.product.features.slice(1)
  ];
});
writeFixture(siteTitleDir, (manifest) => {
  manifest.product.title = "Store";
  manifest.product.brand = "AirPods";
});
writeFixture(unsupportedTitleDir, (manifest) => {
  manifest.product.title = "Number one vertical mouse for every desk";
  manifest.product.brand = "Number one accessory brand";
});
const missingManifestReadiness = JSON.parse(JSON.stringify(input));
const missingManifestReadinessSidecar = JSON.parse(JSON.stringify(missingManifestReadiness.readiness));
delete missingManifestReadiness.readiness;
fs.mkdirSync(missingManifestReadinessDir, { recursive: true });
fs.writeFileSync(path.join(missingManifestReadinessDir, "manifest.json"), JSON.stringify(missingManifestReadiness, null, 2));
fs.writeFileSync(path.join(missingManifestReadinessDir, "presentation-readiness.json"), JSON.stringify({
  presentationReadiness: missingManifestReadinessSidecar.presentation,
  productVideoReadiness: missingManifestReadinessSidecar.productVideo,
  promotedClaims: promotedClaims(missingManifestReadiness)
}, null, 2));
const missingProductReadiness = JSON.parse(JSON.stringify(input));
fs.writeFileSync(path.join(missingProductReadinessDir, "manifest.json"), JSON.stringify(missingProductReadiness, null, 2));
fs.writeFileSync(path.join(missingProductReadinessDir, "presentation-readiness.json"), JSON.stringify({
  presentationReadiness: missingProductReadiness.readiness.presentation,
  productVideoReadiness: missingProductReadiness.readiness.productVideo,
  promotedClaims: promotedClaims(missingProductReadiness)
}, null, 2));
const { presentationReadiness, productVideoReadiness, ...productWithoutReadiness } = missingProductReadiness.product;
void presentationReadiness;
void productVideoReadiness;
fs.writeFileSync(path.join(missingProductReadinessDir, "product.json"), JSON.stringify(productWithoutReadiness, null, 2));
const missingProductJson = JSON.parse(JSON.stringify(input));
fs.writeFileSync(path.join(missingProductJsonDir, "manifest.json"), JSON.stringify(missingProductJson, null, 2));
fs.writeFileSync(path.join(missingProductJsonDir, "presentation-readiness.json"), JSON.stringify({
  presentationReadiness: missingProductJson.readiness.presentation,
  productVideoReadiness: missingProductJson.readiness.productVideo,
  promotedClaims: promotedClaims(missingProductJson)
}, null, 2));
writeFixture(lateFeatureDir, (manifest) => {
  manifest.product.features = [
    "Clean feature one supports comfort and control.",
    "Clean feature two supports comfort and control.",
    "Clean feature three supports comfort and control.",
    "Clean feature four supports comfort and control.",
    "Clean feature five supports comfort and control.",
    "Guaranteed #1 comfort should be checked even after rendered feature five."
  ];
});
writeFixture(unbackedLateFeatureDir, (manifest) => {
  manifest.product.features = [
    "Wireless connectivity supports a cleaner setup.",
    "Adjustable DPI tracking supports everyday pointer control.",
    "Includes ergonomic shell to support comfort and control.",
    "Clean feature four supports comfort and control.",
    "Clean feature five supports comfort and control.",
    "Clean feature six must still require sidecar evidence."
  ];
});
const unbackedLateSidecar = JSON.parse(fs.readFileSync(path.join(unbackedLateFeatureDir, "presentation-readiness.json"), "utf8"));
unbackedLateSidecar.promotedClaims = unbackedLateSidecar.promotedClaims.slice(0, 5);
fs.writeFileSync(path.join(unbackedLateFeatureDir, "presentation-readiness.json"), JSON.stringify(unbackedLateSidecar, null, 2));
writeFixture(lateCopyDir, (manifest) => {
  manifest.product.copy = `${"Clean copy. ".repeat(70)}Buy It Now checkout copy after the display limit must still fail.`;
});
writeFixture(unbackedCopyDir, (manifest) => {
  manifest.product.copy = "Clean lifestyle promise without promoted claim support.";
});
writeFixture(partialUnbackedCopyDir, (manifest) => {
  manifest.product.copy = `${manifest.product.title} presentation highlights verified product details: ${manifest.product.features.slice(0, 3).join(" ")}`;
  manifest.readiness.presentation.status = "partial";
  manifest.readiness.presentation.warnings = ["partial pack still needs human review"];
  manifest.readiness.presentation.reasonCodes = ["insufficient_clean_feature_evidence"];
  manifest.readiness.presentation.criteria = [];
  manifest.readiness.productVideo = manifest.readiness.presentation;
});
const partialUnbackedSidecar = JSON.parse(fs.readFileSync(path.join(partialUnbackedCopyDir, "presentation-readiness.json"), "utf8"));
partialUnbackedSidecar.promotedClaims = [];
fs.writeFileSync(path.join(partialUnbackedCopyDir, "presentation-readiness.json"), JSON.stringify(partialUnbackedSidecar, null, 2));
writeFixture(partialStructureDriftDir, (manifest) => {
  manifest.readiness.presentation.status = "partial";
  manifest.readiness.presentation.warnings = ["partial pack still needs human review"];
  manifest.readiness.presentation.reasonCodes = ["insufficient_clean_feature_evidence"];
  manifest.readiness.presentation.criteria = [];
  manifest.readiness.productVideo = manifest.readiness.presentation;
});
const partialStructureSidecar = JSON.parse(fs.readFileSync(path.join(partialStructureDriftDir, "presentation-readiness.json"), "utf8"));
partialStructureSidecar.productVideoReadiness = {
  ...partialStructureSidecar.productVideoReadiness,
  warnings: ["stale partial productVideo mirror"]
};
fs.writeFileSync(path.join(partialStructureDriftDir, "presentation-readiness.json"), JSON.stringify(partialStructureSidecar, null, 2));
writeFixture(manifestPollutedDir, (manifest) => {
  manifest.product.copy = "Buy It Now manifest copy should fail even when product.json is clean.";
});
writeFixture(passNoVisualDir, (manifest) => {
  manifest.assets = { images: [], screenshots: [], raw: manifest.assets?.raw || [] };
});
writeFixture(pollutedWarningDir, (manifest) => {
  manifest.readiness.presentation.warnings = ["Seller feedback 99 percent should never render from readiness warnings."];
  manifest.readiness.productVideo.warnings = ["Seller feedback 99 percent should never render from readiness warnings."];
});
writeFixture(pollutedReasonDir, (manifest) => {
  manifest.readiness.presentation.reasonCodes = ["positive_spec_promoted", "Buy It Now checkout"];
  manifest.readiness.productVideo.reasonCodes = ["positive_spec_promoted", "Buy It Now checkout"];
});
fs.writeFileSync(path.join(manifestPollutedDir, "product.json"), JSON.stringify({
  ...input.product,
  presentationReadiness: input.readiness.presentation,
  productVideoReadiness: input.readiness.productVideo
}, null, 2));
  ' "$root/examples/sample-manifest.json" "$polluted_copy_dir" "$polluted_title_dir" "$polluted_brand_dir" "$unsupported_feature_dir" "$late_feature_dir" "$unbacked_late_feature_dir" "$late_copy_dir" "$unbacked_copy_dir" "$partial_unbacked_copy_dir" "$manifest_polluted_dir" "$pass_no_visual_dir" "$polluted_warning_dir" "$polluted_reason_dir" "$site_feature_dir" "$site_title_dir" "$missing_manifest_readiness_dir" "$missing_product_readiness_dir" "$missing_product_json_dir" "$unsupported_title_dir" "$partial_structure_drift_dir"
node -e '
const fs = require("fs");
const path = require("path");
const { createHash } = require("crypto");
const input = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const outDir = process.argv[2];
fs.mkdirSync(outDir, { recursive: true });
input.readiness.presentation.reasonCodes = ["marketplace_chrome_rejected", "positive_spec_promoted"];
input.readiness.productVideo.reasonCodes = ["marketplace_chrome_rejected", "positive_spec_promoted"];
fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(input, null, 2));
const claimSpec = (index) => [
  { key: "connectivity", label: "Connectivity", source: "metadata_spec", path: "metadata.specs.connectivity" },
  { key: "maximum_dpi", label: "Maximum DPI", source: "metadata_spec", path: "metadata.specs.maximum_dpi" },
  { key: "features", label: "Features", source: "metadata_feature", path: "metadata.features.0" }
][index] || { key: "features", label: "Features", source: "metadata_feature", path: `metadata.features.${index}` };
const hashClaim = (claim) => createHash("sha1").update(claim).digest("hex").slice(0, 16);
const claimIdentity = (claim) => ({
  claimHash: hashClaim(claim),
  claimLength: claim.length,
  specValueHash: hashClaim(claim),
  specValueLength: claim.length
});
const promotedClaims = input.product.features.map((claim, index) => ({
  claim,
  ...claimIdentity(claim),
  specKey: claimSpec(index).key,
  specLabel: claimSpec(index).label,
  specValue: claim,
  reasonCode: "positive_spec_promoted",
  evidenceReferences: [{
    recordId: "sample-record",
    provider: "shopping/others",
    source: claimSpec(index).source,
    path: claimSpec(index).path,
    label: claimSpec(index).label,
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
const { price, ...publicProduct } = input.product;
fs.writeFileSync(path.join(outDir, "product.json"), JSON.stringify({
  ...publicProduct,
  presentationReadiness: input.readiness.presentation,
  productVideoReadiness: input.readiness.productVideo
}, null, 2));
' "$root/examples/sample-manifest.json" "$mixed_reason_dir"
node -e '
const fs = require("fs");
const path = require("path");
const { createHash } = require("crypto");
const input = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const outDir = process.argv[2];
fs.mkdirSync(outDir, { recursive: true });
const claimSpec = (index) => [
  { key: "connectivity", label: "Connectivity", source: "metadata_spec", path: "metadata.specs.connectivity" },
  { key: "maximum_dpi", label: "Maximum DPI", source: "metadata_spec", path: "metadata.specs.maximum_dpi" },
  { key: "features", label: "Features", source: "metadata_feature", path: "metadata.features.0" }
][index] || { key: "features", label: "Features", source: "metadata_feature", path: `metadata.features.${index}` };
input.assets = { images: [], screenshots: ["screenshots/screenshot-01.png"], raw: ["raw/source-record.json"] };
input.readiness.presentation.status = "pass";
input.readiness.presentation.warnings = [];
input.readiness.presentation.reasonCodes = ["positive_spec_promoted"];
input.readiness.presentation.criteria = [{
  label: "Clean benefit evidence",
  observed: "3 promoted claim(s) across 3 evidence dimension(s)",
  threshold: "At least 3 promoted product benefit claims across 2 evidence dimension(s) for pass",
  passed: true
}, {
  label: "Visual assets",
  observed: "1 image or screenshot asset(s)",
  threshold: "At least 1 visual asset for presentation-ready output",
  passed: true
}];
input.readiness.productVideo = input.readiness.presentation;
fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(input, null, 2));
fs.writeFileSync(path.join(outDir, "product.json"), JSON.stringify({
  title: "Stale Clean Product",
  brand: input.product.brand,
  price: { amount: 1, currency: "USD" },
  features: ["Stale clean feature."],
  copy: "Stale clean copy.",
  presentationReadiness: input.readiness.presentation,
  productVideoReadiness: input.readiness.productVideo
}, null, 2));
fs.writeFileSync(path.join(outDir, "presentation-readiness.json"), JSON.stringify({
  presentationReadiness: input.readiness.presentation,
  productVideoReadiness: input.readiness.productVideo,
  promotedClaims: input.product.features.map((claim, index) => ({
    claim,
    specKey: claimSpec(index).key,
    specLabel: claimSpec(index).label,
    specValue: claim,
    reasonCode: "positive_spec_promoted",
    evidenceReferences: [{
      recordId: "sample-record",
      provider: "shopping/others",
      source: claimSpec(index).source,
      path: claimSpec(index).path,
      label: claimSpec(index).label,
      excerpt: claim
    }]
  }))
}, null, 2));
' "$root/examples/sample-manifest.json" "$clean_product_drift_dir"
node -e '
const fs = require("fs");
const path = require("path");
const { createHash } = require("crypto");
const input = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const insufficientClaimsDir = process.argv[2];
const insufficientDimensionsDir = process.argv[3];
fs.mkdirSync(insufficientClaimsDir, { recursive: true });
fs.mkdirSync(insufficientDimensionsDir, { recursive: true });
function writePassFixture(outDir, promotedClaims) {
  const manifest = JSON.parse(JSON.stringify(input));
  manifest.assets = { images: [], screenshots: ["screenshots/screenshot-01.png"], raw: ["raw/source-record.json"] };
  fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(outDir, "presentation-readiness.json"), JSON.stringify({
    presentationReadiness: manifest.readiness.presentation,
    productVideoReadiness: manifest.readiness.productVideo,
    promotedClaims
  }, null, 2));
}
const hashClaim = (claim) => createHash("sha1").update(claim).digest("hex").slice(0, 16);
const claimIdentity = (claim) => ({
  claimHash: hashClaim(claim),
  claimLength: claim.length,
  specValueHash: hashClaim(claim),
  specValueLength: claim.length
});
const baseClaims = input.product.features.map((claim, index) => ({
  claim,
  ...claimIdentity(claim),
  specKey: ["connectivity", "maximum_dpi", "features"][index] || "features",
  specLabel: ["Connectivity", "Maximum DPI", "Features"][index] || "Features",
  specValue: claim,
  reasonCode: "positive_spec_promoted",
  evidenceReferences: [{
    recordId: "sample-record",
    provider: "shopping/others",
    source: index === 2 ? "metadata_feature" : "metadata_spec",
    path: ["metadata.specs.connectivity", "metadata.specs.maximum_dpi", "metadata.features.0"][index] || `metadata.features.${index}`,
    label: ["Connectivity", "Maximum DPI", "Features"][index] || "Features",
    excerpt: claim
  }]
}));
writePassFixture(insufficientClaimsDir, baseClaims.slice(0, 2));
writePassFixture(insufficientDimensionsDir, baseClaims.map((entry) => ({
  ...entry,
  specKey: "features",
  specLabel: "Features"
})));
' "$root/examples/sample-manifest.json" "$insufficient_claims_dir" "$insufficient_dimensions_dir"
node -e '
const fs = require("fs");
const path = require("path");
const { createHash } = require("crypto");
const input = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const outDir = process.argv[2];
const driftDir = process.argv[3];
const longClaim = "Integrated cable routing, charging support, storage access, desk organization, portable adapters, SD card access, phone staging, and compact workspace setup for creators who need quick transitions.";
const snippet = longClaim.length <= 180 ? longClaim : `${longClaim.slice(0, 179)}\u2026`;
const hashClaim = (claim) => createHash("sha1").update(claim).digest("hex").slice(0, 16);
const claimIdentity = (claim) => ({
  claimHash: hashClaim(claim),
  claimLength: claim.length
});
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(driftDir, { recursive: true });
input.assets = { images: [], screenshots: ["screenshots/screenshot-01.png"], raw: ["raw/source-record.json"] };
const supportingClaims = [
  "USB-C connectivity supports a cleaner setup.",
  "1200 DPI tracking supports everyday pointer control."
];
  input.product.features = [longClaim, ...supportingClaims];
input.product.copy = `${input.product.title} presentation highlights verified product details: ${longClaim} ${supportingClaims.join(" ")}`;
input.readiness.presentation.status = "pass";
input.readiness.presentation.warnings = [];
input.readiness.presentation.reasonCodes = ["positive_spec_promoted"];
input.readiness.presentation.criteria = [{
  label: "Clean benefit evidence",
  observed: "3 promoted claim(s) across 3 evidence dimension(s)",
  threshold: "At least 3 promoted product benefit claims across 2 evidence dimension(s) for pass",
  passed: true
}, {
  label: "Visual assets",
  observed: "1 image or screenshot asset(s)",
  threshold: "At least 1 visual asset for presentation-ready output",
  passed: true
}];
input.readiness.productVideo = input.readiness.presentation;
fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(input, null, 2));
const promotedClaims = [{
  claim: snippet,
  ...claimIdentity(longClaim),
  specKey: "features",
  specLabel: "Features",
  specValue: snippet,
  specValueHash: hashClaim(longClaim),
  specValueLength: longClaim.length,
  reasonCode: "positive_spec_promoted",
  evidenceReferences: [{
    recordId: "sample-record",
    provider: "shopping/others",
    source: "metadata_feature",
    path: "metadata.features.0",
    label: "Features",
    excerpt: snippet
  }]
}, {
  claim: supportingClaims[0],
  ...claimIdentity(supportingClaims[0]),
  specKey: "connectivity",
  specLabel: "Connectivity",
  specValue: supportingClaims[0],
  specValueHash: hashClaim(supportingClaims[0]),
  specValueLength: supportingClaims[0].length,
  reasonCode: "positive_spec_promoted",
  evidenceReferences: [{
    recordId: "sample-record",
    provider: "shopping/others",
    source: "metadata_spec",
    path: "metadata.specs.connectivity",
    label: "Connectivity",
    excerpt: supportingClaims[0]
  }]
}, {
  claim: supportingClaims[1],
  ...claimIdentity(supportingClaims[1]),
  specKey: "maximum_dpi",
  specLabel: "Maximum DPI",
  specValue: supportingClaims[1],
  specValueHash: hashClaim(supportingClaims[1]),
  specValueLength: supportingClaims[1].length,
  reasonCode: "positive_spec_promoted",
  evidenceReferences: [{
    recordId: "sample-record",
    provider: "shopping/others",
    source: "metadata_spec",
    path: "metadata.specs.maximum_dpi",
    label: "Maximum DPI",
    excerpt: supportingClaims[1]
  }]
}];
fs.writeFileSync(path.join(outDir, "presentation-readiness.json"), JSON.stringify({
  presentationReadiness: input.readiness.presentation,
  productVideoReadiness: input.readiness.productVideo,
  promotedClaims
}, null, 2));
const drift = JSON.parse(JSON.stringify(input));
drift.product.features[0] = `${longClaim} Adds an unverified clean production claim.`;
drift.product.copy = `${drift.product.title} presentation highlights verified product details: ${drift.product.features.slice(0, 3).join(" ")}`;
fs.writeFileSync(path.join(driftDir, "manifest.json"), JSON.stringify(drift, null, 2));
fs.writeFileSync(path.join(driftDir, "presentation-readiness.json"), JSON.stringify({
  presentationReadiness: drift.readiness.presentation,
  productVideoReadiness: drift.readiness.productVideo,
  promotedClaims
}, null, 2));
' "$root/examples/sample-manifest.json" "$long_claim_dir" "$long_claim_drift_dir"
node -e '
const fs = require("fs");
const path = require("path");
const { createHash } = require("crypto");
const tmpRoot = process.argv[1];
const samplePath = process.argv[2];
const summaryDriftDir = process.argv[3];
const missingProductJsonDir = process.argv[4];
function expectedCopyForManifest(manifest) {
  const title = manifest.product?.title || "Unknown product";
  const features = Array.isArray(manifest.product?.features) ? manifest.product.features.filter((entry) => typeof entry === "string") : [];
  if (features.length === 0) return "";
  return `${title} presentation highlights verified product details: ${features.slice(0, 3).join(" ")}`;
}
function ensureListedAssetFiles(dir, manifest) {
  const visualAssets = [
    ...(Array.isArray(manifest.assets?.images) ? manifest.assets.images : []),
    ...(Array.isArray(manifest.assets?.screenshots) ? manifest.assets.screenshots : [])
  ];
  for (const assetPath of visualAssets) {
    if (typeof assetPath !== "string" || !assetPath.trim() || /^[a-z][a-z0-9+.-]*:\/\//i.test(assetPath)) continue;
    const fullPath = path.isAbsolute(assetPath) ? assetPath : path.join(dir, assetPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    if (!fs.existsSync(fullPath)) fs.writeFileSync(fullPath, "fixture visual asset");
  }
}
function normalizeDefaultSampleCopy(dir, manifest) {
  const expectedCopy = expectedCopyForManifest(manifest);
  if (!expectedCopy) return manifest;
  let changed = false;
  if (manifest.product?.copy === "Example copy") {
    manifest.product.copy = expectedCopy;
    changed = true;
  }
  const productPath = path.join(dir, "product.json");
  if (fs.existsSync(productPath)) {
    const product = JSON.parse(fs.readFileSync(productPath, "utf8"));
    if (product && typeof product === "object" && !Array.isArray(product) && product.copy === "Example copy") {
      product.copy = expectedCopy;
      fs.writeFileSync(productPath, JSON.stringify(product, null, 2));
    }
  }
  return changed ? manifest : undefined;
}
const hashClaim = (claim) => createHash("sha1").update(claim).digest("hex").slice(0, 16);
const claimIdentity = (claim) => ({
  claimHash: hashClaim(claim),
  claimLength: claim.length,
  specValueHash: hashClaim(claim),
  specValueLength: claim.length
});
function sidecarEvidenceReferences(promotedClaims) {
  return promotedClaims.flatMap((claim) => Array.isArray(claim.evidenceReferences) ? claim.evidenceReferences : []);
}
function normalizePromotedClaim(entry, index, manifest) {
  const fallbackClaim = Array.isArray(manifest?.product?.features) ? manifest.product.features[index] : undefined;
  const claim = typeof entry?.claim === "string" ? entry.claim : fallbackClaim || "Fixture promoted claim.";
  const specKeys = ["connectivity", "maximum_dpi", "features"];
  const specLabels = ["Connectivity", "Maximum DPI", "Features"];
  const specKey = typeof entry?.specKey === "string" ? entry.specKey : specKeys[index] || "features";
  const specLabel = typeof entry?.specLabel === "string" ? entry.specLabel : specLabels[index] || "Features";
  const specValue = typeof entry?.specValue === "string" ? entry.specValue : claim;
  return {
    claim,
    claimHash: typeof entry?.claimHash === "string" ? entry.claimHash : hashClaim(claim),
    claimLength: typeof entry?.claimLength === "number" ? entry.claimLength : claim.length,
    specKey,
    specLabel,
    specValue,
    specValueHash: typeof entry?.specValueHash === "string" ? entry.specValueHash : hashClaim(specValue),
    specValueLength: typeof entry?.specValueLength === "number" ? entry.specValueLength : specValue.length,
    reasonCode: "positive_spec_promoted",
    evidenceReferences: Array.isArray(entry?.evidenceReferences) && entry.evidenceReferences.length > 0
      ? entry.evidenceReferences
      : [{
        recordId: "sample-record",
        provider: "shopping/others",
        source: index === 2 ? "metadata_feature" : "metadata_spec",
        path: ["metadata.specs.connectivity", "metadata.specs.maximum_dpi", "metadata.features.0"][index] || `metadata.features.${index}`,
        label: specLabel,
        excerpt: specValue
      }]
  };
}
function normalizeRejectedCandidate(entry, index) {
  const source = typeof entry?.source === "string" ? entry.source : "source_content";
  const reasonCode = typeof entry?.reasonCode === "string" ? entry.reasonCode : "marketplace_chrome_rejected";
  const reason = typeof entry?.reason === "string" ? entry.reason : "fixture rejected candidate";
  const evidenceReferences = Array.isArray(entry?.evidenceReferences)
    ? entry.evidenceReferences
    : [{
      recordId: "sample-record",
      provider: "shopping/others",
      source,
      path: "content",
      label: "Rejected candidate"
    }];
  return {
    source,
    reasonCode,
    reason,
    candidateHash: typeof entry?.candidateHash === "string" ? entry.candidateHash : hashClaim(`${source}:${reasonCode}:${index}`),
    evidenceReferenceCount: evidenceReferences.length,
    evidenceReferences
  };
}
function markdownEscape(value) {
  return String(value).replace(/([\\`*_{}\[\]()#+!|>~])/g, "\\$1");
}
function writePublicMarkdownArtifacts(dir, manifest) {
  if (!manifest?.product) return;
  const features = Array.isArray(manifest.product.features) ? manifest.product.features.filter((entry) => typeof entry === "string") : [];
  const copy = typeof manifest.product.copy === "string" && manifest.product.copy.trim()
    ? manifest.product.copy.trim()
    : expectedCopyForManifest(manifest);
  const copyPath = path.join(dir, "copy.md");
  const featuresPath = path.join(dir, "features.md");
  if (!fs.existsSync(copyPath)) {
    fs.writeFileSync(copyPath, [
      "# Product Copy",
      "",
      `Product: ${markdownEscape(manifest.product.title || "Example Product")}`,
      "",
      markdownEscape(copy),
      "",
      "## Presentation Readiness",
      `- Status: ${manifest.readiness?.presentation?.status || "pass"}`,
      "- Reason codes: positive_spec_promoted"
    ].join("\n"));
  }
  if (!fs.existsSync(featuresPath)) {
    fs.writeFileSync(featuresPath, [
      "# Product Features",
      "",
      ...features.map((feature) => `- ${markdownEscape(feature)}`),
      "",
      "## Presentation Readiness",
      `- Status: ${manifest.readiness?.presentation?.status || "pass"}`,
      "- Reason codes: positive_spec_promoted"
    ].join("\n"));
  }
}
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
      continue;
    }
    if (entry.name !== "presentation-readiness.json") continue;
    const manifestPath = path.join(dir, "manifest.json");
    const productPath = path.join(dir, "product.json");
    let manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) : undefined;
    if (manifest) {
      ensureListedAssetFiles(dir, manifest);
      const normalizedManifest = normalizeDefaultSampleCopy(dir, manifest);
      if (normalizedManifest) {
        manifest = normalizedManifest;
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
      }
    }
    if (dir !== missingProductJsonDir && fs.existsSync(manifestPath) && !fs.existsSync(productPath)) {
      fs.writeFileSync(productPath, JSON.stringify({
        ...(manifest.product || {}),
        presentationReadiness: manifest.readiness?.presentation,
        productVideoReadiness: manifest.readiness?.productVideo
      }, null, 2));
    }
    const productFallback = fs.existsSync(productPath) ? JSON.parse(fs.readFileSync(productPath, "utf8")) : undefined;
    const publicProduct = manifest?.product || productFallback;
    const value = JSON.parse(fs.readFileSync(fullPath, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    if (!value.presentationReadiness || !value.productVideoReadiness) continue;
    if (!Array.isArray(value.promotedClaims)) {
      const featureClaims = Array.isArray(publicProduct?.features) ? publicProduct.features : [];
      value.promotedClaims = featureClaims.map(promotedClaim);
    }
    value.promotedClaims = value.promotedClaims.map((entry, index) => normalizePromotedClaim(entry, index, manifest));
    value.rejectedCandidates = Array.isArray(value.rejectedCandidates)
      ? value.rejectedCandidates.map(normalizeRejectedCandidate)
      : [];
    value.evidenceReferences = Array.isArray(value.evidenceReferences)
      ? value.evidenceReferences
      : sidecarEvidenceReferences(value.promotedClaims);
    value.selectedRecordId = typeof value.selectedRecordId === "string" ? value.selectedRecordId : "sample-record";
    value.originalPrimaryRecordId = typeof value.originalPrimaryRecordId === "string" ? value.originalPrimaryRecordId : "sample-record";
    value.candidateSummaries = Array.isArray(value.candidateSummaries) && value.candidateSummaries.length > 0
      ? value.candidateSummaries
      : [{
        recordId: "sample-record",
        provider: "shopping/others",
        title: publicProduct?.title || "Example Product",
        cleanSpecCount: value.promotedClaims.length,
        rejectedCandidateCount: value.rejectedCandidates.length
      }];
    const imageCount = Array.isArray(manifest?.assets?.images) ? manifest.assets.images.length : 0;
    const screenshotCount = Array.isArray(manifest?.assets?.screenshots) ? manifest.assets.screenshots.length : 0;
    value.summary = {
      ...(value.summary && typeof value.summary === "object" && !Array.isArray(value.summary) ? value.summary : {}),
      status: value.summary?.status || value.presentationReadiness.status,
      promotedFeatureCount: Array.isArray(publicProduct?.features) ? publicProduct.features.length : 0,
      promotedClaimCount: value.promotedClaims.length,
      rejectedCandidateCount: value.rejectedCandidates.length,
      evidenceReferenceCount: value.evidenceReferences.length,
      imageCount,
      screenshotCount
    };
    fs.writeFileSync(fullPath, JSON.stringify(value, null, 2));
    writePublicMarkdownArtifacts(dir, manifest || {
      product: publicProduct,
      readiness: {
        presentation: value.presentationReadiness,
        productVideo: value.productVideoReadiness
      }
    });
  }
}
function promotedClaim(claim, index) {
  const specKeys = ["connectivity", "maximum_dpi", "features"];
  const specLabels = ["Connectivity", "Maximum DPI", "Features"];
  return {
    claim,
    ...claimIdentity(claim),
    specKey: specKeys[index] || "features",
    specLabel: specLabels[index] || "Features",
    specValue: claim,
    reasonCode: "positive_spec_promoted",
    evidenceReferences: [{
      recordId: "sample-record",
      provider: "shopping/others",
      source: index === 2 ? "metadata_feature" : "metadata_spec",
      path: ["metadata.specs.connectivity", "metadata.specs.maximum_dpi", "metadata.features.0"][index] || `metadata.features.${index}`,
      label: specLabels[index] || "Features",
      excerpt: claim
    }]
  };
}
walk(tmpRoot);
const sample = JSON.parse(fs.readFileSync(samplePath, "utf8"));
fs.mkdirSync(summaryDriftDir, { recursive: true });
fs.writeFileSync(path.join(summaryDriftDir, "manifest.json"), JSON.stringify(sample, null, 2));
fs.writeFileSync(path.join(summaryDriftDir, "presentation-readiness.json"), JSON.stringify({
  presentationReadiness: sample.readiness.presentation,
  productVideoReadiness: sample.readiness.productVideo,
  summary: {
    status: "partial",
    promotedFeatureCount: sample.product.features.length,
    promotedClaimCount: sample.product.features.length,
    rejectedCandidateCount: 0,
    evidenceReferenceCount: sample.product.features.length,
    imageCount: 0,
    screenshotCount: 1
  },
  promotedClaims: sample.product.features.map(promotedClaim)
}, null, 2));
fs.writeFileSync(path.join(summaryDriftDir, "product.json"), JSON.stringify({
  ...sample.product,
  presentationReadiness: sample.readiness.presentation,
  productVideoReadiness: sample.readiness.productVideo
}, null, 2));
' "$tmpdir" "$root/examples/sample-manifest.json" "$summary_drift_dir" "$missing_product_json_dir"
cp -R "$mixed_reason_dir" "$polluted_copy_markdown_dir"
cat > "$polluted_copy_markdown_dir/copy.md" <<'EOF'
# Product Copy

Guaranteed \#1 comfort should fail even when JSON artifacts are clean.

## Presentation Readiness
- Status: pass
- Reason codes: positive_spec_promoted
EOF
cp -R "$mixed_reason_dir" "$polluted_features_markdown_dir"
cat > "$polluted_features_markdown_dir/features.md" <<'EOF'
# Product Features

- Canada \(English\)
- Product Key Features
- Manufacturer

## Presentation Readiness
- Status: pass
- Reason codes: positive_spec_promoted
EOF
cp -R "$mixed_reason_dir" "$summary_only_dir"
node -e '
const fs = require("fs");
const path = require("path");
const dir = process.argv[1];
const readinessPath = path.join(dir, "presentation-readiness.json");
const readiness = JSON.parse(fs.readFileSync(readinessPath, "utf8"));
fs.writeFileSync(readinessPath, JSON.stringify({
  presentationReadiness: readiness.presentationReadiness,
  productVideoReadiness: readiness.productVideoReadiness,
  summary: readiness.summary
}, null, 2));
' "$summary_only_dir"
cp -R "$mixed_reason_dir" "$missing_visual_file_dir"
rm -f "$missing_visual_file_dir/images/image-01.jpg" "$missing_visual_file_dir/screenshots/screenshot-01.png"
cp -R "$mixed_reason_dir" "$missing_clean_criterion_dir"
node -e '
const fs = require("fs");
const path = require("path");
const dir = process.argv[1];
const visualOnlyCriteria = [{
  label: "Visual assets",
  observed: "1 image or screenshot asset(s)",
  threshold: "At least 1 visual asset for presentation-ready output",
  passed: true
}];
const manifestPath = path.join(dir, "manifest.json");
const productPath = path.join(dir, "product.json");
const readinessPath = path.join(dir, "presentation-readiness.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
manifest.readiness.presentation.criteria = visualOnlyCriteria;
manifest.readiness.productVideo.criteria = visualOnlyCriteria;
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
const product = JSON.parse(fs.readFileSync(productPath, "utf8"));
product.presentationReadiness.criteria = visualOnlyCriteria;
product.productVideoReadiness.criteria = visualOnlyCriteria;
fs.writeFileSync(productPath, JSON.stringify(product, null, 2));
const readiness = JSON.parse(fs.readFileSync(readinessPath, "utf8"));
readiness.presentationReadiness.criteria = visualOnlyCriteria;
readiness.productVideoReadiness.criteria = visualOnlyCriteria;
fs.writeFileSync(readinessPath, JSON.stringify(readiness, null, 2));
' "$missing_clean_criterion_dir"
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

parallel_alignment_section="$(awk '/^## Parallel Multitab Alignment/{flag=1; next} /^## /{flag=0} flag' "$skill_file")"
if printf '%s\n' "$parallel_alignment_section" | tr -d '`' | grep -Eiq '((workflow|browser-mode)[^.]*cdpconnect|cdpconnect[^.]*workflow|cdpconnect[^.]*browser-mode)'; then
  echo "Product presentation skill must not present cdpConnect in workflow browser-mode guidance." >&2
  status=1
fi
if ! grep -Fq 'workflow browser-mode sweeps with `auto`, `extension`, and `managed`' "$skill_file"; then
  echo "Product presentation skill must document current workflow browser modes." >&2
  status=1
fi
if ! grep -Fq "lower-level attach parity" "$skill_file"; then
  echo "Product presentation skill must keep CDP attach guidance scoped to lower-level parity." >&2
  status=1
fi
if grep -Fq 'find "$OUTDIR"' "$root/scripts/write-manifest.sh" || grep -Fq 'cp "$source_manifest"' "$root/scripts/write-manifest.sh"; then
  echo "write-manifest.sh must not copy a root-only manifest as the returned render input." >&2
  status=1
fi

write_manifest_mock="$tmpdir/write-manifest-cli"
cat > "$write_manifest_mock" <<'MOCKCLI'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" == "status" ]]; then
  printf '{"data":{"fingerprintCurrent":true}}\n'
  exit 0
fi
if [[ "${1:-}" == "product-video" && "${2:-}" == "run" ]]; then
  output_dir=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --output-dir)
        output_dir="$2"
        shift 2
        ;;
      *)
        shift
        ;;
    esac
  done
  bundle="$output_dir/product-video/mock-run"
  mkdir -p "$bundle"
  cat > "$bundle/manifest.json" <<'JSON'
{
  "product": {
    "title": "Mock Product",
    "brand": "Mock Brand",
    "features": ["Wireless connectivity supports a cleaner setup."],
    "copy": "Mock Product presentation highlights verified product details: Wireless connectivity supports a cleaner setup.",
    "price": { "amount": 29.99, "currency": "USD" }
  },
  "assets": { "images": [], "screenshots": [], "raw": [] },
  "readiness": {
    "presentation": {
      "status": "partial",
      "warnings": ["missing visual assets"],
      "reasonCodes": ["missing_visual_assets"],
      "criteria": []
    },
    "productVideo": {
      "status": "partial",
      "warnings": ["missing visual assets"],
      "reasonCodes": ["missing_visual_assets"],
      "criteria": []
    }
  }
}
JSON
  cat > "$bundle/presentation-readiness.json" <<'JSON'
{
  "presentationReadiness": {
    "status": "partial",
    "warnings": ["missing visual assets"],
    "reasonCodes": ["missing_visual_assets"],
    "criteria": []
  },
  "productVideoReadiness": {
    "status": "partial",
    "warnings": ["missing visual assets"],
    "reasonCodes": ["missing_visual_assets"],
    "criteria": []
  },
  "selectedRecordId": "mock-record",
  "originalPrimaryRecordId": "mock-record",
  "summary": {
    "status": "partial",
    "promotedFeatureCount": 1,
    "promotedClaimCount": 1,
    "rejectedCandidateCount": 0,
    "evidenceReferenceCount": 1,
    "imageCount": 0,
    "screenshotCount": 0
  },
  "candidateSummaries": [{
    "recordId": "mock-record",
    "provider": "shopping/fixture",
    "title": "Mock Product",
    "cleanSpecCount": 1,
    "rejectedCandidateCount": 0
  }],
  "promotedClaims": [{
    "claim": "Wireless connectivity supports a cleaner setup.",
    "specKey": "connectivity",
    "specLabel": "Connectivity",
    "specValue": "Wireless connectivity supports a cleaner setup.",
    "reasonCode": "positive_spec_promoted",
    "evidenceReferences": [{
      "recordId": "mock-record",
      "provider": "shopping/fixture",
      "source": "metadata_spec",
      "path": "metadata.specs.connectivity",
      "label": "Connectivity",
      "excerpt": "Wireless connectivity supports a cleaner setup."
    }]
  }],
  "rejectedCandidates": [],
  "evidenceReferences": [{
    "recordId": "mock-record",
    "provider": "shopping/fixture",
    "source": "metadata_spec",
    "path": "metadata.specs.connectivity",
    "label": "Connectivity",
    "excerpt": "Wireless connectivity supports a cleaner setup."
  }]
}
JSON
  cat > "$bundle/product.json" <<'JSON'
{
  "title": "Mock Product",
  "brand": "Mock Brand",
  "features": ["Wireless connectivity supports a cleaner setup."],
  "copy": "Mock Product presentation highlights verified product details: Wireless connectivity supports a cleaner setup.",
  "price": { "amount": 29.99, "currency": "USD" },
  "presentationReadiness": {
    "status": "partial",
    "warnings": ["missing visual assets"],
    "reasonCodes": ["missing_visual_assets"],
    "criteria": []
  },
  "productVideoReadiness": {
    "status": "partial",
    "warnings": ["missing visual assets"],
    "reasonCodes": ["missing_visual_assets"],
    "criteria": []
  }
}
JSON
  printf '# Product Copy\n' > "$bundle/copy.md"
  if [[ "${ODB_MOCK_MISSING_SIDECAR:-}" != "1" ]]; then
    printf '# Product Features\n' > "$bundle/features.md"
  fi
  escaped_bundle="$(node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$bundle")"
  printf '{"success":true,"data":{"artifact_path":%s}}\n' "$escaped_bundle"
  exit 0
fi
echo "unexpected mock CLI args: $*" >&2
exit 64
MOCKCLI
chmod +x "$write_manifest_mock"

write_manifest_outdir="$tmpdir/write-manifest-output"
write_manifest_output="$(ODB_CLI_VALIDATOR_OVERRIDE="$write_manifest_mock" "$root/scripts/write-manifest.sh" "Mock Product" "$write_manifest_outdir")"
expected_manifest="$write_manifest_outdir/product-video/mock-run/manifest.json"
if [[ "$write_manifest_output" != *"Manifest ready: $expected_manifest"* ]]; then
  echo "write-manifest.sh did not print the adjacent bundle manifest path." >&2
  status=1
fi
if [[ -f "$write_manifest_outdir/manifest.json" ]]; then
  echo "write-manifest.sh wrote a root-only manifest path." >&2
  status=1
fi
for sidecar in presentation-readiness.json product.json copy.md features.md; do
  if [[ ! -f "$write_manifest_outdir/product-video/mock-run/$sidecar" ]]; then
    echo "write-manifest.sh adjacency fixture missing sidecar: $sidecar" >&2
    status=1
  fi
done

render_valid_dir="$tmpdir/write-manifest-render-valid"
if ! "$root/scripts/render-video-brief.sh" "$expected_manifest" "$render_valid_dir" > "$tmpdir/write-manifest-render-valid.log" 2>&1; then
  echo "render-video-brief.sh could not consume write-manifest.sh emitted manifest path." >&2
  status=1
fi
if [[ ! -f "$render_valid_dir/video-brief.md" ]] || ! grep -Fq "Production gate: partial" "$render_valid_dir/video-brief.md"; then
  echo "render-video-brief.sh did not produce a gated brief from the write-manifest.sh emitted manifest path." >&2
  status=1
fi

if ODB_MOCK_MISSING_SIDECAR=1 ODB_CLI_VALIDATOR_OVERRIDE="$write_manifest_mock" "$root/scripts/write-manifest.sh" "Mock Product" "$tmpdir/write-manifest-missing" > "$tmpdir/write-manifest-missing.log" 2>&1; then
  echo "write-manifest.sh succeeded with missing adjacent sidecars." >&2
  status=1
fi
if grep -Fq "Manifest ready:" "$tmpdir/write-manifest-missing.log"; then
  echo "write-manifest.sh printed a consumable manifest path before sidecar validation." >&2
  status=1
fi
if ! grep -Fq "missing required adjacent file" "$tmpdir/write-manifest-missing.log"; then
  echo "write-manifest.sh did not report the missing adjacent sidecar." >&2
  status=1
fi

if [[ -f "$root/assets/templates/manifest.schema.json" ]]; then
  if ! node -e 'const fs=require("fs"); JSON.parse(fs.readFileSync(process.argv[1], "utf8"));' "$root/assets/templates/manifest.schema.json" >/dev/null 2>&1; then
    echo "Invalid JSON template: assets/templates/manifest.schema.json" >&2
    status=1
  fi
fi

expect_file_contains() {
  local file="$1"
  local needle="$2"
  local message="$3"
  if [[ ! -f "$file" ]]; then
    echo "$message Missing diagnostic output file: $file" >&2
    status=1
    return
  fi
  if ! grep -Fq "$needle" "$file"; then
    echo "$message" >&2
    status=1
  fi
}

expect_file_not_contains() {
  local file="$1"
  local needle="$2"
  local message="$3"
  if [[ ! -f "$file" ]]; then
    echo "$message Missing diagnostic output file: $file" >&2
    status=1
    return
  fi
  if grep -Fq "$needle" "$file"; then
    echo "$message" >&2
    status=1
  fi
}

"$root/scripts/render-video-brief.sh" "$mixed_reason_manifest" "$tmpdir/pass-brief" >/dev/null
if [[ -f "$tmpdir/pass-brief/video-brief.md" ]] && ! grep -Fq "Production gate: pass" "$tmpdir/pass-brief/video-brief.md"; then
  echo "render-video-brief.sh did not emit normal pass production gate." >&2
  status=1
fi
if [[ -f "$tmpdir/pass-brief/video-brief.md" ]] && ! grep -Fq -- "- Price: 29.99 USD" "$tmpdir/pass-brief/video-brief.md"; then
  echo "render-video-brief.sh did not preserve manifest pricing when product.json omits price." >&2
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
"$root/scripts/render-video-brief.sh" "$long_claim_manifest" "$tmpdir/long-claim-brief" >/dev/null
if [[ -f "$tmpdir/long-claim-brief/video-brief.md" ]] && ! grep -Fq "Production gate: pass" "$tmpdir/long-claim-brief/video-brief.md"; then
  echo "render-video-brief.sh failed pass readiness for a long promoted claim with bounded sidecar text." >&2
  status=1
fi
if [[ -f "$tmpdir/long-claim-brief/claims-evidence-map.md" ]] && ! grep -Fq "| metadata.features.0 | positive_spec_promoted | review_required |" "$tmpdir/long-claim-brief/claims-evidence-map.md"; then
  echo "render-video-brief.sh did not map long promoted claim evidence from bounded sidecar text." >&2
  status=1
fi
if "$root/scripts/render-video-brief.sh" "$long_claim_drift_manifest" "$tmpdir/long-claim-drift-brief" >/dev/null 2>/dev/null; then
  echo "render-video-brief.sh did not fail closed for a bounded promoted claim with a mismatched full-claim hash." >&2
  status=1
fi
expect_file_contains "$tmpdir/long-claim-drift-brief/video-brief.md" "promotedClaims with evidence references" "render-video-brief.sh did not report bounded promoted claim hash drift."
expect_file_contains "$tmpdir/long-claim-drift-brief/video-brief.md" "Production use: blocked" "render-video-brief.sh did not block bounded promoted claim hash drift."
expect_file_not_contains "$tmpdir/long-claim-drift-brief/claims-evidence-map.md" "Adds an unverified clean production claim. |" "render-video-brief.sh emitted hash-drifted long claim as evidence-backed output."
if "$root/scripts/render-video-brief.sh" "$root/examples/sample-manifest.json" "$tmpdir/missing-sidecar-brief" >/dev/null 2>/dev/null; then
  echo "render-video-brief.sh did not fail closed for pass readiness without promoted sidecar evidence." >&2
  status=1
fi
expect_file_contains "$tmpdir/missing-sidecar-brief/video-brief.md" "readiness_missing" "render-video-brief.sh did not report missing promoted sidecar evidence."
expect_file_contains "$tmpdir/missing-sidecar-brief/video-brief.md" "presentation-readiness.json.summary.status is missing" "render-video-brief.sh did not report missing sidecar summary status."
if "$root/scripts/render-video-brief.sh" "$summary_only_manifest" "$tmpdir/summary-only-brief" >/dev/null 2>/dev/null; then
  echo "render-video-brief.sh did not fail closed for a summary-only readiness sidecar." >&2
  status=1
fi
expect_file_contains "$tmpdir/summary-only-brief/video-brief.md" "presentation-readiness.json.selectedRecordId is required" "render-video-brief.sh did not report missing selected-record identity in a summary-only sidecar."
expect_file_contains "$tmpdir/summary-only-brief/video-brief.md" "presentation-readiness.json.promotedClaims must be an array" "render-video-brief.sh did not report missing promotedClaims in a summary-only sidecar."
expect_file_contains "$tmpdir/summary-only-brief/video-brief.md" "presentation-readiness.json.evidenceReferences must be an array" "render-video-brief.sh did not report missing evidenceReferences in a summary-only sidecar."
expect_file_contains "$tmpdir/summary-only-brief/video-brief.md" "Production use: blocked" "render-video-brief.sh did not block a summary-only readiness sidecar."
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
"$root/scripts/render-video-brief.sh" "$partial_unbacked_copy_manifest" "$tmpdir/partial-unbacked-copy-brief" >/dev/null
expect_file_contains "$tmpdir/partial-unbacked-copy-brief/video-brief.md" "Production gate: partial" "render-video-brief.sh did not keep partial unbacked copy output gated."
expect_file_contains "$tmpdir/partial-unbacked-copy-brief/video-brief.md" "Copy input omitted because product.copy does not match evidence-backed promotedClaims." "render-video-brief.sh did not omit unbacked product.copy in partial output."
expect_file_not_contains "$tmpdir/partial-unbacked-copy-brief/video-brief.md" "Clean partial promise without promoted claim support" "render-video-brief.sh leaked unbacked product.copy in partial output."
if "$root/scripts/render-video-brief.sh" "$fail_manifest" "$tmpdir/fail-brief" >/dev/null 2>/dev/null; then
  echo "render-video-brief.sh did not exit nonzero for fail readiness." >&2
  status=1
fi
expect_file_contains "$tmpdir/fail-brief/video-brief.md" "Production use: blocked" "render-video-brief.sh did not write fail readiness diagnostic."
expect_file_not_contains "$tmpdir/fail-brief/video-brief.md" "## Verified Features" "render-video-brief.sh labeled fail readiness features as verified."
expect_file_contains "$tmpdir/fail-brief/claims-evidence-map.md" "blocked" "render-video-brief.sh did not mark fail claims as blocked."
if "$root/scripts/render-video-brief.sh" "$drift_manifest" "$tmpdir/drift-brief" >/dev/null 2>/dev/null; then
  echo "render-video-brief.sh did not fail closed for readiness surface drift." >&2
  status=1
fi
expect_file_contains "$tmpdir/drift-brief/video-brief.md" "readiness_invalid" "render-video-brief.sh did not report invalid readiness surface drift."
expect_file_contains "$tmpdir/drift-brief/video-brief.md" "Production use: blocked" "render-video-brief.sh did not block readiness surface drift."
if "$root/scripts/render-video-brief.sh" "$mismatch_manifest" "$tmpdir/mismatch-brief" >/dev/null 2>/dev/null; then
  echo "render-video-brief.sh did not fail closed for pass-vs-partial readiness surface mismatch." >&2
  status=1
fi
expect_file_contains "$tmpdir/mismatch-brief/video-brief.md" "readiness_surface_mismatch" "render-video-brief.sh did not report readiness surface mismatch."
expect_file_contains "$tmpdir/mismatch-brief/video-brief.md" "Production use: blocked" "render-video-brief.sh did not block readiness surface mismatch."
if "$root/scripts/render-video-brief.sh" "$pass_structure_drift_manifest" "$tmpdir/pass-structure-drift-brief" >/dev/null 2>/dev/null; then
  echo "render-video-brief.sh did not fail closed for pass readiness structural mismatch." >&2
  status=1
fi
expect_file_contains "$tmpdir/pass-structure-drift-brief/video-brief.md" "readiness_surface_mismatch" "render-video-brief.sh did not report pass readiness structural mismatch."
expect_file_contains "$tmpdir/pass-structure-drift-brief/video-brief.md" "Production use: blocked" "render-video-brief.sh did not block pass readiness structural mismatch."
if "$root/scripts/render-video-brief.sh" "$polluted_copy_manifest" "$tmpdir/polluted-copy-brief" >/dev/null 2>/dev/null; then
  echo "render-video-brief.sh did not fail closed for polluted product.copy." >&2
  status=1
fi
expect_file_contains "$tmpdir/polluted-copy-brief/video-brief.md" "readiness_invalid" "render-video-brief.sh did not report polluted product.copy."
expect_file_contains "$tmpdir/polluted-copy-brief/video-brief.md" "Production use: blocked" "render-video-brief.sh did not block polluted product.copy."
expect_file_not_contains "$tmpdir/polluted-copy-brief/video-brief.md" "Buy It Now checkout copy" "render-video-brief.sh leaked polluted product.copy into the diagnostic brief."
if "$root/scripts/render-video-brief.sh" "$polluted_copy_markdown_manifest" "$tmpdir/polluted-copy-markdown-brief" >/dev/null 2>/dev/null; then
  echo "render-video-brief.sh did not fail closed for polluted copy.md with clean JSON artifacts." >&2
  status=1
fi
expect_file_contains "$tmpdir/polluted-copy-markdown-brief/video-brief.md" "copy.md" "render-video-brief.sh did not report polluted copy.md."
expect_file_contains "$tmpdir/polluted-copy-markdown-brief/video-brief.md" "unsupported_claim_rejected" "render-video-brief.sh did not classify escaped unsupported copy.md text."
expect_file_contains "$tmpdir/polluted-copy-markdown-brief/video-brief.md" "Production use: blocked" "render-video-brief.sh did not block polluted copy.md."
expect_file_not_contains "$tmpdir/polluted-copy-markdown-brief/video-brief.md" "Guaranteed #1 comfort" "render-video-brief.sh leaked polluted copy.md into the diagnostic brief."
if "$root/scripts/render-video-brief.sh" "$polluted_features_markdown_manifest" "$tmpdir/polluted-features-markdown-brief" >/dev/null 2>/dev/null; then
  echo "render-video-brief.sh did not fail closed for polluted features.md with clean JSON artifacts." >&2
  status=1
fi
expect_file_contains "$tmpdir/polluted-features-markdown-brief/video-brief.md" "features.md" "render-video-brief.sh did not report polluted features.md."
expect_file_contains "$tmpdir/polluted-features-markdown-brief/video-brief.md" "site_chrome_rejected" "render-video-brief.sh did not classify Apple locale text in features.md."
expect_file_contains "$tmpdir/polluted-features-markdown-brief/video-brief.md" "raw_fragment_rejected" "render-video-brief.sh did not classify eBay section-heading text in features.md."
expect_file_contains "$tmpdir/polluted-features-markdown-brief/video-brief.md" "Production use: blocked" "render-video-brief.sh did not block polluted features.md."
expect_file_not_contains "$tmpdir/polluted-features-markdown-brief/video-brief.md" "Canada (English)" "render-video-brief.sh leaked polluted features.md locale text into the diagnostic brief."
expect_file_not_contains "$tmpdir/polluted-features-markdown-brief/video-brief.md" "Product Key Features" "render-video-brief.sh leaked polluted features.md section-heading text into the diagnostic brief."
if "$root/scripts/render-video-brief.sh" "$polluted_title_manifest" "$tmpdir/polluted-title-brief" >/dev/null 2>/dev/null; then
  echo "render-video-brief.sh did not fail closed for polluted product.title." >&2
  status=1
fi
expect_file_contains "$tmpdir/polluted-title-brief/video-brief.md" "readiness_invalid" "render-video-brief.sh did not report polluted product.title."
expect_file_contains "$tmpdir/polluted-title-brief/video-brief.md" "Production use: blocked" "render-video-brief.sh did not block polluted product.title."
expect_file_not_contains "$tmpdir/polluted-title-brief/video-brief.md" "Brand Aurora Labs Type" "render-video-brief.sh leaked polluted product.title into the diagnostic brief."
if "$root/scripts/render-video-brief.sh" "$polluted_brand_manifest" "$tmpdir/polluted-brand-brief" >/dev/null 2>/dev/null; then
  echo "render-video-brief.sh did not fail closed for polluted product.brand." >&2
  status=1
fi
expect_file_contains "$tmpdir/polluted-brand-brief/video-brief.md" "readiness_invalid" "render-video-brief.sh did not report polluted product.brand."
expect_file_contains "$tmpdir/polluted-brand-brief/video-brief.md" "Production use: blocked" "render-video-brief.sh did not block polluted product.brand."
expect_file_not_contains "$tmpdir/polluted-brand-brief/video-brief.md" "Seller feedback" "render-video-brief.sh leaked polluted product.brand into the diagnostic brief."
if "$root/scripts/render-video-brief.sh" "$unsupported_feature_manifest" "$tmpdir/unsupported-feature-brief" >/dev/null 2>/dev/null; then
  echo "render-video-brief.sh did not fail closed for unsupported product.features text." >&2
  status=1
fi
expect_file_contains "$tmpdir/unsupported-feature-brief/video-brief.md" "unsupported_claim_rejected" "render-video-brief.sh did not report unsupported product.features text."
expect_file_contains "$tmpdir/unsupported-feature-brief/video-brief.md" "Production use: blocked" "render-video-brief.sh did not block unsupported product.features text."
expect_file_not_contains "$tmpdir/unsupported-feature-brief/video-brief.md" "Best vertical mouse comfort" "render-video-brief.sh leaked unsupported product.features text into the diagnostic brief."
if "$root/scripts/render-video-brief.sh" "$site_feature_manifest" "$tmpdir/site-feature-brief" >/dev/null 2>/dev/null; then
  echo "render-video-brief.sh did not fail closed for site chrome product.features text." >&2
  status=1
fi
expect_file_contains "$tmpdir/site-feature-brief/video-brief.md" "site_chrome_rejected" "render-video-brief.sh did not report site chrome product.features text."
expect_file_contains "$tmpdir/site-feature-brief/video-brief.md" "Production use: blocked" "render-video-brief.sh did not block site chrome product.features text."
expect_file_not_contains "$tmpdir/site-feature-brief/video-brief.md" "Find a Store" "render-video-brief.sh leaked site chrome product.features text into the diagnostic brief."
if "$root/scripts/render-video-brief.sh" "$site_title_manifest" "$tmpdir/site-title-brief" >/dev/null 2>/dev/null; then
  echo "render-video-brief.sh did not fail closed for site chrome product.title or product.brand text." >&2
  status=1
fi
expect_file_contains "$tmpdir/site-title-brief/video-brief.md" "site_chrome_rejected" "render-video-brief.sh did not report site chrome product.title or product.brand text."
expect_file_contains "$tmpdir/site-title-brief/video-brief.md" "Production use: blocked" "render-video-brief.sh did not block site chrome product.title or product.brand text."
expect_file_not_contains "$tmpdir/site-title-brief/video-brief.md" "Store" "render-video-brief.sh leaked site chrome product.title into the diagnostic brief."
expect_file_not_contains "$tmpdir/site-title-brief/video-brief.md" "AirPods" "render-video-brief.sh leaked site chrome product.brand into the diagnostic brief."
if "$root/scripts/render-video-brief.sh" "$unsupported_title_manifest" "$tmpdir/unsupported-title-brief" >/dev/null 2>/dev/null; then
  echo "render-video-brief.sh did not fail closed for unsupported product.title or product.brand text." >&2
  status=1
fi
expect_file_contains "$tmpdir/unsupported-title-brief/video-brief.md" "unsupported_claim_rejected" "render-video-brief.sh did not report unsupported product.title or product.brand text."
expect_file_contains "$tmpdir/unsupported-title-brief/video-brief.md" "Production use: blocked" "render-video-brief.sh did not block unsupported product.title or product.brand text."
expect_file_not_contains "$tmpdir/unsupported-title-brief/video-brief.md" "Number one vertical mouse" "render-video-brief.sh leaked unsupported product.title into the diagnostic brief."
expect_file_not_contains "$tmpdir/unsupported-title-brief/video-brief.md" "Number one accessory brand" "render-video-brief.sh leaked unsupported product.brand into the diagnostic brief."
if "$root/scripts/render-video-brief.sh" "$missing_manifest_readiness_manifest" "$tmpdir/missing-manifest-readiness-brief" >/dev/null 2>/dev/null; then
  echo "render-video-brief.sh did not fail closed when manifest.readiness production gates were missing." >&2
  status=1
fi
expect_file_contains "$tmpdir/missing-manifest-readiness-brief/video-brief.md" "readiness_missing" "render-video-brief.sh did not report missing manifest readiness gates."
expect_file_contains "$tmpdir/missing-manifest-readiness-brief/video-brief.md" "manifest.readiness.presentation is missing" "render-video-brief.sh did not identify the missing presentation manifest gate."
expect_file_contains "$tmpdir/missing-manifest-readiness-brief/video-brief.md" "manifest.readiness.productVideo is missing" "render-video-brief.sh did not identify the missing product-video manifest gate."
expect_file_contains "$tmpdir/missing-manifest-readiness-brief/video-brief.md" "Production use: blocked" "render-video-brief.sh did not block missing manifest readiness gates."
if "$root/scripts/render-video-brief.sh" "$missing_product_readiness_manifest" "$tmpdir/missing-product-readiness-brief" >/dev/null 2>/dev/null; then
  echo "render-video-brief.sh did not fail closed when product.json production gates were missing." >&2
  status=1
fi
expect_file_contains "$tmpdir/missing-product-readiness-brief/video-brief.md" "readiness_missing" "render-video-brief.sh did not report missing product.json readiness gates."
expect_file_contains "$tmpdir/missing-product-readiness-brief/video-brief.md" "product.json.presentationReadiness is missing" "render-video-brief.sh did not identify the missing product presentation gate."
expect_file_contains "$tmpdir/missing-product-readiness-brief/video-brief.md" "product.json.productVideoReadiness is missing" "render-video-brief.sh did not identify the missing product-video gate."
expect_file_contains "$tmpdir/missing-product-readiness-brief/video-brief.md" "Production use: blocked" "render-video-brief.sh did not block missing product.json readiness gates."
if "$root/scripts/render-video-brief.sh" "$missing_product_json_manifest" "$tmpdir/missing-product-json-brief" >/dev/null 2>/dev/null; then
  echo "render-video-brief.sh did not fail closed when product.json was missing." >&2
  status=1
fi
expect_file_contains "$tmpdir/missing-product-json-brief/video-brief.md" "readiness_invalid" "render-video-brief.sh did not report invalid readiness for missing product.json."
expect_file_contains "$tmpdir/missing-product-json-brief/video-brief.md" "product.json: product.json is required" "render-video-brief.sh did not identify the missing product.json artifact."
expect_file_contains "$tmpdir/missing-product-json-brief/video-brief.md" "Production use: blocked" "render-video-brief.sh did not block missing product.json."
if "$root/scripts/render-video-brief.sh" "$summary_drift_manifest" "$tmpdir/summary-drift-brief" >/dev/null 2>/dev/null; then
  echo "render-video-brief.sh did not fail closed for presentation-readiness summary status drift." >&2
  status=1
fi
expect_file_contains "$tmpdir/summary-drift-brief/video-brief.md" "readiness_surface_mismatch" "render-video-brief.sh did not report presentation-readiness summary status drift."
expect_file_contains "$tmpdir/summary-drift-brief/video-brief.md" "presentation-readiness.json.summary.status:partial" "render-video-brief.sh did not identify the drifted sidecar summary gate."
expect_file_contains "$tmpdir/summary-drift-brief/video-brief.md" "Production use: blocked" "render-video-brief.sh did not block presentation-readiness summary status drift."
if "$root/scripts/render-video-brief.sh" "$late_feature_manifest" "$tmpdir/late-feature-brief" >/dev/null 2>/dev/null; then
  echo "render-video-brief.sh did not fail closed for unsupported product.features text after the display limit." >&2
  status=1
fi
expect_file_contains "$tmpdir/late-feature-brief/video-brief.md" "unsupported_claim_rejected" "render-video-brief.sh did not report unsupported late product.features text."
expect_file_contains "$tmpdir/late-feature-brief/video-brief.md" "Production use: blocked" "render-video-brief.sh did not block unsupported late product.features text."
expect_file_not_contains "$tmpdir/late-feature-brief/video-brief.md" "Guaranteed #1 comfort" "render-video-brief.sh leaked unsupported late product.features text into the diagnostic brief."
if "$root/scripts/render-video-brief.sh" "$unbacked_late_feature_manifest" "$tmpdir/unbacked-late-feature-brief" >/dev/null 2>/dev/null; then
  echo "render-video-brief.sh did not fail closed for an unbacked public feature after the display limit." >&2
  status=1
fi
expect_file_contains "$tmpdir/unbacked-late-feature-brief/video-brief.md" "promotedClaims with evidence references" "render-video-brief.sh did not report unbacked late product.features text."
expect_file_contains "$tmpdir/unbacked-late-feature-brief/video-brief.md" "Production use: blocked" "render-video-brief.sh did not block unbacked late product.features text."
if "$root/scripts/render-video-brief.sh" "$late_copy_manifest" "$tmpdir/late-copy-brief" >/dev/null 2>/dev/null; then
  echo "render-video-brief.sh did not fail closed for polluted product.copy text after the display limit." >&2
  status=1
fi
expect_file_contains "$tmpdir/late-copy-brief/video-brief.md" "marketplace_chrome_rejected" "render-video-brief.sh did not report late polluted product.copy text."
expect_file_contains "$tmpdir/late-copy-brief/video-brief.md" "Production use: blocked" "render-video-brief.sh did not block late polluted product.copy text."
expect_file_not_contains "$tmpdir/late-copy-brief/video-brief.md" "Buy It Now checkout copy after" "render-video-brief.sh leaked late polluted product.copy into the diagnostic brief."
if "$root/scripts/render-video-brief.sh" "$unbacked_copy_manifest" "$tmpdir/unbacked-copy-brief" >/dev/null 2>/dev/null; then
  echo "render-video-brief.sh did not fail closed for clean but unbacked product.copy text." >&2
  status=1
fi
expect_file_contains "$tmpdir/unbacked-copy-brief/video-brief.md" "product.copy to match evidence-backed promotedClaims" "render-video-brief.sh did not report unbacked product.copy text."
expect_file_contains "$tmpdir/unbacked-copy-brief/video-brief.md" "Production use: blocked" "render-video-brief.sh did not block clean but unbacked product.copy text."
expect_file_not_contains "$tmpdir/unbacked-copy-brief/video-brief.md" "Clean lifestyle promise without promoted claim support" "render-video-brief.sh leaked clean but unbacked product.copy text."
if "$root/scripts/render-video-brief.sh" "$manifest_polluted_manifest" "$tmpdir/manifest-polluted-brief" >/dev/null 2>/dev/null; then
  echo "render-video-brief.sh did not fail closed for polluted manifest.product with clean product.json." >&2
  status=1
fi
expect_file_contains "$tmpdir/manifest-polluted-brief/video-brief.md" "marketplace_chrome_rejected" "render-video-brief.sh did not report polluted manifest.product with clean product.json."
expect_file_contains "$tmpdir/manifest-polluted-brief/video-brief.md" "Production use: blocked" "render-video-brief.sh did not block polluted manifest.product with clean product.json."
expect_file_not_contains "$tmpdir/manifest-polluted-brief/video-brief.md" "Buy It Now manifest copy" "render-video-brief.sh leaked polluted manifest.product copy into the diagnostic brief."
if "$root/scripts/render-video-brief.sh" "$clean_product_drift_manifest" "$tmpdir/clean-product-drift-brief" >/dev/null 2>/dev/null; then
  echo "render-video-brief.sh did not fail closed for clean but stale product.json public fields." >&2
  status=1
fi
expect_file_contains "$tmpdir/clean-product-drift-brief/video-brief.md" "readiness_surface_mismatch" "render-video-brief.sh did not report clean product.json public-field drift."
expect_file_contains "$tmpdir/clean-product-drift-brief/video-brief.md" "Production use: blocked" "render-video-brief.sh did not block clean product.json public-field drift."
expect_file_not_contains "$tmpdir/clean-product-drift-brief/video-brief.md" "Stale clean copy" "render-video-brief.sh leaked stale clean product.json copy into the diagnostic brief."
if "$root/scripts/render-video-brief.sh" "$pass_no_visual_manifest" "$tmpdir/pass-no-visual-brief" >/dev/null 2>/dev/null; then
  echo "render-video-brief.sh did not fail closed for pass readiness without visual assets." >&2
  status=1
fi
expect_file_contains "$tmpdir/pass-no-visual-brief/video-brief.md" "missing_visual_assets" "render-video-brief.sh did not report pass readiness without visual assets."
expect_file_contains "$tmpdir/pass-no-visual-brief/video-brief.md" "Production use: blocked" "render-video-brief.sh did not block pass readiness without visual assets."
if "$root/scripts/render-video-brief.sh" "$missing_visual_file_manifest" "$tmpdir/missing-visual-file-brief" >/dev/null 2>/dev/null; then
  echo "render-video-brief.sh did not fail closed for pass readiness with stale visual asset paths." >&2
  status=1
fi
expect_file_contains "$tmpdir/missing-visual-file-brief/video-brief.md" "at least one existing image or screenshot asset" "render-video-brief.sh did not report stale visual asset paths."
expect_file_contains "$tmpdir/missing-visual-file-brief/video-brief.md" "missing_visual_assets" "render-video-brief.sh did not add missing visual reason code for stale visual paths."
expect_file_contains "$tmpdir/missing-visual-file-brief/video-brief.md" "Production use: blocked" "render-video-brief.sh did not block stale visual asset paths."
if "$root/scripts/render-video-brief.sh" "$insufficient_claims_manifest" "$tmpdir/insufficient-claims-brief" >/dev/null 2>/dev/null; then
  echo "render-video-brief.sh did not fail closed for pass readiness below promoted-claim threshold." >&2
  status=1
fi
expect_file_contains "$tmpdir/insufficient-claims-brief/video-brief.md" "promotedClaims across" "render-video-brief.sh did not report insufficient promoted claims."
expect_file_contains "$tmpdir/insufficient-claims-brief/video-brief.md" "Production use: blocked" "render-video-brief.sh did not block insufficient promoted claims."
if "$root/scripts/render-video-brief.sh" "$insufficient_dimensions_manifest" "$tmpdir/insufficient-dimensions-brief" >/dev/null 2>/dev/null; then
  echo "render-video-brief.sh did not fail closed for pass readiness below evidence-dimension threshold." >&2
  status=1
fi
expect_file_contains "$tmpdir/insufficient-dimensions-brief/video-brief.md" "promotedClaims across" "render-video-brief.sh did not report insufficient evidence dimensions."
expect_file_contains "$tmpdir/insufficient-dimensions-brief/video-brief.md" "Production use: blocked" "render-video-brief.sh did not block insufficient evidence dimensions."
if "$root/scripts/render-video-brief.sh" "$missing_clean_criterion_manifest" "$tmpdir/missing-clean-criterion-brief" >/dev/null 2>/dev/null; then
  echo "render-video-brief.sh did not fail closed for pass readiness without the clean-benefit criterion." >&2
  status=1
fi
expect_file_contains "$tmpdir/missing-clean-criterion-brief/video-brief.md" "Clean benefit evidence criterion" "render-video-brief.sh did not report missing clean-benefit criterion."
expect_file_contains "$tmpdir/missing-clean-criterion-brief/video-brief.md" "Production use: blocked" "render-video-brief.sh did not block pass readiness missing the clean-benefit criterion."
if "$root/scripts/render-video-brief.sh" "$polluted_warning_manifest" "$tmpdir/polluted-warning-brief" >/dev/null 2>/dev/null; then
  echo "render-video-brief.sh did not fail closed for polluted readiness warnings." >&2
  status=1
fi
expect_file_contains "$tmpdir/polluted-warning-brief/video-brief.md" "readiness_invalid" "render-video-brief.sh did not report polluted readiness warnings."
expect_file_contains "$tmpdir/polluted-warning-brief/video-brief.md" "Production use: blocked" "render-video-brief.sh did not block polluted readiness warnings."
expect_file_not_contains "$tmpdir/polluted-warning-brief/video-brief.md" "Seller feedback 99 percent" "render-video-brief.sh leaked polluted readiness warning text."
if "$root/scripts/render-video-brief.sh" "$polluted_reason_manifest" "$tmpdir/polluted-reason-brief" >/dev/null 2>/dev/null; then
  echo "render-video-brief.sh did not fail closed for polluted readiness reason codes." >&2
  status=1
fi
expect_file_contains "$tmpdir/polluted-reason-brief/video-brief.md" "readiness_invalid" "render-video-brief.sh did not report polluted readiness reason codes."
expect_file_contains "$tmpdir/polluted-reason-brief/video-brief.md" "Production use: blocked" "render-video-brief.sh did not block polluted readiness reason codes."
expect_file_not_contains "$tmpdir/polluted-reason-brief/video-brief.md" "Buy It Now checkout" "render-video-brief.sh leaked polluted readiness reason code text."
if "$root/scripts/render-video-brief.sh" "$product_drift_manifest" "$tmpdir/product-drift-brief" >/dev/null 2>/dev/null; then
  echo "render-video-brief.sh did not fail closed for product.json readiness drift." >&2
  status=1
fi
expect_file_contains "$tmpdir/product-drift-brief/video-brief.md" "product.json.productVideoReadiness:partial" "render-video-brief.sh did not report product.json readiness drift."
expect_file_contains "$tmpdir/product-drift-brief/video-brief.md" "Production use: blocked" "render-video-brief.sh did not block product.json readiness drift."
if "$root/scripts/render-video-brief.sh" "$claim_drift_manifest" "$tmpdir/claim-drift-brief" >/dev/null 2>/dev/null; then
  echo "render-video-brief.sh did not fail closed for pass claim text drift." >&2
  status=1
fi
expect_file_contains "$tmpdir/claim-drift-brief/video-brief.md" "promotedClaims with evidence references" "render-video-brief.sh did not report pass claim text drift."
expect_file_not_contains "$tmpdir/claim-drift-brief/claims-evidence-map.md" "Unrelated feature row should not inherit evidence. |" "render-video-brief.sh emitted a drifted claim as evidence-backed output."
if "$root/scripts/render-video-brief.sh" "$malformed_manifest" "$tmpdir/malformed-brief" >/dev/null 2>/dev/null; then
  echo "render-video-brief.sh did not fail closed for malformed pass readiness." >&2
  status=1
fi
expect_file_contains "$tmpdir/malformed-brief/video-brief.md" "readiness_invalid" "render-video-brief.sh did not report malformed pass readiness."
expect_file_contains "$tmpdir/malformed-brief/video-brief.md" "Production use: blocked" "render-video-brief.sh did not block malformed pass readiness."
if "$root/scripts/render-video-brief.sh" "$failed_criteria_manifest" "$tmpdir/failed-criteria-brief" >/dev/null 2>/dev/null; then
  echo "render-video-brief.sh did not fail closed for pass readiness with failed criteria." >&2
  status=1
fi
expect_file_contains "$tmpdir/failed-criteria-brief/video-brief.md" "readiness_invalid" "render-video-brief.sh did not report pass readiness with failed criteria."
expect_file_contains "$tmpdir/failed-criteria-brief/video-brief.md" "Production use: blocked" "render-video-brief.sh did not block pass readiness with failed criteria."
if "$root/scripts/render-video-brief.sh" "$malformed_sidecar_manifest" "$tmpdir/malformed-sidecar-brief" >/dev/null 2>/dev/null; then
  echo "render-video-brief.sh did not fail closed for malformed readiness sidecar." >&2
  status=1
fi
expect_file_contains "$tmpdir/malformed-sidecar-brief/video-brief.md" "readiness_invalid" "render-video-brief.sh did not report malformed readiness sidecar."
expect_file_contains "$tmpdir/malformed-sidecar-brief/video-brief.md" "Production use: blocked" "render-video-brief.sh did not block malformed readiness sidecar."

if [[ $status -ne 0 ]]; then
  exit $status
fi

echo "Product presentation asset skill pack validated."
