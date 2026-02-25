#!/usr/bin/env bash
set -euo pipefail

print_help() {
  cat <<'HELP'
Login automation workflow router

Usage:
  ./skills/opendevbrowser-login-automation/scripts/run-login-workflow.sh <workflow>

Workflows:
  password
  mfa
  sso-popup
  challenge-checkpoint
  challenge-loop-guard
  lockout-recovery
  session-persistence
  list
HELP
}

workflow="${1:-list}"

case "$workflow" in
  list)
    print_help
    ;;
  password)
    cat <<'FLOW'
opendevbrowser_goto sessionId="<session-id>" url="<login-url>"
opendevbrowser_wait sessionId="<session-id>" until="networkidle"
opendevbrowser_snapshot sessionId="<session-id>" format="actionables"
opendevbrowser_type sessionId="<session-id>" ref="<identifier-ref>" text="<identifier>"
opendevbrowser_type sessionId="<session-id>" ref="<password-ref>" text="<password>"
opendevbrowser_click sessionId="<session-id>" ref="<submit-ref>"
opendevbrowser_wait sessionId="<session-id>" until="networkidle"
opendevbrowser_snapshot sessionId="<session-id>" format="outline"
opendevbrowser_network_poll sessionId="<session-id>" max=50
FLOW
    ;;
  mfa)
    cat <<'FLOW'
# Run password workflow first.
opendevbrowser_wait sessionId="<session-id>" ref="<mfa-input-ref>" state="visible"
opendevbrowser_type sessionId="<session-id>" ref="<mfa-input-ref>" text="<otp>"
opendevbrowser_click sessionId="<session-id>" ref="<mfa-submit-ref>"
opendevbrowser_wait sessionId="<session-id>" until="networkidle"
opendevbrowser_snapshot sessionId="<session-id>" format="outline"
FLOW
    ;;
  sso-popup)
    cat <<'FLOW'
opendevbrowser_snapshot sessionId="<session-id>" format="actionables"
opendevbrowser_click sessionId="<session-id>" ref="<sso-provider-ref>"
# Rebind to popup/new target before continuing auth steps.
opendevbrowser_targets_list sessionId="<session-id>"
opendevbrowser_snapshot sessionId="<session-id>" format="actionables"
FLOW
    ;;
  challenge-checkpoint)
    cat <<'FLOW'
# Detect challenge state, then pause automated actions.
opendevbrowser_snapshot sessionId="<session-id>" format="outline"
# Manual checkpoint required: solve challenge with approved flow/test keys.
# Resume only after challenge is solved.
opendevbrowser_snapshot sessionId="<session-id>" format="actionables"
opendevbrowser_click sessionId="<session-id>" ref="<continue-ref>"
opendevbrowser_wait sessionId="<session-id>" until="networkidle"
FLOW
    ;;
  challenge-loop-guard)
    cat <<'FLOW'
# If challenge reappears twice, stop and escalate.
opendevbrowser_network_poll sessionId="<session-id>" max=100
# Honor Retry-After before any retry when present.
opendevbrowser_snapshot sessionId="<session-id>" format="outline"
FLOW
    ;;
  lockout-recovery)
    cat <<'FLOW'
opendevbrowser_snapshot sessionId="<session-id>" format="outline"
# If lockout/rate-limit banner present: stop retries and cooldown.
opendevbrowser_network_poll sessionId="<session-id>" max=50
FLOW
    ;;
  session-persistence)
    cat <<'FLOW'
opendevbrowser_launch profile="auth-test" persistProfile=true noExtension=true
# Authenticate once, close, relaunch same profile, then assert auth state.
opendevbrowser_snapshot sessionId="<session-id>" format="outline"
FLOW
    ;;
  *)
    echo "Unknown workflow: $workflow" >&2
    print_help
    exit 2
    ;;
esac
