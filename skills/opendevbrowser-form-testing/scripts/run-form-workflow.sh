#!/usr/bin/env bash
set -euo pipefail

print_help() {
  cat <<'HELP'
Form testing workflow router

Usage:
  ./skills/opendevbrowser-form-testing/scripts/run-form-workflow.sh <workflow>

Workflows:
  discovery
  validation
  multi-step
  dynamic-required
  file-upload
  challenge-checkpoint
  list
HELP
}

workflow="${1:-list}"

case "$workflow" in
  list)
    print_help
    ;;
  discovery)
    cat <<'FLOW'
opendevbrowser_snapshot sessionId="<session-id>" format="actionables"
# map refs for all inputs, toggles, and submit controls
FLOW
    ;;
  validation)
    cat <<'FLOW'
opendevbrowser_snapshot sessionId="<session-id>" format="actionables"
opendevbrowser_type sessionId="<session-id>" ref="<field-ref>" text=""
opendevbrowser_click sessionId="<session-id>" ref="<submit-ref>"
opendevbrowser_snapshot sessionId="<session-id>" format="outline"
opendevbrowser_dom_get_text sessionId="<session-id>" ref="<error-ref>"
opendevbrowser_get_attr sessionId="<session-id>" ref="<field-ref>" name="aria-invalid"
FLOW
    ;;
  multi-step)
    cat <<'FLOW'
# validate each step, then continue
opendevbrowser_click sessionId="<session-id>" ref="<next-step-ref>"
opendevbrowser_wait sessionId="<session-id>" ref="<step-container-ref>" state="visible"
opendevbrowser_snapshot sessionId="<session-id>" format="actionables"
FLOW
    ;;
  dynamic-required)
    cat <<'FLOW'
# Trigger conditional branch then re-snapshot for updated requirements.
opendevbrowser_click sessionId="<session-id>" ref="<toggle-ref>"
opendevbrowser_snapshot sessionId="<session-id>" format="actionables"
opendevbrowser_click sessionId="<session-id>" ref="<submit-ref>"
opendevbrowser_snapshot sessionId="<session-id>" format="outline"
FLOW
    ;;
  file-upload)
    cat <<'FLOW'
# Validate upload constraints and submission behavior.
opendevbrowser_snapshot sessionId="<session-id>" format="actionables"
opendevbrowser_click sessionId="<session-id>" ref="<file-input-ref>"
opendevbrowser_network_poll sessionId="<session-id>" max=50
FLOW
    ;;
  challenge-checkpoint)
    cat <<'FLOW'
# if challenge is detected, pause automation and resume after manual completion
opendevbrowser_snapshot sessionId="<session-id>" format="outline"
opendevbrowser_wait sessionId="<session-id>" until="networkidle"
opendevbrowser_snapshot sessionId="<session-id>" format="actionables"
FLOW
    ;;
  *)
    echo "Unknown workflow: $workflow" >&2
    print_help
    exit 2
    ;;
esac
