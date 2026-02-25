#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: record-auth-signals.sh <template-json> <output-json>" >&2
  exit 1
fi

template="$1"
output="$2"

if [[ ! -f "$template" ]]; then
  echo "Missing template: $template" >&2
  exit 1
fi

cp "$template" "$output"
echo "Auth signal template copied to $output"
