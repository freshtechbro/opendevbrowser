#!/usr/bin/env bash
set -euo pipefail

print_help() {
  cat <<'HELP'
Data extraction workflow router

Usage:
  ./skills/opendevbrowser-data-extraction/scripts/run-extraction-workflow.sh <workflow>

Workflows:
  list
  table
  pagination
  infinite-scroll
  load-more
  anti-bot-pressure
  checkpoint-resume
  list-workflows
HELP
}

workflow="${1:-list-workflows}"

case "$workflow" in
  list-workflows)
    print_help
    ;;
  list)
    cat <<'FLOW'
opendevbrowser_snapshot sessionId="<session-id>" format="actionables"
opendevbrowser_dom_get_text sessionId="<session-id>" ref="<item-title-ref>"
opendevbrowser_get_attr sessionId="<session-id>" ref="<item-link-ref>" name="href"
FLOW
    ;;
  table)
    cat <<'FLOW'
opendevbrowser_wait sessionId="<session-id>" until="networkidle"
opendevbrowser_snapshot sessionId="<session-id>" format="actionables"
opendevbrowser_dom_get_html sessionId="<session-id>" ref="<table-ref>"
FLOW
    ;;
  pagination)
    cat <<'FLOW'
opendevbrowser_click sessionId="<session-id>" ref="<next-ref>"
opendevbrowser_wait sessionId="<session-id>" until="networkidle"
opendevbrowser_snapshot sessionId="<session-id>" format="actionables"
FLOW
    ;;
  infinite-scroll)
    cat <<'FLOW'
opendevbrowser_scroll sessionId="<session-id>" dy=1000
opendevbrowser_wait sessionId="<session-id>" until="networkidle"
opendevbrowser_snapshot sessionId="<session-id>" format="actionables"
FLOW
    ;;
  load-more)
    cat <<'FLOW'
opendevbrowser_click sessionId="<session-id>" ref="<load-more-ref>"
opendevbrowser_wait sessionId="<session-id>" until="networkidle"
opendevbrowser_snapshot sessionId="<session-id>" format="actionables"
FLOW
    ;;
  anti-bot-pressure)
    cat <<'FLOW'
opendevbrowser_network_poll sessionId="<session-id>" max=100
# Stop or back off on repeated 403/429/challenge signals; honor Retry-After.
FLOW
    ;;
  checkpoint-resume)
    cat <<'FLOW'
# Resume from stored pagination checkpoint token/page index.
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
