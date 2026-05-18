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
OpenDevBrowser motion-design workflow router

Usage:
  ./skills/opendevbrowser-motion-design/scripts/motion-workflow.sh <workflow>

Workflows:
  contract-first
  pattern-select
  viewport-matrix
  reduced-motion-check
  temporal-proof
  scroll-stage-audit
  gesture-motion
  performance-audit
  release-gate
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
cat skills/opendevbrowser-motion-design/assets/templates/motion-contract.v1.json
cat skills/opendevbrowser-motion-design/artifacts/motion-terminology.md
cat skills/opendevbrowser-motion-design/artifacts/platform-framework-guide.md
cat skills/opendevbrowser-design-agent/assets/templates/design-contract.v1.json
# Fill the motion contract before implementation and connect it to design-agent motionSystem.
EOF
    ;;
  pattern-select)
    cat <<'EOF'
cat skills/opendevbrowser-motion-design/artifacts/motion-pattern-catalog.md
cat skills/opendevbrowser-motion-design/artifacts/motion-anti-patterns.md
cat skills/opendevbrowser-motion-design/assets/templates/motion-contract.v1.json
# Select only patterns with user value, fallback, device posture, and evidence.
EOF
    ;;
  viewport-matrix)
    cat <<EOF
cat skills/opendevbrowser-motion-design/assets/templates/motion-viewport-matrix.v1.json
cat skills/opendevbrowser-motion-design/artifacts/device-breakpoint-posture.md
$CLI_PREFIX launch --no-extension --start-url <url> --output-format json
$CLI_PREFIX screenshot --session-id <session-id>
$CLI_PREFIX snapshot --session-id <session-id>
# Repeat for phone, tablet, desktop, short viewport, reduced motion, coarse pointer, and keyboard-only posture.
EOF
    ;;
  reduced-motion-check)
    cat <<EOF
cat skills/opendevbrowser-motion-design/artifacts/accessibility-reduced-motion.md
cat skills/opendevbrowser-motion-design/assets/templates/motion-audit-report.v1.md
$CLI_PREFIX launch --no-extension --start-url <url> --output-format json
$CLI_PREFIX snapshot --session-id <session-id>
$CLI_PREFIX screenshot --session-id <session-id>
$CLI_PREFIX debug-trace-snapshot --session-id <session-id>
# Emulate or configure prefers-reduced-motion, then prove meaning and task completion are preserved.
EOF
    ;;
  temporal-proof)
    cat <<EOF
cat skills/opendevbrowser-motion-design/artifacts/open-dev-browser-motion-evidence.md
$CLI_PREFIX launch --no-extension --start-url <url> --output-format json
$CLI_PREFIX snapshot --session-id <session-id>
$CLI_PREFIX screenshot --session-id <session-id>
$CLI_PREFIX debug-trace-snapshot --session-id <session-id>
$CLI_PREFIX screencast-start --session-id <session-id> --output-dir <artifact-dir>
# Perform the motion interaction: click, pointer-drag, scroll, keyboard, or route transition.
$CLI_PREFIX screencast-stop --session-id <session-id> --screencast-id <screencast-id>
$CLI_PREFIX snapshot --session-id <session-id>
$CLI_PREFIX screenshot --session-id <session-id>
$CLI_PREFIX debug-trace-snapshot --session-id <session-id>
EOF
    ;;
  scroll-stage-audit)
    cat <<EOF
cat skills/opendevbrowser-motion-design/artifacts/motion-pattern-catalog.md
cat skills/opendevbrowser-design-agent/artifacts/scroll-reveal-surface-planning.md
cat skills/opendevbrowser-motion-design/artifacts/device-breakpoint-posture.md
$CLI_PREFIX launch --no-extension --start-url <url> --output-format json
$CLI_PREFIX screencast-start --session-id <session-id> --output-dir <artifact-dir>
$CLI_PREFIX scroll --session-id <session-id> --dy 900
$CLI_PREFIX screencast-stop --session-id <session-id> --screencast-id <screencast-id>
$CLI_PREFIX debug-trace-snapshot --session-id <session-id>
EOF
    ;;
  gesture-motion)
    cat <<EOF
cat skills/opendevbrowser-motion-design/artifacts/motion-pattern-catalog.md
cat skills/opendevbrowser-motion-design/artifacts/device-breakpoint-posture.md
$CLI_PREFIX launch --no-extension --start-url <url> --output-format json
$CLI_PREFIX pointer-move --session-id <session-id> --x <x> --y <y>
$CLI_PREFIX pointer-down --session-id <session-id>
$CLI_PREFIX pointer-drag --session-id <session-id> --to-x <x2> --to-y <y2>
$CLI_PREFIX pointer-up --session-id <session-id>
$CLI_PREFIX snapshot --session-id <session-id>
EOF
    ;;
  performance-audit)
    cat <<EOF
cat skills/opendevbrowser-motion-design/artifacts/performance-frame-budget.md
cat skills/opendevbrowser-motion-design/assets/templates/motion-audit-report.v1.md
$CLI_PREFIX launch --no-extension --start-url <url> --output-format json
$CLI_PREFIX debug-trace-snapshot --session-id <session-id>
$CLI_PREFIX screenshot --session-id <session-id>
# Pair browser proof with framework profiler or performance trace for complex motion.
EOF
    ;;
  release-gate)
    cat <<'EOF'
./skills/opendevbrowser-motion-design/scripts/validate-skill-assets.sh
cat skills/opendevbrowser-motion-design/artifacts/motion-release-gate.md
cat skills/opendevbrowser-motion-design/assets/templates/motion-release-gate.v1.json
cat skills/opendevbrowser-motion-design/assets/templates/motion-audit-report.v1.md
# Mark every blocking check pass/fail with evidence. Missing temporal proof blocks release.
EOF
    ;;
  *)
    echo "Unknown workflow: $workflow" >&2
    print_help
    exit 2
    ;;
esac
