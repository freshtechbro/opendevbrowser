#!/usr/bin/env bash
set -euo pipefail

skill_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
skill_file="$skill_root/SKILL.md"

required_paths=(
  "artifacts/provider-workflows.md"
  "artifacts/parity-gates.md"
  "artifacts/debug-trace-playbook.md"
  "artifacts/fingerprint-tiers.md"
  "artifacts/macro-workflows.md"
  "scripts/odb-workflow.sh"
  "scripts/validate-skill-assets.sh"
)

status=0

for rel_path in "${required_paths[@]}"; do
  full_path="$skill_root/$rel_path"
  if [[ ! -f "$full_path" ]]; then
    echo "Missing required asset: $rel_path" >&2
    status=1
  fi
done

for rel_path in "scripts/odb-workflow.sh" "scripts/validate-skill-assets.sh"; do
  full_path="$skill_root/$rel_path"
  if [[ -f "$full_path" && ! -x "$full_path" ]]; then
    echo "Script is not executable: $rel_path" >&2
    status=1
  fi
done

for rel_path in "${required_paths[@]}"; do
  if ! grep -Fq "$rel_path" "$skill_file"; then
    echo "SKILL.md missing reference: $rel_path" >&2
    status=1
  fi
done

if [[ $status -ne 0 ]]; then
  exit $status
fi

echo "Skill assets validated: ${#required_paths[@]} files referenced and present."
