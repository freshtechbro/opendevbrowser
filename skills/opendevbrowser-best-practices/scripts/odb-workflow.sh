#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./resolve-odb-cli.sh
source "$script_dir/resolve-odb-cli.sh"

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
OpenDevBrowser workflow router

Usage:
  ./skills/opendevbrowser-best-practices/scripts/odb-workflow.sh <workflow>

Workflows:
  provider-search
  provider-crawl
  parallel-multipage-safe
  qa-debug
  social-readonly-check
  canvas-preflight
  canvas-feedback-eval
  parity-check
  release-direct-gates
  skill-runtime-audit
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
  canvas-preflight)
    cat <<EOF
cat skills/opendevbrowser-best-practices/assets/templates/canvas-handshake-example.json
cat skills/opendevbrowser-best-practices/assets/templates/canvas-generation-plan.v1.json
$CLI_PREFIX canvas --command canvas.session.open --params '{"requestId":"req_open_01","browserSessionId":"<browser-session-id>","documentId":null,"repoPath":null,"mode":"dual-track"}'
# Read handshake before any mutation. Require preflightState=handshake_read.
$CLI_PREFIX canvas --command canvas.plan.set --params-file skills/opendevbrowser-best-practices/assets/templates/canvas-generation-plan.v1.json
# Replace placeholders in the plan file with canvasSessionId, leaseId, and documentId from the open response.
$CLI_PREFIX canvas --command canvas.plan.get --params '{"requestId":"req_plan_get_01","canvasSessionId":"<canvas-session-id>","leaseId":"<lease-id>","documentId":"<document-id>"}'
# Require planStatus=accepted or preflightState=plan_accepted before canvas.document.patch.
EOF
    ;;
  canvas-feedback-eval)
    cat <<EOF
cat skills/opendevbrowser-best-practices/artifacts/canvas-governance-playbook.md
cat skills/opendevbrowser-best-practices/assets/templates/canvas-feedback-eval.json
cat skills/opendevbrowser-best-practices/assets/templates/canvas-blocker-checklist.json
$CLI_PREFIX canvas --command canvas.feedback.poll --params '{"requestId":"req_feedback_01","canvasSessionId":"<canvas-session-id>","documentId":"<document-id>","targetId":"<target-id>","afterCursor":null}'
# Verify every feedback item is target-attributed and uses approved categories.
$CLI_PREFIX canvas --command canvas.preview.refresh --params '{"requestId":"req_refresh_01","canvasSessionId":"<canvas-session-id>","leaseId":"<lease-id>","targetId":"<target-id>","refreshMode":"full"}'
$CLI_PREFIX canvas --command canvas.document.save --params '{"requestId":"req_save_01","canvasSessionId":"<canvas-session-id>","leaseId":"<lease-id>","documentId":"<document-id>","repoPath":null}'
# Save should fail or warn when requiredBeforeSave governance blocks remain unresolved.
EOF
    ;;
  parity-check)
    cat <<'EOF'
npm run test -- tests/parity-matrix.test.ts
npm run test -- tests/tools.test.ts tests/daemon-commands.integration.test.ts
./skills/opendevbrowser-best-practices/scripts/validate-skill-assets.sh
EOF
    ;;
  release-direct-gates)
    cat <<'EOF'
mkdir -p artifacts/release/vX.Y.Z
node scripts/provider-direct-runs.mjs --release-gate --out artifacts/release/vX.Y.Z/provider-direct-runs.json
node scripts/live-regression-direct.mjs --release-gate --out artifacts/release/vX.Y.Z/live-regression-direct.json
EOF
    ;;
  skill-runtime-audit)
    cat <<'EOF'
npm run build
node scripts/docs-drift-check.mjs
npm run test -- tests/skill-loader.test.ts tests/skill-list-tool.test.ts tests/cli-skills-installer.test.ts
npm run test -- tests/cli-help.test.ts tests/cli-help-parity.test.ts tests/skill-runtime-audit.test.ts tests/skill-workflow-packs.test.ts
npx opendevbrowser --help
npx opendevbrowser help
./skills/opendevbrowser-best-practices/scripts/validate-skill-assets.sh
./skills/opendevbrowser-best-practices/scripts/run-robustness-audit.sh
./skills/opendevbrowser-continuity-ledger/scripts/validate-skill-assets.sh
./skills/opendevbrowser-data-extraction/scripts/validate-skill-assets.sh
./skills/opendevbrowser-design-agent/scripts/validate-skill-assets.sh
./skills/opendevbrowser-form-testing/scripts/validate-skill-assets.sh
./skills/opendevbrowser-login-automation/scripts/validate-skill-assets.sh
./skills/opendevbrowser-product-presentation-asset/scripts/validate-skill-assets.sh
./skills/opendevbrowser-research/scripts/validate-skill-assets.sh
./skills/opendevbrowser-shopping/scripts/validate-skill-assets.sh
node scripts/skill-runtime-audit.mjs --smoke --out artifacts/skill-runtime-audit/smoke.json
node scripts/skill-runtime-audit.mjs --out artifacts/skill-runtime-audit/full.json
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
    cat <<EOF
$CLI_PREFIX serve
$CLI_PREFIX launch --extension-only --wait-for-extension --output-format json
$CLI_PREFIX status --daemon --output-format json
# Verify opsConnected=true and extensionHandshakeComplete=true
cat skills/opendevbrowser-best-practices/assets/templates/ops-request-envelope.json
EOF
    ;;
  cdp-channel-check)
    cat <<EOF
$CLI_PREFIX serve
$CLI_PREFIX launch --extension-only --extension-legacy --wait-for-extension --output-format json
$CLI_PREFIX status --daemon --output-format json
# Verify cdpConnected=true while legacy session is active
cat skills/opendevbrowser-best-practices/assets/templates/cdp-forward-envelope.json
EOF
    ;;
  mode-flag-matrix)
    cat <<EOF
cat skills/opendevbrowser-best-practices/assets/templates/mode-flag-matrix.json
$CLI_PREFIX launch --no-extension --output-format json
$CLI_PREFIX launch --extension-only --wait-for-extension --output-format json
$CLI_PREFIX launch --extension-only --extension-legacy --wait-for-extension --output-format json
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
