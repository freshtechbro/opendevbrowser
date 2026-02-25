#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
skill_file="$root/SKILL.md"

required=(
  "artifacts/login-workflows.md"
  "assets/templates/login-scenario-matrix.json"
  "assets/templates/challenge-checkpoint.md"
  "assets/templates/auth-signals.json"
  "scripts/run-login-workflow.sh"
  "scripts/record-auth-signals.sh"
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

for rel in scripts/run-login-workflow.sh scripts/record-auth-signals.sh scripts/validate-skill-assets.sh; do
  if [[ -f "$root/$rel" && ! -x "$root/$rel" ]]; then
    echo "Script is not executable: $rel" >&2
    status=1
  fi
done

for rel in assets/templates/login-scenario-matrix.json assets/templates/auth-signals.json; do
  if [[ -f "$root/$rel" ]]; then
    if ! node -e 'const fs=require("fs"); JSON.parse(fs.readFileSync(process.argv[1], "utf8"));' "$root/$rel" >/dev/null 2>&1; then
      echo "Invalid JSON template: $rel" >&2
      status=1
    fi
  fi
done

if [[ $status -ne 0 ]]; then
  exit $status
fi

echo "Login automation skill assets validated."
