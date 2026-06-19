#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 ]]; then
  cat <<'EOF' >&2
Usage:
  ./skills/opendevbrowser-design-agent/scripts/extract-canvas-plan.sh <design-contract-or-canvas-plan-request.json> [canvas-session.json]
EOF
  exit 2
fi

input_path="$1"
session_path="${2:-}"

node - "$input_path" "$session_path" <<'NODE'
const fs = require("node:fs");

const inputPath = process.argv[2];
const sessionPath = process.argv[3];

const allowedValues = {
  "targetOutcome.mode": ["low-fi-wireframe", "high-fi-live-edit", "dual-track", "document-only"],
  "visualDirection.profile": [
    "clean-room",
    "cinematic-minimal",
    "product-story",
    "commerce-system",
    "control-room",
    "ops-control",
    "auth-focused",
    "settings-system",
    "documentation"
  ],
  "visualDirection.themeStrategy": ["single-theme", "light-dark-parity", "multi-theme-system"],
  "layoutStrategy.navigationModel": ["global-header", "sidebar", "tabbed", "contextual", "immersive"],
  "componentStrategy.interactionStates": [
    "default",
    "hover",
    "focus",
    "active",
    "disabled",
    "loading",
    "empty",
    "error",
    "success",
    "selected"
  ],
  "motionPosture.level": ["none", "minimal", "subtle", "expressive"],
  "motionPosture.reducedMotion": ["respect-user-preference", "static-alternative"],
  "responsivePosture.primaryViewport": ["desktop", "tablet", "mobile"],
  "responsivePosture.requiredViewports": ["desktop", "tablet", "mobile"],
  "accessibilityPosture.keyboardNavigation": ["full", "core-flows"],
  "validationTargets.blockOn": [
    "missing-generation-plan",
    "invalid-generation-plan",
    "missing-governance-block",
    "missing-intent",
    "missing-design-language",
    "missing-content-model",
    "missing-typography-system",
    "missing-color-role",
    "missing-surface-policy",
    "missing-state-coverage",
    "missing-reduced-motion-policy",
    "missing-responsive-policy",
    "overflow",
    "token-missing",
    "broken-asset-reference",
    "contrast-failure",
    "hierarchy-weak",
    "asset-provenance-missing",
    "font-policy-missing",
    "font-load-failure",
    "reduced-motion-violation",
    "unresolved-component-binding",
    "icon-policy-violation",
    "library-policy-violation",
    "responsive-mismatch",
    "runtime-budget-exceeded",
    "unsupported-target",
    "export-warning"
  ],
  "validationTargets.requiredThemes": ["light", "dark"],
  "validationTargets.browserValidation": ["required", "optional"]
};

