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
  qa-debug
  safe-post
  parity-check
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
  qa-debug)
    cat <<'EOF'
opendevbrowser_snapshot sessionId="<session-id>" format="outline"
opendevbrowser_console_poll sessionId="<session-id>" max=100
opendevbrowser_network_poll sessionId="<session-id>" max=100
opendevbrowser_screenshot sessionId="<session-id>"
EOF
    ;;
  safe-post)
    cat <<'EOF'
# Risk notice: write/post action ahead.
# Require explicit operator confirmation before continuing.
opendevbrowser_snapshot sessionId="<session-id>" format="actionables"
opendevbrowser_click sessionId="<session-id>" ref="<submit-ref>"
opendevbrowser_network_poll sessionId="<session-id>" max=100
EOF
    ;;
  parity-check)
    cat <<'EOF'
npm run test -- tests/parity-matrix.test.ts
npm run test -- tests/tools.test.ts tests/daemon-command.test.ts
./skills/opendevbrowser-best-practices/scripts/validate-skill-assets.sh
EOF
    ;;
  *)
    echo "Unknown workflow: $workflow" >&2
    print_help
    exit 2
    ;;
esac
