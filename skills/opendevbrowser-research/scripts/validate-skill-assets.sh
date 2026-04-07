#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
skill_file="$root/SKILL.md"

required=(
  "artifacts/research-workflows.md"
  "assets/templates/compact.md"
  "assets/templates/context.json"
  "assets/templates/report.md"
  "scripts/run-research.sh"
  "scripts/render-output.sh"
  "scripts/write-artifacts.sh"
  "scripts/validate-skill-assets.sh"
)

status=0
validator_cli="$root/../opendevbrowser-best-practices/scripts/validator-fixture-cli.sh"
export ODB_CLI_VALIDATOR_OVERRIDE="$validator_cli"

require_marker() {
  local label="$1"
  local output="$2"
  local marker="$3"
  if [[ "$output" != *"$marker"* ]]; then
    echo "$label missing marker: $marker" >&2
    status=1
  fi
}
for rel in "${required[@]}"; do
  if [[ ! -f "$root/$rel" ]]; then
    echo "Missing required asset: $rel" >&2
    status=1
  fi
  if ! grep -Fq "$rel" "$skill_file"; then
    echo "SKILL.md missing reference: $rel" >&2
    status=1
  fi
done

for rel in scripts/run-research.sh scripts/render-output.sh scripts/write-artifacts.sh scripts/validate-skill-assets.sh; do
  if [[ -f "$root/$rel" && ! -x "$root/$rel" ]]; then
    echo "Script is not executable: $rel" >&2
    status=1
  fi
done

for rel in scripts/run-research.sh scripts/render-output.sh scripts/write-artifacts.sh; do
  if [[ -f "$root/$rel" ]]; then
    if ! grep -Fq "resolve-odb-cli.sh" "$root/$rel"; then
      echo "Workflow wrapper missing shared CLI resolver: $rel" >&2
      status=1
    fi
    if ! grep -Fq "ODB_CLI" "$root/$rel"; then
      echo "Workflow wrapper missing ODB_CLI invocation: $rel" >&2
      status=1
    fi
  fi
done

if [[ -f "$root/assets/templates/context.json" ]]; then
  if ! node -e 'const fs=require("fs"); JSON.parse(fs.readFileSync(process.argv[1], "utf8"));' "$root/assets/templates/context.json" >/dev/null 2>&1; then
    echo "Invalid JSON template: assets/templates/context.json" >&2
    status=1
  fi
fi

context_output="$("$root/scripts/run-research.sh" "ai browser automation" 30 context auto "web,docs")"
require_marker "run-research context" "$context_output" "# Research Context"
require_marker "run-research context" "$context_output" "ISSUE-09"

report_output="$("$root/scripts/render-output.sh" "ai browser automation" report)"
require_marker "render-output report" "$report_output" "# Research Report"
require_marker "render-output report" "$report_output" "Source selection"

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT
artifact_output="$("$root/scripts/write-artifacts.sh" "ai browser automation" "$tmpdir")"
artifact_path="$(printf '%s\n' "$artifact_output" | node -e 'const fs=require("fs");const lines=fs.readFileSync(0,"utf8").split(/\r?\n/).map((line)=>line.trim()).filter(Boolean);let payload=null;for(const line of lines){try{payload=JSON.parse(line);}catch{}}const value=payload?.data?.path; if(typeof value==="string") process.stdout.write(value);')"
if [[ -z "$artifact_path" || ! -d "$artifact_path" ]]; then
  echo "write-artifacts.sh did not produce a valid artifact directory." >&2
  status=1
elif [[ ! -f "$artifact_path/bundle-manifest.json" || ! -f "$artifact_path/report.md" ]]; then
  echo "write-artifacts.sh did not write the expected research bundle files." >&2
  status=1
fi

if [[ $status -ne 0 ]]; then
  exit $status
fi

echo "Research skill assets validated."
