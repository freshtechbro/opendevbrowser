#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: capture-screenshots.sh <product-url>"
  exit 1
fi

opendevbrowser product-video run --product-url "$1" --include-screenshots --include-all-images=false
