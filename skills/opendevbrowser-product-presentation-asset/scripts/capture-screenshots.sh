#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: capture-screenshots.sh <product-url>"
  exit 1
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../../opendevbrowser-best-practices/scripts/resolve-odb-cli.sh
source "$script_dir/../../opendevbrowser-best-practices/scripts/resolve-odb-cli.sh"
require_odb_daemon_current

"${ODB_CLI[@]}" product-video run --product-url "$1" --include-screenshots --include-all-images=false
