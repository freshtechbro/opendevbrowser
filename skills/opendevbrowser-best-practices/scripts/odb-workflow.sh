#!/usr/bin/env bash
set -euo pipefail

print_help() {
  cat <<'EOF'
OpenDevBrowser workflow router

Usage:
  ./skills/opendevbrowser-best-practices/scripts/odb-workflow.sh <workflow>

Workflows:
  provider-search
  provider-crawl
  parallel-multipage-safe
  qa-debug
  social-readonly-check
  parity-check
  surface-audit
  ops-channel-check
  cdp-channel-check
  mode-flag-matrix
  robustness-audit
  list
EOF
}

workflow="${1:-list}"

case "$workflow" in
  list)
    print_help
    ;;
  provider-search)
    cat <<'EOF'
opendevbrowser_launch noExtension=true
opendevbrowser_goto sessionId="<session-id>" url="<provider-search-url>"
opendevbrowser_wait sessionId="<session-id>" until="networkidle"
opendevbrowser_snapshot sessionId="<session-id>" format="actionables"
opendevbrowser_network_poll sessionId="<session-id>" max=50
EOF
    ;;
  provider-crawl)
    cat <<'EOF'
opendevbrowser_launch noExtension=true
opendevbrowser_goto sessionId="<session-id>" url="<seed-url>"
opendevbrowser_wait sessionId="<session-id>" until="networkidle"
opendevbrowser_snapshot sessionId="<session-id>" format="actionables"
opendevbrowser_scroll sessionId="<session-id>" dy=1000
opendevbrowser_wait sessionId="<session-id>" until="networkidle"
EOF
    ;;
  parallel-multipage-safe)
    cat <<'EOF'
# Reliable parallel pattern (as-is):
# - Worker A owns session-a
# - Worker B owns session-b
# - Keep each session serial (snapshot -> action -> snapshot)
# - Do NOT interleave independent target-use streams in one session
# - Managed + persisted profiles: use unique profile paths per session

opendevbrowser_launch noExtension=true
opendevbrowser_launch noExtension=true

# Worker A loop
opendevbrowser_goto sessionId="<session-a>" url="<url-a1>"
opendevbrowser_wait sessionId="<session-a>" until="networkidle"
opendevbrowser_snapshot sessionId="<session-a>" format="actionables"

# Worker B loop
opendevbrowser_goto sessionId="<session-b>" url="<url-b1>"
opendevbrowser_wait sessionId="<session-b>" until="networkidle"
opendevbrowser_snapshot sessionId="<session-b>" format="actionables"
EOF
    ;;
  qa-debug)
    cat <<'EOF'
opendevbrowser_snapshot sessionId="<session-id>" format="outline"
opendevbrowser_console_poll sessionId="<session-id>" max=100
opendevbrowser_network_poll sessionId="<session-id>" max=100
opendevbrowser_screenshot sessionId="<session-id>"
EOF
    ;;
  social-readonly-check)
    cat <<'EOF'
# Read-only social validation (default, no posting).
opendevbrowser_snapshot sessionId="<session-id>" format="actionables"
opendevbrowser_debug_trace_snapshot sessionId="<session-id>" maxEvents=50
opendevbrowser_network_poll sessionId="<session-id>" max=100
EOF
    ;;
  parity-check)
    cat <<'EOF'
npm run test -- tests/parity-matrix.test.ts
npm run test -- tests/tools.test.ts tests/daemon-commands.integration.test.ts
./skills/opendevbrowser-best-practices/scripts/validate-skill-assets.sh
EOF
    ;;
  surface-audit)
    cat <<'EOF'
cat docs/SURFACE_REFERENCE.md
cat skills/opendevbrowser-best-practices/artifacts/command-channel-reference.md
cat skills/opendevbrowser-best-practices/assets/templates/surface-audit-checklist.json
./skills/opendevbrowser-best-practices/scripts/validate-skill-assets.sh
EOF
    ;;
  ops-channel-check)
    cat <<'EOF'
npx opendevbrowser serve
npx opendevbrowser launch --extension-only --wait-for-extension --output-format json
npx opendevbrowser status --daemon --output-format json
# Verify opsConnected=true and extensionHandshakeComplete=true
cat skills/opendevbrowser-best-practices/assets/templates/ops-request-envelope.json
EOF
    ;;
  cdp-channel-check)
    cat <<'EOF'
npx opendevbrowser serve
npx opendevbrowser launch --extension-only --extension-legacy --wait-for-extension --output-format json
npx opendevbrowser status --daemon --output-format json
# Verify cdpConnected=true while legacy session is active
cat skills/opendevbrowser-best-practices/assets/templates/cdp-forward-envelope.json
EOF
    ;;
  mode-flag-matrix)
    cat <<'EOF'
cat skills/opendevbrowser-best-practices/assets/templates/mode-flag-matrix.json
npx opendevbrowser launch --no-extension --output-format json
npx opendevbrowser launch --extension-only --wait-for-extension --output-format json
npx opendevbrowser launch --extension-only --extension-legacy --wait-for-extension --output-format json
EOF
    ;;
  robustness-audit)
    cat <<'EOF'
cat skills/opendevbrowser-best-practices/artifacts/browser-agent-known-issues-matrix.md
cat skills/opendevbrowser-best-practices/assets/templates/robustness-checklist.json
./skills/opendevbrowser-best-practices/scripts/run-robustness-audit.sh
EOF
    ;;
  *)
    echo "Unknown workflow: $workflow" >&2
    print_help
    exit 2
    ;;
esac
