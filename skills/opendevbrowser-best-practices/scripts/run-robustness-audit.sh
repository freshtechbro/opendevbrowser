#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
skills_root="$(cd "$root/.." && pwd)"
matrix_ref="../opendevbrowser-best-practices/artifacts/browser-agent-known-issues-matrix.md"

usage() {
  cat <<'HELP'
Run robustness audit checks across opendevbrowser workflow skill packs.

Usage:
  ./skills/opendevbrowser-best-practices/scripts/run-robustness-audit.sh [skill-name]

Examples:
  ./skills/opendevbrowser-best-practices/scripts/run-robustness-audit.sh
  ./skills/opendevbrowser-best-practices/scripts/run-robustness-audit.sh canvas-pack
  ./skills/opendevbrowser-best-practices/scripts/run-robustness-audit.sh opendevbrowser-shopping
HELP
}

skills=(
  "opendevbrowser-login-automation:ISSUE-01 ISSUE-02 ISSUE-03 ISSUE-04 ISSUE-05 ISSUE-06 ISSUE-07"
  "opendevbrowser-form-testing:ISSUE-01 ISSUE-02 ISSUE-05 ISSUE-06 ISSUE-08"
  "opendevbrowser-data-extraction:ISSUE-01 ISSUE-06 ISSUE-08 ISSUE-09 ISSUE-10"
  "opendevbrowser-shopping:ISSUE-06 ISSUE-09 ISSUE-10 ISSUE-11 ISSUE-12"
  "opendevbrowser-product-presentation-asset:ISSUE-10 ISSUE-11 ISSUE-12"
  "opendevbrowser-research:ISSUE-06 ISSUE-09 ISSUE-10 ISSUE-12"
  "opendevbrowser-design-agent:ISSUE-01 ISSUE-07 ISSUE-08 ISSUE-12"
)

canvas_issue_ids=(
  "CANVAS-01"
  "CANVAS-02"
  "CANVAS-03"
  "CANVAS-04"
  "CANVAS-05"
  "CANVAS-06"
  "CANVAS-07"
)

status=0
target="${1:-all}"

check_canvas_pack() {
  local root="$1"
  local status_ref="$2"
  local playbook="$root/artifacts/canvas-governance-playbook.md"
  local command_ref="$root/artifacts/command-channel-reference.md"
  local skill_file="$root/SKILL.md"
  local feedback_eval="$root/assets/templates/canvas-feedback-eval.json"
  local blocker_checklist="$root/assets/templates/canvas-blocker-checklist.json"
  local robustness_checklist="$root/assets/templates/robustness-checklist.json"

  for file_path in "$playbook" "$command_ref" "$skill_file" "$feedback_eval" "$blocker_checklist" "$robustness_checklist"; do
    if [[ ! -f "$file_path" ]]; then
      echo "[canvas-pack] missing file: $file_path" >&2
      printf -v "$status_ref" '%s' 1
      return
    fi
  done

  for marker in \
    "Canvas Governance Handshake" \
    "artifacts/canvas-governance-playbook.md" \
    "assets/templates/canvas-feedback-eval.json"; do
    if ! grep -Fq "$marker" "$skill_file"; then
      echo "[canvas-pack] SKILL.md missing marker: $marker" >&2
      printf -v "$status_ref" '%s' 1
    fi
  done

  for marker in \
    "canvas.session.open" \
    "canvas.plan.set" \
    "canvas.feedback.poll" \
    "plan_required"; do
    if ! grep -Fq "$marker" "$command_ref"; then
      echo "[canvas-pack] command/channel reference missing marker: $marker" >&2
      printf -v "$status_ref" '%s' 1
    fi
  done

  for issue_id in "${canvas_issue_ids[@]}"; do
    if ! grep -Fq "$issue_id" "$playbook"; then
      echo "[canvas-pack] playbook missing issue id: $issue_id" >&2
      printf -v "$status_ref" '%s' 1
    fi
  done

  if ! node -e '
    const fs = require("fs");
    const [feedbackPath, blockerPath, robustnessPath, ...expected] = process.argv.slice(1);
    const feedback = JSON.parse(fs.readFileSync(feedbackPath, "utf8"));
    const blockers = JSON.parse(fs.readFileSync(blockerPath, "utf8"));
    const robustness = JSON.parse(fs.readFileSync(robustnessPath, "utf8"));
    const feedbackIds = new Set(feedback.requiredIssueClasses || []);
    const blockerIds = new Set((blockers.blockers || []).map((entry) => entry.auditId));
    const reviewIds = new Set((blockers.reviewChecks || []).map((entry) => entry.auditId));
    const checklistIds = new Set([...blockerIds, ...reviewIds]);
    const robustnessIds = new Set((((robustness.canvas || {}).issueClasses) || []).map((entry) => entry.auditId));
    const missing = expected.filter((id) => !feedbackIds.has(id) || !checklistIds.has(id) || !robustnessIds.has(id));
    if (missing.length > 0) {
      console.error(`[canvas-pack] missing canvas audit ids in JSON templates: ${missing.join(", ")}`);
      process.exit(1);
    }
  ' "$feedback_eval" "$blocker_checklist" "$robustness_checklist" "${canvas_issue_ids[@]}"; then
    printf -v "$status_ref" '%s' 1
  fi
}

if [[ "$target" == "-h" || "$target" == "--help" ]]; then
  usage
  exit 0
fi

found_target=0
if [[ "$target" == "all" || "$target" == "canvas-pack" ]]; then
  found_target=1
  check_canvas_pack "$root" status
fi

for entry in "${skills[@]}"; do
  skill="${entry%%:*}"
  expected="${entry#*:}"
  if [[ "$target" != "all" && "$target" != "canvas-pack" && "$skill" != "$target" ]]; then
    continue
  fi
  found_target=1

  skill_file="$skills_root/$skill/SKILL.md"
  if [[ ! -f "$skill_file" ]]; then
    echo "Missing SKILL.md: $skill_file" >&2
    status=1
    continue
  fi

  if ! grep -Fq "Robustness Coverage (Known-Issue Matrix)" "$skill_file"; then
    echo "[$skill] missing robustness coverage section" >&2
    status=1
  fi

  if ! grep -Fq "$matrix_ref" "$skill_file"; then
    echo "[$skill] missing matrix reference: $matrix_ref" >&2
    status=1
  fi

  for issue_id in $expected; do
    if ! grep -Fq "$issue_id" "$skill_file"; then
      echo "[$skill] missing issue id: $issue_id" >&2
      status=1
    fi
  done

done

if [[ "$target" != "all" && $found_target -eq 0 ]]; then
  echo "Unknown skill: $target" >&2
  usage
  exit 2
fi

if [[ $status -ne 0 ]]; then
  exit $status
fi

echo "Robustness audit checks passed for ${target}."
