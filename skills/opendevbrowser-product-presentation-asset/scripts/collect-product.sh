#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: collect-product.sh <product-url|product-name>"
  exit 1
fi

VALUE="$1"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../../opendevbrowser-best-practices/scripts/resolve-odb-cli.sh
source "$script_dir/../../opendevbrowser-best-practices/scripts/resolve-odb-cli.sh"

if [[ "$VALUE" == http* ]]; then
  "${ODB_CLI[@]}" product-video run --product-url "$VALUE"
else
  "${ODB_CLI[@]}" product-video run --product-name "$VALUE"
fi
