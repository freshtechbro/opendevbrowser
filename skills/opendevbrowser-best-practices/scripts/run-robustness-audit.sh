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
)

status=0
target="${1:-all}"

if [[ "$target" == "-h" || "$target" == "--help" ]]; then
  usage
  exit 0
fi

found_target=0
for entry in "${skills[@]}"; do
  skill="${entry%%:*}"
  expected="${entry#*:}"
  if [[ "$target" != "all" && "$skill" != "$target" ]]; then
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
