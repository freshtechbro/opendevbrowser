#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
skill_file="$root/SKILL.md"

required=(
  "artifacts/extraction-workflows.md"
  "assets/templates/extraction-schema.json"
  "assets/templates/pagination-state.json"
  "assets/templates/quality-gates.json"
  "assets/templates/compliance-checklist.md"
  "scripts/run-extraction-workflow.sh"
  "scripts/validate-skill-assets.sh"
)

status=0

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

for rel in scripts/run-extraction-workflow.sh scripts/validate-skill-assets.sh; do
  if [[ -f "$root/$rel" && ! -x "$root/$rel" ]]; then
    echo "Script is not executable: $rel" >&2
    status=1
  fi
done

for rel in assets/templates/extraction-schema.json assets/templates/pagination-state.json assets/templates/quality-gates.json; do
  if [[ -f "$root/$rel" ]]; then
    if ! node -e 'const fs=require("fs"); JSON.parse(fs.readFileSync(process.argv[1], "utf8"));' "$root/$rel" >/dev/null 2>&1; then
      echo "Invalid JSON template: $rel" >&2
      status=1
    fi
  fi
done

list_output="$("$root/scripts/run-extraction-workflow.sh" list)"
require_marker "list workflow" "$list_output" "opendevbrowser_snapshot"
require_marker "list workflow" "$list_output" "opendevbrowser_get_attr"

pagination_output="$("$root/scripts/run-extraction-workflow.sh" pagination)"
require_marker "pagination workflow" "$pagination_output" "opendevbrowser_click"
require_marker "pagination workflow" "$pagination_output" "networkidle"

infinite_scroll_output="$("$root/scripts/run-extraction-workflow.sh" infinite-scroll)"
require_marker "infinite-scroll workflow" "$infinite_scroll_output" "opendevbrowser_scroll"
require_marker "infinite-scroll workflow" "$infinite_scroll_output" "opendevbrowser_wait"

anti_bot_output="$("$root/scripts/run-extraction-workflow.sh" anti-bot-pressure)"
require_marker "anti-bot-pressure workflow" "$anti_bot_output" "403/429/challenge"
require_marker "anti-bot-pressure workflow" "$anti_bot_output" "Retry-After"

if [[ $status -ne 0 ]]; then
  exit $status
fi

echo "Data extraction skill assets validated."