const requiredSections = [
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

const requiredFields = [
  { path: "targetOutcome.mode", kind: "enum" },
  { path: "targetOutcome.summary", kind: "string" },
  { path: "visualDirection.profile", kind: "enum" },
  { path: "visualDirection.themeStrategy", kind: "enum" },
  { path: "layoutStrategy.approach", kind: "string" },
  { path: "layoutStrategy.navigationModel", kind: "enum" },
  { path: "contentStrategy.source", kind: "string" },
  { path: "componentStrategy.mode", kind: "string" },
  { path: "componentStrategy.interactionStates", kind: "enumArray" },
  { path: "motionPosture.level", kind: "enum" },
  { path: "motionPosture.reducedMotion", kind: "enum" },
  { path: "responsivePosture.primaryViewport", kind: "enum" },
  { path: "responsivePosture.requiredViewports", kind: "enumArray" },
  { path: "accessibilityPosture.target", kind: "string" },
  { path: "accessibilityPosture.keyboardNavigation", kind: "enum" },
  { path: "validationTargets.blockOn", kind: "enumArray" },
  { path: "validationTargets.requiredThemes", kind: "enumArray" },
  { path: "validationTargets.browserValidation", kind: "enum" },
  { path: "validationTargets.maxInteractionLatencyMs", kind: "positiveNumber" }
];

function readJson(path) {
  try {
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to read JSON from ${path}: ${message}`);
    process.exit(1);
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getPath(value, path) {
  return path.split(".").reduce((current, part) => {
    if (!isRecord(current) || !(part in current)) {
      return undefined;
    }
    return current[part];
  }, value);
}

function formatValue(value) {
  return JSON.stringify(value);
}

function validateString(plan, path, errors) {
  const value = getPath(plan, path);
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(`${path}: expected non-empty string, received ${formatValue(value)}`);
  }
}

function validatePositiveNumber(plan, path, errors) {
  const value = getPath(plan, path);
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    errors.push(`${path}: expected positive number, received ${formatValue(value)}`);
  }
}

function validateEnum(plan, path, errors) {
  const value = getPath(plan, path);
  const allowed = allowedValues[path];
  if (typeof value !== "string" || !allowed.includes(value)) {
    errors.push(`${path}: expected one of ${allowed.join(", ")}, received ${formatValue(value)}`);
  }
}

function validateEnumArray(plan, path, errors) {
  const value = getPath(plan, path);
  const allowed = allowedValues[path];
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(`${path}: expected non-empty array, received ${formatValue(value)}`);
    return;
  }
  const invalid = value.filter((entry) => typeof entry !== "string" || !allowed.includes(entry));
  if (invalid.length > 0) {
    errors.push(`${path}: invalid values ${invalid.map(formatValue).join(", ")}; expected entries from ${allowed.join(", ")}`);
  }
}

function validateOptionalStringArray(plan, path, errors) {
  const value = getPath(plan, path);
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(`${path}: expected non-empty string array when present, received ${formatValue(value)}`);
    return;
  }
  const invalid = value.filter((entry) => typeof entry !== "string" || entry.trim().length === 0);
  if (invalid.length > 0) {
    errors.push(`${path}: expected only non-empty strings, received ${formatValue(value)}`);
  }
}

function validateOptionalRecord(plan, path, errors) {
  const value = getPath(plan, path);
  if (value === undefined) {
    return;
  }
  if (!isRecord(value)) {
    errors.push(`${path}: expected object when present, received ${formatValue(value)}`);
  }
}

function validateGenerationPlan(plan) {
  const errors = [];
  if (!isRecord(plan)) {
    return ["generationPlan: expected object"];
  }

  for (const section of requiredSections) {
    const value = plan[section];
    if (!isRecord(value) || Object.keys(value).length === 0) {
      errors.push(`${section}: expected non-empty object, received ${formatValue(value)}`);
    }
  }

  for (const field of requiredFields) {
    if (field.kind === "string") {
      validateString(plan, field.path, errors);
    } else if (field.kind === "positiveNumber") {
      validatePositiveNumber(plan, field.path, errors);
    } else if (field.kind === "enumArray") {
      validateEnumArray(plan, field.path, errors);
    } else {
      validateEnum(plan, field.path, errors);
    }
  }

  const primaryViewport = getPath(plan, "responsivePosture.primaryViewport");
  const requiredViewports = getPath(plan, "responsivePosture.requiredViewports");
  if (typeof primaryViewport === "string" && Array.isArray(requiredViewports) && !requiredViewports.includes(primaryViewport)) {
    errors.push("responsivePosture.requiredViewports: must include responsivePosture.primaryViewport");
  }

  validateOptionalStringArray(plan, "interactionMoments", errors);
  validateOptionalStringArray(plan, "materialEffects", errors);
  validateOptionalRecord(plan, "designVectors", errors);

  return errors;
}

const payload = readJson(inputPath);

if (!isRecord(payload) || !("generationPlan" in payload)) {
  console.error("Input must be a full design contract or canvas.plan.set request object with generationPlan.");
  process.exit(1);
}

const plan = payload.generationPlan;
const errors = validateGenerationPlan(plan);
if (errors.length > 0) {
  for (const error of errors) {
    console.error(`Invalid generationPlan.${error}`);
  }
  process.exit(1);
}

let sessionPayload = null;
if (sessionPath) {
  sessionPayload = readJson(sessionPath);
}

const sessionResult = sessionPayload?.data?.result ?? sessionPayload?.result ?? sessionPayload ?? {};

process.stdout.write(JSON.stringify({
  requestId: payload.requestId ?? "req_plan_from_contract",
  canvasSessionId: payload.canvasSessionId ?? sessionResult.canvasSessionId ?? "<canvas-session-id>",
  leaseId: payload.leaseId ?? sessionResult.leaseId ?? "<lease-id>",
  documentId: payload.documentId ?? sessionResult.documentId ?? "<document-id>",
  generationPlan: plan
}, null, 2));
process.stdout.write("\n");
NODE
