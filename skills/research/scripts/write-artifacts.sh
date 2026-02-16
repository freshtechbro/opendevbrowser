#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: write-artifacts.sh <topic> <output-dir>"
  exit 1
fi

TOPIC="$1"
OUTDIR="$2"

opendevbrowser research run --topic "$TOPIC" --mode path --output-dir "$OUTDIR"
