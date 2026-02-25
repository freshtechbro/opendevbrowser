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

cmd=(opendevbrowser shopping run --query "$query" --mode "$mode" --sort "$sort")
if [[ -n "$providers" ]]; then
  cmd+=(--providers "$providers")
fi

"${cmd[@]}"
