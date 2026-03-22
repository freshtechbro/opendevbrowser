#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 ]]; then
  cat <<'EOF' >&2
Usage:
  ./skills/opendevbrowser-design-agent/scripts/extract-canvas-plan.sh <design-contract.json> [canvas-session.json]
EOF
  exit 2
fi

input_path="$1"
session_path="${2:-}"

node - "$input_path" "$session_path" <<'NODE'
const fs = require("node:fs");

const inputPath = process.argv[2];
const sessionPath = process.argv[3];
const requiredKeys = [
  "targetOutcome",
  "visualDirection",
  "layoutStrategy",
  "contentStrategy",
  "componentStrategy",
  "motionPosture",
  "responsivePosture",
  "accessibilityPosture",
  "validationTargets"
];

const payload = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const plan = payload.generationPlan ?? payload;
const missing = requiredKeys.filter((key) => !(key in plan));

let sessionPayload = null;
if (sessionPath) {
  sessionPayload = JSON.parse(fs.readFileSync(sessionPath, "utf8"));
}

const sessionResult = sessionPayload?.data?.result ?? sessionPayload?.result ?? sessionPayload ?? {};

if (missing.length > 0) {
  console.error(`Missing generationPlan keys: ${missing.join(", ")}`);
  process.exit(1);
}

process.stdout.write(JSON.stringify({
  requestId: payload.requestId ?? "req_plan_from_contract",
  canvasSessionId: payload.canvasSessionId ?? sessionResult.canvasSessionId ?? "<canvas-session-id>",
  leaseId: payload.leaseId ?? sessionResult.leaseId ?? "<lease-id>",
  documentId: payload.documentId ?? sessionResult.documentId ?? "<document-id>",
  generationPlan: plan
}, null, 2));
process.stdout.write("\n");
NODE
