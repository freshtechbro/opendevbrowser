import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MATRIX_PATH = path.join(
  ROOT,
  "skills",
  "opendevbrowser-best-practices",
  "assets",
  "templates",
  "skill-runtime-pack-matrix.json"
);
const BUNDLED_SKILL_DIRECTORIES_PATH = path.join(ROOT, "src", "skills", "bundled-skill-directories.ts");

function readMatrix() {
  return JSON.parse(fs.readFileSync(MATRIX_PATH, "utf8"));
}

function assertUniqueIds(values, label) {
  const unique = new Set(values);
  if (unique.size !== values.length) {
    throw new Error(`${label} must be unique.`);
  }
}

function assertRelativePathsExist(paths, label) {
  for (const relativePath of paths) {
    if (typeof relativePath !== "string" || relativePath.length === 0) {
      throw new Error(`${label} must contain non-empty string paths.`);
    }
    if (!fs.existsSync(path.join(ROOT, relativePath))) {
      throw new Error(`${label} missing path: ${relativePath}`);
    }
  }
}

function readBundledSkillEntryName(entry) {
  if (!ts.isObjectLiteralExpression(entry)) {
    throw new Error("bundledSkillDirectories entries must be object literals.");
  }
  const property = entry.properties.find((candidate) =>
    ts.isPropertyAssignment(candidate)
    && ts.isIdentifier(candidate.name)
    && candidate.name.text === "name"
  );
  if (!property || !ts.isStringLiteralLike(property.initializer)) {
    throw new Error("bundledSkillDirectories entries must include a string literal name.");
  }
  return property.initializer.text;
}

function findBundledSkillDirectoriesInitializer(sourceFile) {
  const declaration = sourceFile.statements
    .filter(ts.isVariableStatement)
    .flatMap((statement) => [...statement.declarationList.declarations])
    .find((candidate) =>
      ts.isIdentifier(candidate.name)
      && candidate.name.text === "bundledSkillDirectories"
    );
  if (!declaration || !declaration.initializer || !ts.isArrayLiteralExpression(declaration.initializer)) {
    throw new Error("bundledSkillDirectories array literal is missing.");
  }
  return declaration.initializer;
}

export function getBundledSkillDirectoryPackIds() {
  const sourceText = fs.readFileSync(BUNDLED_SKILL_DIRECTORIES_PATH, "utf8");
  const sourceFile = ts.createSourceFile(
    BUNDLED_SKILL_DIRECTORIES_PATH,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  return findBundledSkillDirectoriesInitializer(sourceFile).elements.map(readBundledSkillEntryName);
}

export function loadSkillRuntimeMatrix() {
  const matrix = readMatrix();
  if (!Array.isArray(matrix.canonicalPacks) || matrix.canonicalPacks.length === 0) {
    throw new Error("skill-runtime-pack-matrix.json missing canonicalPacks.");
  }
  if (!Array.isArray(matrix.auditDomains) || matrix.auditDomains.length === 0) {
    throw new Error("skill-runtime-pack-matrix.json missing auditDomains.");
  }
  if (!Array.isArray(matrix.runtimeFamilies) || matrix.runtimeFamilies.length === 0) {
    throw new Error("skill-runtime-pack-matrix.json missing runtimeFamilies.");
  }

  const packIds = matrix.canonicalPacks
    .map((entry) => entry?.packId)
    .filter((value) => typeof value === "string");
  const domainIds = matrix.auditDomains
    .map((entry) => entry?.id)
    .filter((value) => typeof value === "string");
  const familyIds = matrix.runtimeFamilies
    .map((entry) => entry?.id)
    .filter((value) => typeof value === "string");
  assertUniqueIds(packIds, "canonical pack ids");
  assertUniqueIds(domainIds, "audit domain ids");
  assertUniqueIds(familyIds, "runtime family ids");

  const knownPackIds = new Set(packIds);
  const knownLaneIds = new Set(Object.keys(SKILL_RUNTIME_SHARED_LANES));
  for (const domain of matrix.auditDomains) {
    const proofLanes = Array.isArray(domain?.proofLanes) ? domain.proofLanes : [];
    const contractTests = Array.isArray(domain?.contractTests) ? domain.contractTests : [];
    const sourceSeams = Array.isArray(domain?.sourceSeams) ? domain.sourceSeams : [];
    const domainPackIds = Array.isArray(domain?.packIds) ? domain.packIds : [];
    const targetedRerunCommands = Array.isArray(domain?.targetedRerunCommands) ? domain.targetedRerunCommands : [];

    if (typeof domain?.label !== "string" || domain.label.length === 0) {
      throw new Error(`Audit domain ${domain?.id ?? "<missing>"} missing label.`);
    }
    if (typeof domain?.priority !== "number" || !Number.isFinite(domain.priority)) {
      throw new Error(`Audit domain ${domain.id} missing numeric priority.`);
    }
    if (proofLanes.length === 0) {
      throw new Error(`Audit domain ${domain.id} missing proofLanes.`);
    }
    if (targetedRerunCommands.length === 0) {
      throw new Error(`Audit domain ${domain.id} missing targetedRerunCommands.`);
    }
    for (const laneId of proofLanes) {
      if (!knownLaneIds.has(laneId)) {
        throw new Error(`Audit domain ${domain.id} references unknown proof lane: ${laneId}`);
      }
    }
    for (const packId of domainPackIds) {
      if (!knownPackIds.has(packId)) {
        throw new Error(`Audit domain ${domain.id} references unknown pack: ${packId}`);
      }
    }
    assertRelativePathsExist(contractTests, `Audit domain ${domain.id} contractTests`);
    assertRelativePathsExist(sourceSeams, `Audit domain ${domain.id} sourceSeams`);
  }

  return matrix;
}

export function getCanonicalSkillRuntimePacks() {
  return loadSkillRuntimeMatrix().canonicalPacks;
}

export function getAuditDomains() {
  return loadSkillRuntimeMatrix().auditDomains;
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
