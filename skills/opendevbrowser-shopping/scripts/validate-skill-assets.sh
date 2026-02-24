#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
skill_file="$root/SKILL.md"

required=(
  "artifacts/deal-hunting-workflows.md"
  "assets/templates/deals-context.json"
  "assets/templates/deals-table.md"
  "assets/templates/market-analysis.json"
  "assets/templates/deal-thresholds.json"
  "scripts/run-shopping.sh"
  "scripts/normalize-offers.sh"
  "scripts/render-deals.sh"
  "scripts/analyze-market.sh"
  "scripts/run-deal-hunt.sh"
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

for rel in scripts/run-shopping.sh scripts/normalize-offers.sh scripts/render-deals.sh scripts/analyze-market.sh scripts/run-deal-hunt.sh scripts/validate-skill-assets.sh; do
  if [[ -f "$root/$rel" && ! -x "$root/$rel" ]]; then
    echo "Script is not executable: $rel" >&2
    status=1
  fi
done

for rel in assets/templates/deals-context.json assets/templates/market-analysis.json assets/templates/deal-thresholds.json; do
  if [[ -f "$root/$rel" ]]; then
    if ! node -e 'const fs=require("fs"); JSON.parse(fs.readFileSync(process.argv[1], "utf8"));' "$root/$rel" >/dev/null 2>&1; then
      echo "Invalid JSON template: $rel" >&2
      status=1
    fi
  fi
done

if [[ $status -ne 0 ]]; then
  exit $status
fi

echo "Shopping skill assets validated."
