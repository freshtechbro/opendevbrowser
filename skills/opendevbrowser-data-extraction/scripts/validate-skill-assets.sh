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

list_output="$("$root/scripts/run-extraction-workflow.sh" list-workflows)"
for workflow_name in \
  table \
  pagination \
  infinite-scroll \
  load-more \
  anti-bot-pressure \
  checkpoint-resume
do
  require_marker "workflow list" "$list_output" "$workflow_name"
done

list_output="$("$root/scripts/run-extraction-workflow.sh" list)"
require_marker "list extraction workflow" "$list_output" "opendevbrowser_snapshot"
require_marker "list extraction workflow" "$list_output" "opendevbrowser_get_attr"

table_output="$("$root/scripts/run-extraction-workflow.sh" table)"
require_marker "table workflow" "$table_output" "opendevbrowser_dom_get_html"
require_marker "table workflow" "$table_output" "table-ref"

pagination_output="$("$root/scripts/run-extraction-workflow.sh" pagination)"
require_marker "pagination workflow" "$pagination_output" "opendevbrowser_click"
require_marker "pagination workflow" "$pagination_output" "networkidle"

infinite_scroll_output="$("$root/scripts/run-extraction-workflow.sh" infinite-scroll)"
require_marker "infinite-scroll workflow" "$infinite_scroll_output" "opendevbrowser_scroll"
require_marker "infinite-scroll workflow" "$infinite_scroll_output" "opendevbrowser_wait"

anti_bot_output="$("$root/scripts/run-extraction-workflow.sh" anti-bot-pressure)"
require_marker "anti-bot-pressure workflow" "$anti_bot_output" "403/429/challenge"
require_marker "anti-bot-pressure workflow" "$anti_bot_output" "Retry-After"

checkpoint_output="$("$root/scripts/run-extraction-workflow.sh" checkpoint-resume)"
require_marker "checkpoint-resume workflow" "$checkpoint_output" "pagination checkpoint"
require_marker "checkpoint-resume workflow" "$checkpoint_output" "opendevbrowser_snapshot"

if ! node - "$root" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const [root] = process.argv.slice(2);
const failures = [];

const extractionSchema = JSON.parse(fs.readFileSync(path.join(root, "assets/templates/extraction-schema.json"), "utf8"));
const paginationState = JSON.parse(fs.readFileSync(path.join(root, "assets/templates/pagination-state.json"), "utf8"));
const qualityGates = JSON.parse(fs.readFileSync(path.join(root, "assets/templates/quality-gates.json"), "utf8"));

for (const field of ["title", "url"]) {
  if (!Array.isArray(extractionSchema.required_fields) || !extractionSchema.required_fields.includes(field)) {
    failures.push(`extraction-schema.json missing required field: ${field}`);
  }
}
if (extractionSchema.field_types?.price !== "number") {
  failures.push("extraction-schema.json must keep price typed as number.");
}
for (const field of ["price", "rating", "availability"]) {
  if (!Array.isArray(extractionSchema.optional_fields) || !extractionSchema.optional_fields.includes(field)) {
    failures.push(`extraction-schema.json missing optional field: ${field}`);
  }
}

for (const key of ["checkpoint_token", "retry_after_seconds", "challenge_loops", "stopping_reason"]) {
  if (!(key in paginationState)) {
    failures.push(`pagination-state.json missing key: ${key}`);
  }
}
if (paginationState.current_page !== 1) {
  failures.push("pagination-state.json must start with current_page=1.");
}

for (const key of [
  "max_required_null_rate",
  "max_duplicate_rate",
  "require_positive_page_delta",
  "max_consecutive_empty_pages",
  "max_consecutive_challenge_loops",
  "max_retries_per_page",
  "respect_retry_after",
  "stop_on_repeated_anti_bot_signals"
]) {
  if (!(key in qualityGates)) {
    failures.push(`quality-gates.json missing key: ${key}`);
  }
}
if (qualityGates.max_retries_per_page !== 2) {
  failures.push("quality-gates.json must cap retries per page at 2.");
}
if (qualityGates.respect_retry_after !== true || qualityGates.stop_on_repeated_anti_bot_signals !== true) {
  failures.push("quality-gates.json must enforce Retry-After and repeated anti-bot stops.");
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(failure);
  }
  process.exit(1);
}
NODE
then
  status=1
fi

if [[ $status -ne 0 ]]; then
  exit $status
fi

echo "Data extraction skill assets validated."
