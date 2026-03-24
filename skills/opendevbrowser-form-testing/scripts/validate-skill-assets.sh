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

validation_output="$("$root/scripts/run-form-workflow.sh" validation)"
require_marker "validation workflow" "$validation_output" "aria-invalid"
require_marker "validation workflow" "$validation_output" "opendevbrowser_dom_get_text"

multi_step_output="$("$root/scripts/run-form-workflow.sh" multi-step)"
require_marker "multi-step workflow" "$multi_step_output" "next-step-ref"
require_marker "multi-step workflow" "$multi_step_output" "state=\"visible\""

challenge_output="$("$root/scripts/run-form-workflow.sh" challenge-checkpoint)"
require_marker "challenge-checkpoint workflow" "$challenge_output" "pause automation"
require_marker "challenge-checkpoint workflow" "$challenge_output" "opendevbrowser_snapshot"

if [[ $status -ne 0 ]]; then
  exit $status
fi

echo "Form testing skill assets validated."
