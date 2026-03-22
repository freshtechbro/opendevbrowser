import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MATRIX_PATH = path.join(
  ROOT,
  "skills",
  "opendevbrowser-best-practices",
  "assets",
  "templates",
  "skill-runtime-pack-matrix.json"
);

function readMatrix() {
  return JSON.parse(fs.readFileSync(MATRIX_PATH, "utf8"));
}

function assertUniqueIds(values, label) {
  const unique = new Set(values);
  if (unique.size !== values.length) {
    throw new Error(`${label} must be unique.`);
  }
}

export function loadSkillRuntimeMatrix() {
  const matrix = readMatrix();
  if (!Array.isArray(matrix.canonicalPacks) || matrix.canonicalPacks.length === 0) {
    throw new Error("skill-runtime-pack-matrix.json missing canonicalPacks.");
  }
  if (!Array.isArray(matrix.runtimeFamilies) || matrix.runtimeFamilies.length === 0) {
    throw new Error("skill-runtime-pack-matrix.json missing runtimeFamilies.");
  }

  const packIds = matrix.canonicalPacks
    .map((entry) => entry?.packId)
    .filter((value) => typeof value === "string");
  const familyIds = matrix.runtimeFamilies
    .map((entry) => entry?.id)
    .filter((value) => typeof value === "string");
  assertUniqueIds(packIds, "canonical pack ids");
  assertUniqueIds(familyIds, "runtime family ids");

  return matrix;
}

export function getCanonicalSkillRuntimePacks() {
  return loadSkillRuntimeMatrix().canonicalPacks;
}

export function getRuntimeFamilies() {
  return loadSkillRuntimeMatrix().runtimeFamilies;
}

export function getPackById(packId) {
  return getCanonicalSkillRuntimePacks().find((entry) => entry.packId === packId) ?? null;
}

export const SKILL_RUNTIME_SHARED_LANES = {
  "docs-drift": {
    id: "docs-drift",
    label: "Source-backed docs drift check"
  },
  "best-practices-robustness": {
    id: "best-practices-robustness",
    label: "Best-practices robustness issue coverage"
  },
  "cli-smoke": {
    id: "cli-smoke",
    label: "CLI smoke test"
  },
  "provider-direct": {
    id: "provider-direct",
    label: "Direct provider real-world runs"
  },
  "live-regression": {
    id: "live-regression",
    label: "Managed, extension, and canvas live regression"
  },
  "canvas-competitive": {
    id: "canvas-competitive",
    label: "Canvas competitive validation"
  },
  "login-fixture": {
    id: "login-fixture",
    label: "Repo-local login workflow fixture"
  },
  "product-video-fixture": {
    id: "product-video-fixture",
    label: "Repo-local product-video workflow fixture"
  },
  "research-live": {
    id: "research-live",
    label: "Research workflow live probe"
  },
  "skill-discovery": {
    id: "skill-discovery",
    label: "Skill discovery and load parity"
  }
};
