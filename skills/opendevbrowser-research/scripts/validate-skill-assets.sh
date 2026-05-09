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

posture_files=(
  "SKILL.md"
  "artifacts/research-workflows.md"
  "assets/templates/compact.md"
  "assets/templates/context.json"
  "assets/templates/report.md"
)

required_markers=(
  "evidence-gated"
  "provider-constrained"
  "discovery-only"
  "search_engine_passes"
  "summary.md"
  "report.md"
  "records.json"
  "context.json"
  "meta.json"
  "bundle-manifest.json"
)

required_file_markers=(
  "SKILL.md|Search Engine Discovery Lane"
  "SKILL.md|Keep SERPs discovery-only"
  "SKILL.md|bundle-manifest.json"
  "artifacts/research-workflows.md|Search Engine Discovery Lane"
  "artifacts/research-workflows.md|Keep SERPs discovery-only"
  "artifacts/research-workflows.md|search_engine_passes"
  "assets/templates/context.json|bundle-manifest.json"
  "assets/templates/context.json|search_engine_passes"
  "assets/templates/report.md|SERPs are discovery-only"
  "assets/templates/report.md|bundle-manifest.json"
)

forbidden_markers=(
  "research_reliable"
  "auto is the recommended default"
  "generic topical research is currently safest"
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

require_file_marker() {
  local marker="$1"
  local found=0
  local rel
  for rel in "${posture_files[@]}"; do
    if [[ -f "$root/$rel" ]] && grep -Fq "$marker" "$root/$rel"; then
      found=1
      break
    fi
  done
  if [[ $found -eq 0 ]]; then
    echo "Research assets missing required marker: $marker" >&2
    status=1
  fi
}

require_marker_in_file() {
  local entry="$1"
  local rel="${entry%%|*}"
  local marker="${entry#*|}"
  if [[ ! -f "$root/$rel" ]] || ! grep -Fq "$marker" "$root/$rel"; then
    echo "Research asset $rel missing required marker: $marker" >&2
    status=1
  fi
}

reject_forbidden_marker() {
  local marker="$1"
  local rel
  for rel in "${posture_files[@]}"; do
    if [[ -f "$root/$rel" ]] && tr -d '`' < "$root/$rel" | grep -Fq "$marker"; then
      echo "Research assets contain forbidden marker in $rel: $marker" >&2
      status=1
    fi
  done
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

for marker in "${required_markers[@]}"; do
  require_file_marker "$marker"
done

for marker in "${required_file_markers[@]}"; do
  require_marker_in_file "$marker"
done

for marker in "${forbidden_markers[@]}"; do
  reject_forbidden_marker "$marker"
done

if [[ -f "$root/assets/templates/context.json" ]]; then
  if ! node -e 'const fs=require("fs"); JSON.parse(fs.readFileSync(process.argv[1], "utf8"));' "$root/assets/templates/context.json" >/dev/null 2>&1; then
    echo "Invalid JSON template: assets/templates/context.json" >&2
    status=1
  fi
fi

context_output="$("$root/scripts/run-research.sh" "ai browser automation" 30 context "web,docs")"
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
