#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: normalize-offers.sh <query> [providers]" >&2
  exit 1
fi

query="$1"
providers="${2:-}"

cmd=(opendevbrowser shopping run --query "$query" --mode json --output-format json)
if [[ -n "$providers" ]]; then
  cmd+=(--providers "$providers")
fi

raw="$(${cmd[@]})"
printf '%s\n' "$raw" | node -e '
const fs=require("fs");
const input=fs.readFileSync(0,"utf8");
const payload=JSON.parse(input);
const offers=Array.isArray(payload.offers)?payload.offers
  : Array.isArray(payload?.data?.offers)?payload.data.offers
  : Array.isArray(payload?.context?.offers)?payload.context.offers
  : Array.isArray(payload?.data?.context?.offers)?payload.data.context.offers
  : [];
process.stdout.write(JSON.stringify({offers}, null, 2));
'
