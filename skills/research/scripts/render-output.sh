#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: render-output.sh <topic> <mode>"
  exit 1
fi

TOPIC="$1"
MODE="$2"

opendevbrowser research run --topic "$TOPIC" --mode "$MODE"
