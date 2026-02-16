#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: run-shopping.sh <query> [mode] [sort]"
  exit 1
fi

QUERY="$1"
MODE="${2:-context}"
SORT="${3:-best_deal}"

opendevbrowser shopping run \
  --query "$QUERY" \
  --mode "$MODE" \
  --sort "$SORT"
