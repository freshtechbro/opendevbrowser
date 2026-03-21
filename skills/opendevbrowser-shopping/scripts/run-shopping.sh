#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: run-shopping.sh <query> [mode] [sort] [providers]" >&2
  exit 1
fi

query="$1"
mode="${2:-context}"
sort="${3:-best_deal}"
providers="${4:-}"

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../../opendevbrowser-best-practices/scripts/resolve-odb-cli.sh
source "$script_dir/../../opendevbrowser-best-practices/scripts/resolve-odb-cli.sh"

cmd=("${ODB_CLI[@]}" shopping run --query "$query" --mode "$mode" --sort "$sort")
if [[ -n "$providers" ]]; then
  cmd+=(--providers "$providers")
fi

"${cmd[@]}"
