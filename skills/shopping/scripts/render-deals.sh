#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: render-deals.sh <query> <mode>"
  exit 1
fi

QUERY="$1"
MODE="$2"
opendevbrowser shopping run --query "$QUERY" --mode "$MODE"
