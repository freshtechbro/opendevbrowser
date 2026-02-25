#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: render-deals.sh <shopping-json-file> [json|md]" >&2
  exit 1
fi

input="$1"
mode="${2:-md}"

script_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$script_root/analyze-market.sh" "$input" "$mode"
