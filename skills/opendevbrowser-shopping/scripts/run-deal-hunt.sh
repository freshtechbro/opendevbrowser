#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: run-deal-hunt.sh <query> [providers] [output-dir]" >&2
  exit 1
fi

query="$1"
providers="${2:-}"
outdir="${3:-/tmp/odb-deals-$(date +%s)}"
mkdir -p "$outdir"

raw_json="$outdir/shopping.raw.json"
analysis_json="$outdir/market-analysis.json"
analysis_md="$outdir/market-analysis.md"

cmd=(opendevbrowser shopping run --query "$query" --mode json --output-format json)
if [[ -n "$providers" ]]; then
  cmd+=(--providers "$providers")
fi

"${cmd[@]}" > "$raw_json"

script_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$script_root/analyze-market.sh" "$raw_json" json > "$analysis_json"
"$script_root/analyze-market.sh" "$raw_json" md > "$analysis_md"

echo "Deal hunt complete"
echo "- raw: $raw_json"
echo "- json analysis: $analysis_json"
echo "- markdown analysis: $analysis_md"
