#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: run-research.sh <topic> [days] [mode] [sources]"
  exit 1
fi

TOPIC="$1"
DAYS="${2:-30}"
MODE="${3:-context}"
SOURCES="${4:-}"

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../../opendevbrowser-best-practices/scripts/resolve-odb-cli.sh
source "$script_dir/../../opendevbrowser-best-practices/scripts/resolve-odb-cli.sh"

cmd=("${ODB_CLI[@]}" research run --topic "$TOPIC" --days "$DAYS" --mode "$MODE")
if [[ -n "$SOURCES" ]]; then
  cmd+=(--sources "$SOURCES")
fi

"${cmd[@]}"
