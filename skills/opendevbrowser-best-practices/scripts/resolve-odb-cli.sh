#!/usr/bin/env bash
set -euo pipefail

set_odb_cli_from_entry() {
  local cli_entry="$1"
  if [[ ! -f "$cli_entry" ]]; then
    return 1
  fi
  if ! command -v node >/dev/null 2>&1; then
    echo "node is required to run $cli_entry" >&2
    return 1
  fi
  ODB_CLI=(node "$cli_entry")
  return 0
}

find_odb_cli_from_pwd() {
  local current pkg_path cli_entry pkg_name
  if ! command -v node >/dev/null 2>&1; then
    return 1
  fi
  current="$(pwd -P)"

  while true; do
    pkg_path="$current/package.json"
    cli_entry="$current/dist/cli/index.js"
    if [[ -f "$pkg_path" ]]; then
      pkg_name="$(node -e 'const fs=require("fs"); try { const pkg=JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.stdout.write(typeof pkg.name === "string" ? pkg.name : ""); } catch {}' "$pkg_path")"
      if [[ "$pkg_name" == "opendevbrowser" ]] && set_odb_cli_from_entry "$cli_entry"; then
        return 0
      fi
    fi
    if [[ "$current" == "/" ]]; then
      break
    fi
    current="$(dirname "$current")"
  done

  return 1
}

find_odb_cli_from_node_resolution() {
  local pkg_path pkg_root cli_entry
  if ! command -v node >/dev/null 2>&1; then
    return 1
  fi

  pkg_path="$(node -e 'const path=require("path"); try { const resolved=require.resolve("opendevbrowser/package.json", { paths: [process.cwd()] }); process.stdout.write(resolved); } catch {}')"
  if [[ -z "$pkg_path" ]]; then
    return 1
  fi

  pkg_root="$(cd "$(dirname "$pkg_path")" && pwd)"
  cli_entry="$pkg_root/dist/cli/index.js"
  set_odb_cli_from_entry "$cli_entry"
}

resolve_odb_cli() {
  local helper_dir package_root cli_entry

  if [[ -n "${ODB_CLI_VALIDATOR_OVERRIDE:-}" ]]; then
    if [[ ! -x "$ODB_CLI_VALIDATOR_OVERRIDE" ]]; then
      echo "ODB_CLI_VALIDATOR_OVERRIDE is not executable: $ODB_CLI_VALIDATOR_OVERRIDE" >&2
      return 1
    fi
    ODB_CLI=("$ODB_CLI_VALIDATOR_OVERRIDE")
    return 0
  fi

  helper_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  package_root="$(cd "$helper_dir/../../.." && pwd)"
  cli_entry="$package_root/dist/cli/index.js"

  if set_odb_cli_from_entry "$cli_entry"; then
    return 0
  fi

  if find_odb_cli_from_pwd; then
    return 0
  fi

  if find_odb_cli_from_node_resolution; then
    return 0
  fi

  if command -v opendevbrowser >/dev/null 2>&1; then
    ODB_CLI=("$(command -v opendevbrowser)")
    return 0
  fi

  if command -v npx >/dev/null 2>&1; then
    ODB_CLI=(npx --yes opendevbrowser)
    return 0
  fi

  echo "Unable to locate the opendevbrowser CLI. Build a local dist/cli/index.js, install opendevbrowser as a local dependency, install the binary, or make npx available." >&2
  return 1
}

resolve_odb_cli
