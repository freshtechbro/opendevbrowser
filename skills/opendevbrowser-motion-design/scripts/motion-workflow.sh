#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
skill_root="$(cd "$script_dir/.." && pwd)"
skills_root="$(cd "$skill_root/.." && pwd)"
best_practices_root="$skills_root/opendevbrowser-best-practices"
design_agent_root="$skills_root/opendevbrowser-design-agent"
# shellcheck source=../../opendevbrowser-best-practices/scripts/resolve-odb-cli.sh
source "$best_practices_root/scripts/resolve-odb-cli.sh"

render_cli_prefix() {
  local rendered=()
  local part
  for part in "${ODB_CLI[@]}"; do
    rendered+=("$(printf '%q' "$part")")
  done
  printf '%s' "${rendered[*]}"
}

CLI_PREFIX="$(render_cli_prefix)"

quote_path() {
  printf '%q' "$1"
}

print_cat() {
  printf 'cat %s\n' "$(quote_path "$1")"
}

print_validator() {
  printf '%s\n' "$(quote_path "$skill_root/scripts/validate-skill-assets.sh")"
}

print_help() {
  cat <<EOF
OpenDevBrowser motion-design workflow router

Usage:
  $(quote_path "$script_dir/motion-workflow.sh") <workflow>

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
    print_cat "$skill_root/assets/templates/motion-contract.v1.json"
    print_cat "$skill_root/artifacts/motion-terminology.md"
    print_cat "$skill_root/artifacts/platform-framework-guide.md"
    print_cat "$design_agent_root/assets/templates/design-contract.v1.json"
    cat <<'EOF'
# Fill the motion contract before implementation and connect it to design-agent motionSystem.
EOF
    ;;
  pattern-select)
    print_cat "$skill_root/artifacts/motion-pattern-catalog.md"
    print_cat "$skill_root/artifacts/motion-anti-patterns.md"
    print_cat "$skill_root/assets/templates/motion-contract.v1.json"
    cat <<'EOF'
# Select only patterns with user value, fallback, device posture, and evidence.
EOF
    ;;
  viewport-matrix)
    print_cat "$skill_root/assets/templates/motion-viewport-matrix.v1.json"
    print_cat "$skill_root/artifacts/device-breakpoint-posture.md"
    cat <<EOF
$CLI_PREFIX launch --no-extension --start-url <url> --output-format json
$CLI_PREFIX screenshot --session-id <session-id>
$CLI_PREFIX snapshot --session-id <session-id>
# Repeat for phone, tablet, desktop, short viewport, reduced motion, coarse pointer, and keyboard-only posture.
EOF
    ;;
  reduced-motion-check)
    print_cat "$skill_root/artifacts/accessibility-reduced-motion.md"
    print_cat "$skill_root/assets/templates/motion-audit-report.v1.md"
    cat <<EOF
$CLI_PREFIX launch --no-extension --start-url <url> --output-format json
$CLI_PREFIX snapshot --session-id <session-id>
$CLI_PREFIX screenshot --session-id <session-id>
$CLI_PREFIX debug-trace-snapshot --session-id <session-id>
# Emulate or configure prefers-reduced-motion, then prove meaning and task completion are preserved.
EOF
    ;;
  temporal-proof)
    print_cat "$skill_root/artifacts/open-dev-browser-motion-evidence.md"
    cat <<EOF
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
    print_cat "$skill_root/artifacts/motion-pattern-catalog.md"
    print_cat "$design_agent_root/artifacts/scroll-reveal-surface-planning.md"
    print_cat "$skill_root/artifacts/device-breakpoint-posture.md"
    cat <<EOF
$CLI_PREFIX launch --no-extension --start-url <url> --output-format json
$CLI_PREFIX screencast-start --session-id <session-id> --output-dir <artifact-dir>
$CLI_PREFIX scroll --session-id <session-id> --dy 900
$CLI_PREFIX screencast-stop --session-id <session-id> --screencast-id <screencast-id>
$CLI_PREFIX debug-trace-snapshot --session-id <session-id>
EOF
    ;;
  gesture-motion)
    print_cat "$skill_root/artifacts/motion-pattern-catalog.md"
    print_cat "$skill_root/artifacts/device-breakpoint-posture.md"
    cat <<EOF
$CLI_PREFIX launch --no-extension --start-url <url> --output-format json
$CLI_PREFIX pointer-move --session-id <session-id> --x <x> --y <y>
$CLI_PREFIX pointer-down --session-id <session-id>
$CLI_PREFIX pointer-drag --session-id <session-id> --to-x <x2> --to-y <y2>
$CLI_PREFIX pointer-up --session-id <session-id>
$CLI_PREFIX snapshot --session-id <session-id>
EOF
    ;;
  performance-audit)
    print_cat "$skill_root/artifacts/performance-frame-budget.md"
    print_cat "$skill_root/assets/templates/motion-audit-report.v1.md"
    cat <<EOF
$CLI_PREFIX launch --no-extension --start-url <url> --output-format json
$CLI_PREFIX debug-trace-snapshot --session-id <session-id>
$CLI_PREFIX screenshot --session-id <session-id>
# Pair browser proof with framework profiler or performance trace for complex motion.
EOF
    ;;
  release-gate)
    print_validator
    print_cat "$skill_root/artifacts/motion-release-gate.md"
    print_cat "$skill_root/assets/templates/motion-release-gate.v1.json"
    print_cat "$skill_root/assets/templates/motion-audit-report.v1.md"
    cat <<'EOF'
# Mark every blocking check pass/fail with evidence. Missing temporal proof blocks release.
EOF
    ;;
  *)
    echo "Unknown workflow: $workflow" >&2
    print_help
    exit 2
    ;;
esac
