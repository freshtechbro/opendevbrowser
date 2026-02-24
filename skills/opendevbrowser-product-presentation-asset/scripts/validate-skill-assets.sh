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

if [[ -f "$root/assets/templates/manifest.schema.json" ]]; then
  if ! node -e 'const fs=require("fs"); JSON.parse(fs.readFileSync(process.argv[1], "utf8"));' "$root/assets/templates/manifest.schema.json" >/dev/null 2>&1; then
    echo "Invalid JSON template: assets/templates/manifest.schema.json" >&2
    status=1
  fi
fi

if [[ $status -ne 0 ]]; then
  exit $status
fi

echo "Product presentation asset skill pack validated."
