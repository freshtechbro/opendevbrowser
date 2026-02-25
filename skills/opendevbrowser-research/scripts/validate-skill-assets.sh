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

if [[ -f "$root/assets/templates/context.json" ]]; then
  if ! node -e 'const fs=require("fs"); JSON.parse(fs.readFileSync(process.argv[1], "utf8"));' "$root/assets/templates/context.json" >/dev/null 2>&1; then
    echo "Invalid JSON template: assets/templates/context.json" >&2
    status=1
  fi
fi

if [[ $status -ne 0 ]]; then
  exit $status
fi

echo "Research skill assets validated."
