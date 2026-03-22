#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: render-output.sh <topic> <mode>"
  exit 1
fi

TOPIC="$1"
MODE="$2"

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../../opendevbrowser-best-practices/scripts/resolve-odb-cli.sh
source "$script_dir/../../opendevbrowser-best-practices/scripts/resolve-odb-cli.sh"

"${ODB_CLI[@]}" research run --topic "$TOPIC" --mode "$MODE"
