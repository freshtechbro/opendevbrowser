#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: write-artifacts.sh <topic> <output-dir>"
  exit 1
fi

TOPIC="$1"
OUTDIR="$2"

json_output="$(opendevbrowser research run --topic "$TOPIC" --mode path --output-dir "$OUTDIR" --output-format json)"
printf '%s\n' "$json_output"

artifact_path="$(printf '%s\n' "$json_output" | node -e 'const fs=require("fs");const lines=fs.readFileSync(0,"utf8").split(/\r?\n/).map((line)=>line.trim()).filter(Boolean);let payload=null;for(const line of lines){try{payload=JSON.parse(line);}catch{}}const p=payload?.data?.path; if(typeof p==="string") process.stdout.write(p);')"
if [[ -z "$artifact_path" || ! -d "$artifact_path" ]]; then
  manifest_path="$(find "$OUTDIR" -maxdepth 4 -type f -name bundle-manifest.json 2>/dev/null | head -n 1)"
  if [[ -n "$manifest_path" ]]; then
    artifact_path="$(dirname "$manifest_path")"
  fi
fi

if [[ -z "$artifact_path" || ! -d "$artifact_path" ]]; then
  echo "Artifact path not found for output dir: $OUTDIR" >&2
  exit 2
fi

node -e 'console.log(JSON.stringify({ data: { path: process.argv[1] } }));' "$artifact_path"
echo "Artifacts ready: $artifact_path"
