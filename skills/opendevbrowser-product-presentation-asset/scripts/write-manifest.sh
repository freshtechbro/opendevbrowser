#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: write-manifest.sh <product-url|product-name> <output-dir>"
  exit 1
fi

VALUE="$1"
OUTDIR="$2"
mkdir -p "$OUTDIR"

cmd=(opendevbrowser product-video run --output-dir "$OUTDIR" --output-format json)
if [[ "$VALUE" == http* ]]; then
  cmd+=(--product-url "$VALUE")
else
  cmd+=(--product-name "$VALUE")
fi

json_output="$("${cmd[@]}")"
printf '%s\n' "$json_output"

bundle_path="$(printf '%s\n' "$json_output" | node -e 'const fs=require("fs");const input=fs.readFileSync(0,"utf8").split(/\r?\n/).map((line)=>line.trim()).filter(Boolean);let payload=null;for(const line of input){try{payload=JSON.parse(line);}catch{}}const p=payload?.data?.path; if(typeof p==="string") process.stdout.write(p);')"
manifest_out="$OUTDIR/manifest.json"

if [[ ! -f "$manifest_out" ]]; then
  source_manifest=""
  if [[ -n "$bundle_path" && -f "$bundle_path/manifest.json" ]]; then
    source_manifest="$bundle_path/manifest.json"
  else
    source_manifest="$(find "$OUTDIR" -maxdepth 6 -type f -name manifest.json | head -n 1)"
  fi
  if [[ -n "$source_manifest" && -f "$source_manifest" ]]; then
    cp "$source_manifest" "$manifest_out"
  fi
fi

if [[ ! -f "$manifest_out" ]]; then
  echo "Manifest not found in output dir: $OUTDIR" >&2
  exit 2
fi

echo "Manifest ready: $manifest_out"
