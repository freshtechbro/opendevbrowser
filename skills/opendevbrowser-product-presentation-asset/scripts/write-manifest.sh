#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: write-manifest.sh <product-url|product-name> <output-dir>"
  exit 1
fi

VALUE="$1"
OUTDIR="$2"
mkdir -p "$OUTDIR"

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../../opendevbrowser-best-practices/scripts/resolve-odb-cli.sh
source "$script_dir/../../opendevbrowser-best-practices/scripts/resolve-odb-cli.sh"
require_odb_daemon_current

cmd=("${ODB_CLI[@]}" product-video run --output-dir "$OUTDIR" --output-format json)
if [[ "$VALUE" == http* ]]; then
  cmd+=(--product-url "$VALUE")
else
  cmd+=(--product-name "$VALUE")
fi

json_output="$("${cmd[@]}")"
printf '%s\n' "$json_output"

bundle_path="$(printf '%s\n' "$json_output" | node -e 'const fs=require("fs");const input=fs.readFileSync(0,"utf8").split(/\r?\n/).map((line)=>line.trim()).filter(Boolean);let payload=null;for(const line of input){try{payload=JSON.parse(line);}catch{}}const p=payload?.data?.artifact_path; if(typeof p==="string") process.stdout.write(p);')"

if [[ -z "$bundle_path" ]]; then
  echo "Product-video output did not include data.artifact_path." >&2
  exit 2
fi

manifest_out="$bundle_path/manifest.json"
required_sidecars=(
  "$manifest_out"
  "$bundle_path/presentation-readiness.json"
  "$bundle_path/product.json"
  "$bundle_path/copy.md"
  "$bundle_path/features.md"
)

for required_path in "${required_sidecars[@]}"; do
  if [[ ! -f "$required_path" ]]; then
    echo "Product-video bundle is missing required adjacent file: $required_path" >&2
    exit 2
  fi
done

echo "Manifest ready: $manifest_out"
