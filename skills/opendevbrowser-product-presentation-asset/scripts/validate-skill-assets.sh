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

"$root/scripts/render-video-brief.sh" "$root/examples/sample-manifest.json" "$tmpdir/pass-brief" >/dev/null
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

if [[ $status -ne 0 ]]; then
  exit $status
fi

echo "Product presentation asset skill pack validated."
