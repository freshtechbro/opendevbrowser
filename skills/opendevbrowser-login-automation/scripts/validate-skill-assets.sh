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

password_output="$("$root/scripts/run-login-workflow.sh" password)"
require_marker "password workflow" "$password_output" "opendevbrowser_type"
require_marker "password workflow" "$password_output" "opendevbrowser_network_poll"

challenge_output="$("$root/scripts/run-login-workflow.sh" challenge-checkpoint)"
require_marker "challenge-checkpoint workflow" "$challenge_output" "manual checkpoint required"
require_marker "challenge-checkpoint workflow" "$challenge_output" "opendevbrowser_click"

pointer_output="$("$root/scripts/run-login-workflow.sh" pointer-checkpoint)"
require_marker "pointer-checkpoint workflow" "$pointer_output" "opendevbrowser_pointer_drag"
require_marker "pointer-checkpoint workflow" "$pointer_output" "steps=12"

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT
signals_output="$tmpdir/auth-signals.json"
"$root/scripts/record-auth-signals.sh" "$root/examples/sample-auth-signals.json" "$signals_output" >/dev/null
if ! cmp -s "$root/examples/sample-auth-signals.json" "$signals_output"; then
  echo "record-auth-signals.sh did not preserve the auth-signals fixture." >&2
  status=1
fi

if [[ $status -ne 0 ]]; then
  exit $status
fi

echo "Login automation skill assets validated."
