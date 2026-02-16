#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: download-images.sh <product-url>"
  exit 1
fi

opendevbrowser product-video run --product-url "$1" --include-all-images
