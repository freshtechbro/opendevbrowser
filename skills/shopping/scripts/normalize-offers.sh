#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: normalize-offers.sh <query>"
  exit 1
fi

QUERY="$1"
opendevbrowser shopping run --query "$QUERY" --mode json
