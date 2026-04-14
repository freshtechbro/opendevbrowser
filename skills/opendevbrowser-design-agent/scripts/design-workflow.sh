#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../../opendevbrowser-best-practices/scripts/resolve-odb-cli.sh
source "$script_dir/../../opendevbrowser-best-practices/scripts/resolve-odb-cli.sh"

render_cli_prefix() {
  local rendered=()
  local part
  for part in "${ODB_CLI[@]}"; do
    rendered+=("$(printf '%q' "$part")")
  done
  printf '%s' "${rendered[*]}"
}

CLI_PREFIX="$(render_cli_prefix)"

print_help() {
  cat <<'EOF'
OpenDevBrowser design-agent workflow router

Usage:
  ./skills/opendevbrowser-design-agent/scripts/design-workflow.sh <workflow>

Workflows:
  contract-first
  research-harvest
  screenshot-audit
  canvas-contract
  real-surface-validation
  performance-audit
  release-gate
  ship-audit
  list
EOF
}

workflow="${1:-list}"

case "$workflow" in
  list)
    print_help
    ;;
  contract-first)
    cat <<'EOF'
cat skills/opendevbrowser-design-agent/assets/templates/design-brief.v1.md
cat skills/opendevbrowser-design-agent/assets/templates/design-contract.v1.json
cat skills/opendevbrowser-design-agent/artifacts/design-contract-playbook.md
cat skills/opendevbrowser-design-agent/artifacts/opendevbrowser-ui-example-map.md
cat skills/opendevbrowser-design-agent/artifacts/existing-surface-adaptation.md
cat skills/opendevbrowser-design-agent/artifacts/component-pattern-index.md
cat skills/opendevbrowser-design-agent/artifacts/app-shell-and-state-wiring.md
cat skills/opendevbrowser-design-agent/artifacts/state-ownership-matrix.md
cat skills/opendevbrowser-design-agent/artifacts/async-search-state-ownership.md
cat skills/opendevbrowser-design-agent/artifacts/scroll-reveal-surface-planning.md
cat skills/opendevbrowser-design-agent/artifacts/theming-and-token-ownership.md
cat skills/opendevbrowser-design-agent/artifacts/loading-and-feedback-surfaces.md
cat skills/opendevbrowser-design-agent/artifacts/frontend-evaluation-rubric.md
# Fill the brief first, then turn it into the design contract before implementation.
EOF
    ;;
  research-harvest)
    cat <<EOF
cat skills/opendevbrowser-design-agent/artifacts/research-harvest-workflow.md
cat skills/opendevbrowser-design-agent/assets/templates/reference-pattern-board.v1.json
cat skills/opendevbrowser-design-agent/artifacts/external-pattern-synthesis.md
cat skills/opendevbrowser-design-agent/artifacts/component-pattern-index.md
cat skills/opendevbrowser-design-agent/artifacts/existing-surface-adaptation.md
$CLI_PREFIX launch --no-extension --start-url https://example.com
$CLI_PREFIX goto --session-id <session-id> --url <reference-url>
$CLI_PREFIX snapshot --session-id <session-id>
$CLI_PREFIX screenshot --session-id <session-id>
$CLI_PREFIX debug-trace-snapshot --session-id <session-id>
# Repeat for 3-5 live references, then turn the synthesis into contract deltas before implementation.
EOF
    ;;
  screenshot-audit)
    cat <<'EOF'
cat skills/opendevbrowser-design-agent/artifacts/design-workflows.md
cat skills/opendevbrowser-design-agent/artifacts/component-pattern-index.md
cat skills/opendevbrowser-design-agent/artifacts/opendevbrowser-ui-example-map.md
cat skills/opendevbrowser-design-agent/artifacts/existing-surface-adaptation.md
cat skills/opendevbrowser-design-agent/artifacts/async-search-state-ownership.md
cat skills/opendevbrowser-design-agent/artifacts/scroll-reveal-surface-planning.md
cat skills/opendevbrowser-design-agent/artifacts/theming-and-token-ownership.md
cat skills/opendevbrowser-design-agent/artifacts/loading-and-feedback-surfaces.md
cat skills/opendevbrowser-design-agent/artifacts/implementation-anti-patterns.md
cat skills/opendevbrowser-design-agent/artifacts/frontend-evaluation-rubric.md
cat skills/opendevbrowser-design-agent/assets/templates/design-audit-report.v1.md
cat skills/opendevbrowser-design-agent/assets/templates/design-review-checklist.json
# Decompose the screenshot into hierarchy, grid, spacing, type, states, and accessibility before coding.
EOF
    ;;
  canvas-contract)
    cat <<EOF
