#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: write-manifest.sh <product-url|product-name> <output-dir>"
  exit 1
fi

VALUE="$1"
OUTDIR="$2"
if [[ "$VALUE" == http* ]]; then
  opendevbrowser product-video run --product-url "$VALUE" --output-dir "$OUTDIR"
else
  opendevbrowser product-video run --product-name "$VALUE" --output-dir "$OUTDIR"
fi
