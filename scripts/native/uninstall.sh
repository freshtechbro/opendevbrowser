#!/usr/bin/env bash
set -euo pipefail

OS="$(uname -s)"
if [[ "${OS}" == "Darwin" ]]; then
  MANIFEST_DIR="${HOME}/Library/Application Support/Google/Chrome/NativeMessagingHosts"
elif [[ "${OS}" == "Linux" ]]; then
  MANIFEST_DIR="${HOME}/.config/google-chrome/NativeMessagingHosts"
else
  echo "Unsupported platform: ${OS}" >&2
  exit 3
fi

MANIFEST_PATH="${MANIFEST_DIR}/com.opendevbrowser.native.json"
WRAPPER_PATH="${MANIFEST_DIR}/com.opendevbrowser.native.sh"

if [[ -f "${MANIFEST_PATH}" ]]; then
  rm -f "${MANIFEST_PATH}"
fi
if [[ -f "${WRAPPER_PATH}" ]]; then
  rm -f "${WRAPPER_PATH}"
fi

rm -f /tmp/opendevbrowser-*.sock /tmp/opendevbrowser-*.token 2>/dev/null || true

echo "Native host uninstalled."
