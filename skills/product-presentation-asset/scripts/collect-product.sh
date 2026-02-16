#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: collect-product.sh <product-url|product-name>"
  exit 1
fi

VALUE="$1"
if [[ "$VALUE" == http* ]]; then
  opendevbrowser product-video run --product-url "$VALUE"
else
  opendevbrowser product-video run --product-name "$VALUE"
fi
