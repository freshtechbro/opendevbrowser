#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
skill_file="$root/SKILL.md"

required=(
  "artifacts/form-workflows.md"
  "assets/templates/validation-matrix.json"
  "assets/templates/challenge-decision-tree.json"
  "assets/templates/a11y-assertions.md"
  "assets/templates/multi-step-state.json"
  "scripts/run-form-workflow.sh"
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

for rel in scripts/run-form-workflow.sh scripts/validate-skill-assets.sh; do
  if [[ -f "$root/$rel" && ! -x "$root/$rel" ]]; then
    echo "Script is not executable: $rel" >&2
    status=1
  fi
done

for rel in assets/templates/validation-matrix.json assets/templates/challenge-decision-tree.json assets/templates/multi-step-state.json; do
  if [[ -f "$root/$rel" ]]; then
    if ! node -e 'const fs=require("fs"); JSON.parse(fs.readFileSync(process.argv[1], "utf8"));' "$root/$rel" >/dev/null 2>&1; then
      echo "Invalid JSON template: $rel" >&2
      status=1
    fi
  fi
done

list_output="$("$root/scripts/run-form-workflow.sh" list)"
for workflow_name in \
  discovery \
  validation \
  multi-step \
  dynamic-required \
  file-upload \
  challenge-checkpoint
do
  require_marker "workflow list" "$list_output" "$workflow_name"
done

validation_output="$("$root/scripts/run-form-workflow.sh" validation)"
require_marker "validation workflow" "$validation_output" "aria-invalid"
require_marker "validation workflow" "$validation_output" "opendevbrowser_dom_get_text"

multi_step_output="$("$root/scripts/run-form-workflow.sh" multi-step)"
require_marker "multi-step workflow" "$multi_step_output" "next-step-ref"
require_marker "multi-step workflow" "$multi_step_output" "state=\"visible\""

challenge_output="$("$root/scripts/run-form-workflow.sh" challenge-checkpoint)"
require_marker "challenge-checkpoint workflow" "$challenge_output" "pause automation"
require_marker "challenge-checkpoint workflow" "$challenge_output" "opendevbrowser_snapshot"

dynamic_required_output="$("$root/scripts/run-form-workflow.sh" dynamic-required)"
require_marker "dynamic-required workflow" "$dynamic_required_output" "toggle-ref"
require_marker "dynamic-required workflow" "$dynamic_required_output" "opendevbrowser_snapshot"

file_upload_output="$("$root/scripts/run-form-workflow.sh" file-upload)"
require_marker "file-upload workflow" "$file_upload_output" "file-input-ref"
require_marker "file-upload workflow" "$file_upload_output" "opendevbrowser_network_poll"

if ! node - "$root" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const [root] = process.argv.slice(2);
const failures = [];

const validationMatrix = JSON.parse(fs.readFileSync(path.join(root, "assets/templates/validation-matrix.json"), "utf8"));
const challengeTree = JSON.parse(fs.readFileSync(path.join(root, "assets/templates/challenge-decision-tree.json"), "utf8"));
const multiStepState = JSON.parse(fs.readFileSync(path.join(root, "assets/templates/multi-step-state.json"), "utf8"));

if (!Array.isArray(validationMatrix.fields) || validationMatrix.fields.length === 0) {
  failures.push("validation-matrix.json must declare at least one field.");
} else {
  const firstField = validationMatrix.fields[0];
  for (const testCase of ["empty", "whitespace", "out_of_range", "valid"]) {
    if (!Array.isArray(firstField.cases) || !firstField.cases.includes(testCase)) {
      failures.push(`validation-matrix.json missing field case: ${testCase}`);
    }
  }
}
for (const marker of ["becomes_required_after_toggle", "hidden_field_not_submitted"]) {
  if (!Array.isArray(validationMatrix.conditional_cases) || !validationMatrix.conditional_cases.includes(marker)) {
    failures.push(`validation-matrix.json missing conditional case: ${marker}`);
  }
}
for (const marker of ["invalid_blocked", "valid_success"]) {
  if (!Array.isArray(validationMatrix.submit_cases) || !validationMatrix.submit_cases.includes(marker)) {
    failures.push(`validation-matrix.json missing submit case: ${marker}`);
  }
}

if (challengeTree.action !== "manual_checkpoint") {
  failures.push("challenge-decision-tree.json must default to manual_checkpoint.");
}
if (challengeTree.max_challenge_retries !== 2) {
  failures.push("challenge-decision-tree.json must cap retries at 2.");
}
for (const marker of ["challenge_cleared", "new_snapshot_taken"]) {
  if (!Array.isArray(challengeTree.resume_conditions) || !challengeTree.resume_conditions.includes(marker)) {
    failures.push(`challenge-decision-tree.json missing resume condition: ${marker}`);
  }
}

for (const key of ["flow", "step_index", "step_name", "completed_steps", "carried_state", "final_confirmation"]) {
  if (!(key in multiStepState)) {
    failures.push(`multi-step-state.json missing key: ${key}`);
  }
}
if (typeof multiStepState.final_confirmation?.seen !== "boolean") {
  failures.push("multi-step-state.json must define final_confirmation.seen as a boolean.");
}
if (typeof multiStepState.final_confirmation?.reference_id !== "string") {
  failures.push("multi-step-state.json must define final_confirmation.reference_id as a string.");
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

echo "Form testing skill assets validated."
