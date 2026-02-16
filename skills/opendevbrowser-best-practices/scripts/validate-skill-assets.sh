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
  "artifacts/command-channel-reference.md"
  "assets/templates/mode-flag-matrix.json"
  "assets/templates/ops-request-envelope.json"
  "assets/templates/cdp-forward-envelope.json"
  "assets/templates/surface-audit-checklist.json"
  "scripts/odb-workflow.sh"
  "scripts/validate-skill-assets.sh"
)

json_templates=(
  "assets/templates/mode-flag-matrix.json"
  "assets/templates/ops-request-envelope.json"
  "assets/templates/cdp-forward-envelope.json"
  "assets/templates/surface-audit-checklist.json"
)

command_ref_markers=(
  'CLI commands: `50`'
  'Plugin tools: `44`'
  '`/ops` command names: `36`'
  'docs/SURFACE_REFERENCE.md'
  'opencode'
  'codex'
  'claudecode'
  'ampcli'
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

for rel_path in "${json_templates[@]}"; do
  full_path="$skill_root/$rel_path"
  if [[ -f "$full_path" ]]; then
    if ! node -e 'const fs=require("fs"); JSON.parse(fs.readFileSync(process.argv[1], "utf8"));' "$full_path" >/dev/null 2>&1; then
      echo "Invalid JSON template: $rel_path" >&2
      status=1
    fi
  fi
done

for rel_path in "${required_paths[@]}"; do
  if ! grep -Fq "$rel_path" "$skill_file"; then
    echo "SKILL.md missing reference: $rel_path" >&2
    status=1
  fi
done

command_ref_path="$skill_root/artifacts/command-channel-reference.md"
if [[ -f "$command_ref_path" ]]; then
  for marker in "${command_ref_markers[@]}"; do
    if ! grep -Fq "$marker" "$command_ref_path"; then
      echo "Command/channel reference missing marker: $marker" >&2
      status=1
    fi
  done
fi

if [[ $status -ne 0 ]]; then
  exit $status
fi

echo "Skill assets validated: ${#required_paths[@]} files referenced/present, ${#json_templates[@]} JSON templates parsed."