cat skills/opendevbrowser-design-agent/assets/templates/design-contract.v1.json
cat skills/opendevbrowser-design-agent/assets/templates/canvas-generation-plan.design.v1.json
cat skills/opendevbrowser-design-agent/artifacts/design-contract-playbook.md
cat skills/opendevbrowser-best-practices/artifacts/canvas-governance-playbook.md
cat skills/opendevbrowser-best-practices/assets/templates/canvas-handshake-example.json
./skills/opendevbrowser-design-agent/scripts/extract-canvas-plan.sh ./tmp/design-contract.json > ./tmp/canvas-plan.json
$CLI_PREFIX canvas --command canvas.session.open --params '{"requestId":"req_open_01","browserSessionId":"<browser-session-id>","documentId":null,"repoPath":null,"mode":"dual-track"}'
# Require preflightState=handshake_read and inspect guidance.recommendedNextCommands before continuing.
$CLI_PREFIX canvas --command canvas.plan.set --params-file ./tmp/canvas-plan.json
$CLI_PREFIX canvas --command canvas.plan.get --params '{"requestId":"req_plan_get_01","canvasSessionId":"<canvas-session-id>","leaseId":"<lease-id>","documentId":"<document-id>"}'
# Require planStatus=accepted or preflightState=plan_accepted before patching.
$CLI_PREFIX canvas --command canvas.document.patch --params-file ./tmp/canvas-patch.json
$CLI_PREFIX canvas --command canvas.preview.render --params '{"requestId":"req_preview_01","canvasSessionId":"<canvas-session-id>","leaseId":"<lease-id>","targetId":"<target-id>","prototypeId":"<prototype-id>"}'
$CLI_PREFIX canvas --command canvas.feedback.poll --params '{"requestId":"req_feedback_01","canvasSessionId":"<canvas-session-id>","documentId":"<document-id>","targetId":"<target-id>","afterCursor":null}'
$CLI_PREFIX canvas --command canvas.document.save --params '{"requestId":"req_save_01","canvasSessionId":"<canvas-session-id>","leaseId":"<lease-id>","documentId":"<document-id>","repoPath":null}'
EOF
    ;;
  real-surface-validation)
    cat <<EOF
cat skills/opendevbrowser-design-agent/assets/templates/real-surface-design-matrix.json
cat skills/opendevbrowser-design-agent/assets/templates/design-review-checklist.json
cat skills/opendevbrowser-design-agent/artifacts/isolated-preview-validation.md
cat skills/opendevbrowser-design-agent/artifacts/scroll-reveal-surface-planning.md
cat skills/opendevbrowser-design-agent/artifacts/loading-and-feedback-surfaces.md
cat skills/opendevbrowser-design-agent/artifacts/theming-and-token-ownership.md
$CLI_PREFIX launch --no-extension --start-url https://example.com
$CLI_PREFIX snapshot --session-id <session-id>
$CLI_PREFIX screenshot --session-id <session-id>
$CLI_PREFIX debug-trace-snapshot --session-id <session-id>
# Repeat on extension and cdpConnect when parity is part of the acceptance criteria.
EOF
    ;;
  performance-audit)
    cat <<EOF
cat skills/opendevbrowser-design-agent/artifacts/performance-audit-playbook.md
cat skills/opendevbrowser-design-agent/artifacts/scroll-reveal-surface-planning.md
cat skills/opendevbrowser-design-agent/artifacts/implementation-anti-patterns.md
cat skills/opendevbrowser-design-agent/assets/templates/design-audit-report.v1.md
$CLI_PREFIX launch --no-extension --start-url http://127.0.0.1:3000
$CLI_PREFIX debug-trace-snapshot --session-id <session-id>
$CLI_PREFIX screenshot --session-id <session-id>
# Pair the browser evidence with React DevTools Profiler or the framework profiler before changing structure.
EOF
    ;;
  release-gate)
    cat <<'EOF'
./skills/opendevbrowser-design-agent/scripts/validate-skill-assets.sh
cat skills/opendevbrowser-design-agent/artifacts/design-release-gate.md
cat skills/opendevbrowser-design-agent/assets/templates/design-release-gate.v1.json
cat skills/opendevbrowser-design-agent/assets/templates/design-review-checklist.json
cat skills/opendevbrowser-design-agent/assets/templates/real-surface-design-matrix.json
cat skills/opendevbrowser-design-agent/assets/templates/reference-pattern-board.v1.json
# Re-run the required browser matrix and mark every blocking check pass/fail with evidence before shipping.
EOF
    ;;
  ship-audit)
    cat <<'EOF'
./skills/opendevbrowser-design-agent/scripts/validate-skill-assets.sh
./skills/opendevbrowser-best-practices/scripts/validate-skill-assets.sh
cat skills/opendevbrowser-design-agent/artifacts/frontend-evaluation-rubric.md
cat skills/opendevbrowser-design-agent/artifacts/existing-surface-adaptation.md
cat skills/opendevbrowser-design-agent/artifacts/app-shell-and-state-wiring.md
cat skills/opendevbrowser-design-agent/artifacts/state-ownership-matrix.md
cat skills/opendevbrowser-design-agent/artifacts/async-search-state-ownership.md
cat skills/opendevbrowser-design-agent/artifacts/scroll-reveal-surface-planning.md
cat skills/opendevbrowser-design-agent/artifacts/theming-and-token-ownership.md
cat skills/opendevbrowser-design-agent/artifacts/loading-and-feedback-surfaces.md
cat skills/opendevbrowser-design-agent/artifacts/research-harvest-workflow.md
cat skills/opendevbrowser-design-agent/artifacts/design-release-gate.md
cat skills/opendevbrowser-design-agent/artifacts/implementation-anti-patterns.md
cat skills/opendevbrowser-design-agent/assets/templates/design-audit-report.v1.md
cat skills/opendevbrowser-design-agent/assets/templates/design-review-checklist.json
cat skills/opendevbrowser-design-agent/assets/templates/reference-pattern-board.v1.json
cat skills/opendevbrowser-design-agent/assets/templates/design-release-gate.v1.json
# Re-read the design contract, compare it to the shipped UI, then update docs/AGENTS/skills references in the same pass.
EOF
    ;;
  *)
    echo "Unknown workflow: $workflow" >&2
    print_help
    exit 2
    ;;
esac
