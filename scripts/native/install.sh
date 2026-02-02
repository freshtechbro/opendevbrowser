#!/usr/bin/env bash
set -euo pipefail

EXTENSION_ID="${1:-}"
if [[ -z "${EXTENSION_ID}" ]]; then
  echo "Usage: install.sh <extension-id>" >&2
  exit 2
fi

if [[ ! "${EXTENSION_ID}" =~ ^[a-p]{32}$ ]]; then
  echo "Invalid extension ID format. Expected 32 characters (a-p)." >&2
  exit 2
fi

OS="$(uname -s)"
if [[ "${OS}" == "Darwin" ]]; then
  MANIFEST_DIR="${HOME}/Library/Application Support/Google/Chrome/NativeMessagingHosts"
elif [[ "${OS}" == "Linux" ]]; then
  MANIFEST_DIR="${HOME}/.config/google-chrome/NativeMessagingHosts"
else
  echo "Unsupported platform: ${OS}" >&2
  exit 3
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOST_SCRIPT="${SCRIPT_DIR}/host.cjs"
if [[ ! -f "${HOST_SCRIPT}" ]]; then
  echo "Native host script not found at ${HOST_SCRIPT}" >&2
  exit 4
fi

NODE_PATH="$(command -v node || true)"
if [[ -z "${NODE_PATH}" && "${OS}" == "Darwin" ]]; then
  if [[ -x "/opt/homebrew/bin/node" ]]; then
    NODE_PATH="/opt/homebrew/bin/node"
  elif [[ -x "/usr/local/bin/node" ]]; then
    NODE_PATH="/usr/local/bin/node"
  fi
fi
if [[ -z "${NODE_PATH}" ]]; then
  echo "Node.js not found in PATH." >&2
  exit 4
fi

mkdir -p "${MANIFEST_DIR}"

WRAPPER_PATH="${MANIFEST_DIR}/com.opendevbrowser.native.sh"
cat > "${WRAPPER_PATH}" <<EOF
#!/usr/bin/env bash
exec "${NODE_PATH}" "${HOST_SCRIPT}"
EOF
chmod 0755 "${WRAPPER_PATH}"

MANIFEST_PATH="${MANIFEST_DIR}/com.opendevbrowser.native.json"
cat > "${MANIFEST_PATH}" <<EOF
{
  "name": "com.opendevbrowser.native",
  "description": "OpenDevBrowser native messaging host",
  "path": "${WRAPPER_PATH}",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://${EXTENSION_ID}/"]
}
EOF
chmod 0644 "${MANIFEST_PATH}"

echo "Native host installed at ${MANIFEST_PATH}"
