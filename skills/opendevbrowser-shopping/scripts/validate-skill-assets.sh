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
validator_cli="$root/../opendevbrowser-best-practices/scripts/validator-fixture-cli.sh"
export ODB_CLI_VALIDATOR_OVERRIDE="$validator_cli"

require_marker() {
  local label="$1"
  local output="$2"
  local marker="$3"
  if [[ "$output" != *"$marker"* ]]; then
    echo "$label missing marker: $marker" >&2
    status=1
  fi
}
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

for rel in scripts/run-shopping.sh scripts/normalize-offers.sh scripts/run-deal-hunt.sh; do
  if [[ -f "$root/$rel" ]]; then
    if ! grep -Fq "resolve-odb-cli.sh" "$root/$rel"; then
      echo "Workflow wrapper missing shared CLI resolver: $rel" >&2
      status=1
    fi
    if ! grep -Fq "ODB_CLI" "$root/$rel"; then
      echo "Workflow wrapper missing ODB_CLI invocation: $rel" >&2
      status=1
    fi
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

context_output="$("$root/scripts/run-shopping.sh" "wireless earbuds" context best_deal "provider-a,provider-b")"
require_marker "run-shopping context" "$context_output" "# Shopping Context"
require_marker "run-shopping context" "$context_output" "provider-a"

normalized_output="$("$root/scripts/normalize-offers.sh" "wireless earbuds" "provider-a,provider-b")"
if ! printf '%s\n' "$normalized_output" | node -e 'const fs=require("fs");const payload=JSON.parse(fs.readFileSync(0,"utf8")); if(!Array.isArray(payload.offers) || payload.offers.length < 2) process.exit(1);'; then
  echo "normalize-offers.sh did not return a normalized offers array." >&2
  status=1
fi

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT
deal_hunt_output="$("$root/scripts/run-deal-hunt.sh" "wireless earbuds" "provider-a,provider-b" "$tmpdir")"
require_marker "run-deal-hunt" "$deal_hunt_output" "Deal hunt complete"
require_marker "run-deal-hunt" "$deal_hunt_output" "market-analysis.json"
if [[ ! -f "$tmpdir/shopping.raw.json" || ! -f "$tmpdir/market-analysis.json" || ! -f "$tmpdir/market-analysis.md" ]]; then
  echo "run-deal-hunt.sh did not create the expected shopping artifacts." >&2
  status=1
fi

analysis_output="$("$root/scripts/analyze-market.sh" "$tmpdir/shopping.raw.json" json)"
if ! printf '%s\n' "$analysis_output" | node -e 'const fs=require("fs");const payload=JSON.parse(fs.readFileSync(0,"utf8")); if(!Array.isArray(payload.currency_summaries) || payload.currency_summaries.length === 0) process.exit(1);'; then
  echo "analyze-market.sh did not emit currency summaries." >&2
  status=1
fi

rendered_output="$("$root/scripts/render-deals.sh" "$tmpdir/shopping.raw.json" md)"
require_marker "render-deals" "$rendered_output" "# Market Deal Analysis"

if [[ $status -ne 0 ]]; then
  exit $status
fi

echo "Shopping skill assets validated."
