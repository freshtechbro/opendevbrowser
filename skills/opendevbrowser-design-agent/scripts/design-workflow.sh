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
# Daemon preflight for extension-mode Pinterest harvest:
$CLI_PREFIX status --daemon --output-format json
# Continue only when data.fingerprintCurrent === true, data.relay.extensionConnected === true, and data.relay.extensionHandshakeComplete === true.
$CLI_PREFIX inspiredesign harvest --brief "Premium digital photography studio landing page" --query "Pinterest premium digital photography studio landing page cinematic parallax portfolio" --provider social/pinterest --max-references 5 --visual-evidence required --browser-mode extension --use-cookies --cookie-policy required --challenge-automation-mode browser_with_helper --mode json --output-format json
# Inspect top-level ready, productSuccess, artifactAuthority, evidenceAuthority, ranked references, and nextStepGuidance.doNotProceedIf first.
# Continue canonical Pinterest harvests only when ready=true, productSuccess=true, artifactAuthority=product_ready, evidenceAuthority=pin_media_ready, ranked references are non-empty, and pin-media-index.json is manifest-backed.
$CLI_PREFIX launch --no-extension --start-url https://example.com
$CLI_PREFIX goto --session-id <session-id> --url <reference-url>
$CLI_PREFIX snapshot --session-id <session-id>
$CLI_PREFIX screenshot --session-id <session-id>
$CLI_PREFIX debug-trace-snapshot --session-id <session-id>
# Repeat for 3-5 live references, then turn ready synthesis into contract deltas before implementation.
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
cat skills/opendevbrowser-design-agent/assets/templates/canvas-patch.request.v1.json
cat skills/opendevbrowser-design-agent/artifacts/design-contract-playbook.md
cat skills/opendevbrowser-design-agent/artifacts/design-agent-work-products.md
cat skills/opendevbrowser-design-agent/artifacts/design-workflows.md
cat skills/opendevbrowser-best-practices/artifacts/canvas-governance-playbook.md
cat skills/opendevbrowser-best-practices/assets/templates/canvas-handshake-example.json
mkdir -p .tmp
RUN_ID="\${RUN_ID:-design-\$(date -u +%Y%m%dT%H%M%SZ)}"
DESIGN_RUN_DIR=".opendevbrowser/design-agent/\$RUN_ID"
mkdir -p "\$DESIGN_RUN_DIR"
cp skills/opendevbrowser-design-agent/assets/templates/design-contract.v1.json "\$DESIGN_RUN_DIR/design-contract.json"
# Fill "\$DESIGN_RUN_DIR/design-contract.json" before opening the session and extraction. Keep this as the durable source contract.
$CLI_PREFIX canvas --command canvas.session.open --params '{"requestId":"req_open_01","browserSessionId":"<browser-session-id>","documentId":null,"repoPath":null,"mode":"dual-track"}' --output-format json | tee .tmp/canvas-session.open.json
# Inspect planStatus, preflightState, generationPlanRequirements.allowedValues, generationPlanIssues, guidance.recommendedNextCommands, guidance.nextStepGuidance, guidance.paramsExamples, guidance.fieldExamples, guidance.validationChecks, and guidance.doNotProceedIf before continuing.
./skills/opendevbrowser-design-agent/scripts/extract-canvas-plan.sh "\$DESIGN_RUN_DIR/design-contract.json" .tmp/canvas-session.open.json > .tmp/canvas-plan.request.json
# Treat preflightState=handshake_read as the normal first-step checkpoint before canvas.plan.set.
$CLI_PREFIX canvas --command canvas.plan.set --params-file .tmp/canvas-plan.request.json --output-format json | tee .tmp/canvas-plan.set.json
# If canvas.plan.set returns generation_plan_invalid or plan_invalid, repair .tmp/canvas-plan.request.json from guidance.paramsExamples and generationPlanIssues before retrying.
# If canvas.plan.set succeeds with planStatus=accepted or preflightState=plan_accepted, copy the accepted request to the durable run directory.
# Optional diagnostics after generation_plan_invalid:
# $CLI_PREFIX canvas --command canvas.plan.get --params '{"requestId":"req_plan_get_01","canvasSessionId":"<canvas-session-id>","leaseId":"<lease-id>","documentId":"<document-id>"}' --output-format json
cp .tmp/canvas-plan.request.json "\$DESIGN_RUN_DIR/canvas-plan.request.json"
cp skills/opendevbrowser-design-agent/assets/templates/canvas-patch.request.v1.json .tmp/canvas-patch.request.json
# Fill .tmp/canvas-patch.request.json with accepted canvasSessionId, leaseId, latest numeric baseRevision, page IDs, node IDs, and token placeholders.
# Optional advisory starter path. Use only when the starter satisfies the design contract.
$CLI_PREFIX canvas --command canvas.starter.list --params '{"requestId":"req_starter_list_01","canvasSessionId":"<canvas-session-id>","leaseId":"<lease-id>"}' --output-format json
# $CLI_PREFIX canvas --command canvas.starter.apply --params '{"requestId":"req_starter_apply_01","canvasSessionId":"<canvas-session-id>","leaseId":"<lease-id>","starterId":"<starter-id>","documentId":"<document-id>"}' --output-format json
# Optional advisory inventory path. Use after plan acceptance when a reusable item fits the page, parent, and placement.
$CLI_PREFIX canvas --command canvas.inventory.list --params '{"requestId":"req_inventory_list_01","canvasSessionId":"<canvas-session-id>","leaseId":"<lease-id>","documentId":"<document-id>"}' --output-format json
# $CLI_PREFIX canvas --command canvas.inventory.insert --params '{"requestId":"req_inventory_insert_01","canvasSessionId":"<canvas-session-id>","leaseId":"<lease-id>","documentId":"<document-id>","itemId":"<inventory-item-id>","pageId":"<page-id>","parentId":"<parent-node-id>","placement":"append","baseRevision":0}' --output-format json
$CLI_PREFIX canvas --command canvas.document.patch --params-file .tmp/canvas-patch.request.json --output-format json | tee .tmp/canvas-document.patch.json
cp .tmp/canvas-patch.request.json "\$DESIGN_RUN_DIR/canvas-patch.request.json"
$CLI_PREFIX canvas --command canvas.preview.render --params '{"requestId":"req_preview_01","canvasSessionId":"<canvas-session-id>","leaseId":"<lease-id>","targetId":"<target-id>","prototypeId":"<prototype-id>"}' --output-format json | tee .tmp/canvas-preview.render.json
$CLI_PREFIX canvas --command canvas.feedback.poll --params '{"requestId":"req_feedback_01","canvasSessionId":"<canvas-session-id>","documentId":"<document-id>","targetId":"<target-id>","afterCursor":null}' --output-format json | tee .tmp/canvas-feedback.poll.json
# Patch all requiredBeforeSave governance blocks before save; the minimal patch template only proves mutation shape.
$CLI_PREFIX canvas --command canvas.document.save --params '{"requestId":"req_save_01","canvasSessionId":"<canvas-session-id>","leaseId":"<lease-id>","documentId":"<document-id>","repoPath":null}' --output-format json | tee .tmp/canvas-document.save.json
# Confirm save output path is under .opendevbrowser/canvas/...; do not substitute the design-agent run directory for Canvas persistence.
$CLI_PREFIX canvas --command canvas.document.export --params '{"requestId":"req_export_01","canvasSessionId":"<canvas-session-id>","leaseId":"<lease-id>","documentId":"<document-id>","exportTarget":"html_bundle"}' --output-format json | tee .tmp/canvas-document.export.json
# Record preview, feedback, save, and export outcomes in "\$DESIGN_RUN_DIR/canvas-workflow-log.md", validation-evidence.md, and design-agent-handoff.json.
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
