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

list_output="$("$root/scripts/run-login-workflow.sh" list)"
for workflow_name in \
  password \
  mfa \
  sso-popup \
  challenge-checkpoint \
  pointer-checkpoint \
  challenge-loop-guard \
  lockout-recovery \
  session-persistence
do
  require_marker "workflow list" "$list_output" "$workflow_name"
done

password_output="$("$root/scripts/run-login-workflow.sh" password)"
require_marker "password workflow" "$password_output" "opendevbrowser_type"
require_marker "password workflow" "$password_output" "opendevbrowser_network_poll"

mfa_output="$("$root/scripts/run-login-workflow.sh" mfa)"
require_marker "mfa workflow" "$mfa_output" "opendevbrowser_type"
require_marker "mfa workflow" "$mfa_output" "mfa-input-ref"

challenge_output="$("$root/scripts/run-login-workflow.sh" challenge-checkpoint)"
require_marker "challenge-checkpoint workflow" "$challenge_output" "manual checkpoint required"
require_marker "challenge-checkpoint workflow" "$challenge_output" "opendevbrowser_click"

pointer_output="$("$root/scripts/run-login-workflow.sh" pointer-checkpoint)"
require_marker "pointer-checkpoint workflow" "$pointer_output" "opendevbrowser_pointer_drag"
require_marker "pointer-checkpoint workflow" "$pointer_output" "steps=12"

challenge_loop_output="$("$root/scripts/run-login-workflow.sh" challenge-loop-guard)"
require_marker "challenge-loop-guard workflow" "$challenge_loop_output" "Retry-After"
require_marker "challenge-loop-guard workflow" "$challenge_loop_output" "opendevbrowser_network_poll"

lockout_output="$("$root/scripts/run-login-workflow.sh" lockout-recovery)"
require_marker "lockout-recovery workflow" "$lockout_output" "lockout/rate-limit banner"
require_marker "lockout-recovery workflow" "$lockout_output" "opendevbrowser_network_poll"

session_persistence_output="$("$root/scripts/run-login-workflow.sh" session-persistence)"
require_marker "session-persistence workflow" "$session_persistence_output" "persistProfile=true"
require_marker "session-persistence workflow" "$session_persistence_output" "profile=\"auth-test\""

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT
signals_output="$tmpdir/auth-signals.json"
"$root/scripts/record-auth-signals.sh" "$root/examples/sample-auth-signals.json" "$signals_output" >/dev/null
if ! cmp -s "$root/examples/sample-auth-signals.json" "$signals_output"; then
  echo "record-auth-signals.sh did not preserve the auth-signals fixture." >&2
  status=1
fi

if ! node - "$root" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const [root] = process.argv.slice(2);
const failures = [];

const matrix = JSON.parse(fs.readFileSync(path.join(root, "assets/templates/login-scenario-matrix.json"), "utf8"));
const authSignals = JSON.parse(fs.readFileSync(path.join(root, "assets/templates/auth-signals.json"), "utf8"));
const sampleSignals = JSON.parse(fs.readFileSync(path.join(root, "examples/sample-auth-signals.json"), "utf8"));

if (!Array.isArray(matrix.issue_ids) || matrix.issue_ids.length < 7) {
  failures.push("login-scenario-matrix.json must enumerate the workflow issue ids.");
}
for (const marker of ["url_changed", "auth_shell_visible", "auth_network_success", "pointer_gate_complete_when_required"]) {
  if (!Array.isArray(matrix.expected_signals) || !matrix.expected_signals.includes(marker)) {
    failures.push(`login-scenario-matrix.json missing expected signal: ${marker}`);
  }
}
for (const marker of ["invalid_credentials_ui_or_network", "anti_bot_challenge", "rate_limited", "lockout"]) {
  if (!Array.isArray(matrix.failure_signals) || !matrix.failure_signals.includes(marker)) {
    failures.push(`login-scenario-matrix.json missing failure signal: ${marker}`);
  }
}
if (matrix.max_automated_retries !== 2) {
  failures.push("login-scenario-matrix.json must cap automated retries at 2.");
}
if (typeof matrix.requires_manual_checkpoint !== "boolean") {
  failures.push("login-scenario-matrix.json must define requires_manual_checkpoint as a boolean.");
}

for (const key of [
  "invalid_credentials_ui_seen",
  "invalid_credentials_network_seen",
  "pointer_gate_detected",
  "pointer_gate_completed",
  "challenge_checkpoint_count",
  "mfa_detected",
  "issue_ids",
  "result"
]) {
  if (!(key in authSignals)) {
    failures.push(`auth-signals.json missing key: ${key}`);
  }
}
if (!authSignals.network || typeof authSignals.network.retry_after_seconds !== "number") {
  failures.push("auth-signals.json must define network.retry_after_seconds.");
}
if (!Array.isArray(authSignals.network?.status_codes)) {
  failures.push("auth-signals.json must define network.status_codes as an array.");
}
if (!Array.isArray(sampleSignals.network?.status_codes) || sampleSignals.network.status_codes[0] !== 200) {
  failures.push("sample-auth-signals.json must retain a successful login status code example.");
}
if (sampleSignals.result !== "authenticated") {
  failures.push("sample-auth-signals.json must demonstrate an authenticated result.");
}
if (sampleSignals.mfa_detected !== true) {
  failures.push("sample-auth-signals.json must preserve the MFA branch example.");
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

echo "Login automation skill assets validated."
