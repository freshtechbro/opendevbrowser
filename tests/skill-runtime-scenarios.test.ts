import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  getAuditDomains,
  getCanonicalSkillRuntimePacks,
  loadSkillRuntimeMatrix,
  SKILL_RUNTIME_SHARED_LANES
} from "../scripts/skill-runtime-scenarios.mjs";

describe("skill runtime scenario matrix", () => {
  it("declares unique audit domains with valid lane, pack, and file references", () => {
    const matrix = loadSkillRuntimeMatrix();
    const auditDomains = getAuditDomains();
    const packIds = new Set(getCanonicalSkillRuntimePacks().map((entry) => entry.packId));
    const proofLaneIds = new Set(Object.keys(SKILL_RUNTIME_SHARED_LANES));
    const expectedDomainIds = [
      "skills-assets-discovery",
      "cli-tools-surface",
      "scripts-and-governance",
      "browser-snapshot-interaction",
      "canvas-annotate-design",
      "extension-relay-cdp",
      "providers-macros-workflows",
      "challenges-and-guardrails",
      "runtime-infrastructure"
    ];

    expect(matrix.auditDomains).toHaveLength(expectedDomainIds.length);
    expect(auditDomains.map((entry) => entry.id)).toEqual(expectedDomainIds);
    expect(new Set(auditDomains.map((entry) => entry.id)).size).toBe(expectedDomainIds.length);

    for (const domain of auditDomains) {
      expect(typeof domain.label).toBe("string");
      expect(domain.label.length).toBeGreaterThan(0);
      expect(typeof domain.priority).toBe("number");
      expect(Array.isArray(domain.proofLanes)).toBe(true);
      expect(domain.proofLanes.length).toBeGreaterThan(0);
      expect(Array.isArray(domain.contractTests)).toBe(true);
      expect(domain.contractTests.length).toBeGreaterThan(0);
      expect(Array.isArray(domain.sourceSeams)).toBe(true);
      expect(domain.sourceSeams.length).toBeGreaterThan(0);
      expect(Array.isArray(domain.targetedRerunCommands)).toBe(true);
      expect(domain.targetedRerunCommands.length).toBeGreaterThan(0);

      for (const laneId of domain.proofLanes) {
        expect(proofLaneIds.has(laneId)).toBe(true);
      }
      for (const packId of domain.packIds ?? []) {
        expect(packIds.has(packId)).toBe(true);
      }
      for (const relativePath of [...domain.contractTests, ...domain.sourceSeams]) {
        expect(fs.existsSync(path.join(process.cwd(), relativePath))).toBe(true);
      }
    }
  });
});
