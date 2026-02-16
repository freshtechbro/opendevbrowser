#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${REPO_ROOT}"

if [[ $# -gt 0 ]]; then
  npx opendevbrowser artifacts cleanup --expired-only --output-dir "$1"
else
  npx opendevbrowser artifacts cleanup --expired-only
fi
