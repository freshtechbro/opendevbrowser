#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: run-research.sh <topic> [days] [mode] [source-selection] [sources]"
  exit 1
fi

TOPIC="$1"
DAYS="${2:-30}"
MODE="${3:-context}"
SOURCE_SELECTION="${4:-}"
SOURCES="${5:-}"

cmd=(opendevbrowser research run --topic "$TOPIC" --days "$DAYS" --mode "$MODE")
if [[ -n "$SOURCE_SELECTION" ]]; then
  cmd+=(--source-selection "$SOURCE_SELECTION")
fi
if [[ -n "$SOURCES" ]]; then
  cmd+=(--sources "$SOURCES")
fi

"${cmd[@]}"
