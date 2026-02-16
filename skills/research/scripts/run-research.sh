#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: run-research.sh <topic> [days] [mode]"
  exit 1
fi

TOPIC="$1"
DAYS="${2:-30}"
MODE="${3:-context}"

opendevbrowser research run \
  --topic "$TOPIC" \
  --days "$DAYS" \
  --mode "$MODE"
