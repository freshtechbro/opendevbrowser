import { describe, expect, it } from "vitest";
import {
  buildFixQueue,
  buildTargetedRerunCommands,
  deriveAuditDomainStatus,
  derivePackStatus,
  normalizeLaneStatus,
  summarizeJsonLane
} from "../scripts/skill-runtime-audit.mjs";

describe("skill runtime audit status modeling", () => {
  it("keeps mixed pass plus external counts as a passing lane", () => {
    expect(normalizeLaneStatus({
      pass: 21,
      fail: 0,
      env_limited: 6,
      expected_timeout: 0,
      skipped: 0
    })).toBe("pass");
  });

  it("treats mixed shared lanes as pass with advisory external observations", () => {
    const lane = summarizeJsonLane("provider-direct", "Direct provider runs", {
      ok: true,
      counts: {
        pass: 21,
        fail: 0,
        env_limited: 6,
        expected_timeout: 0,
        skipped: 0
      },
      out: "artifacts/provider-direct.json"
    });

    const derived = derivePackStatus({
      packId: "opendevbrowser-shopping",
      allowsEnvLimited: true,
      docOnly: false
    }, [lane]);

    expect(lane.status).toBe("pass");
    expect(lane.observedExternalConstraintCount).toBe(6);
    expect(derived.status).toBe("pass");
    expect(derived.externalConstraints).toEqual([]);
    expect(derived.observedExternalConstraints).toEqual([
      expect.objectContaining({
        id: "provider-direct",
        constraintCount: 6,
        envLimitedCount: 6,
        expectedTimeoutCount: 0
      })
    ]);
  });

  it("keeps pure env-limited lanes as blocking external constraints", () => {
    const lane = summarizeJsonLane("live-regression", "Live regression", {
      ok: true,
      counts: {
        pass: 0,
        fail: 0,
        env_limited: 1,
        expected_timeout: 2,
        skipped: 0
      },
      out: "artifacts/live-regression.json"
    });

    const derived = derivePackStatus({
      packId: "opendevbrowser-design-agent",
      allowsEnvLimited: true,
      docOnly: false
    }, [lane]);

    expect(lane.status).toBe("env_limited");
    expect(derived.status).toBe("env_limited");
    expect(derived.externalConstraints).toEqual([
      expect.objectContaining({
        id: "live-regression",
        constraintCount: 3,
        envLimitedCount: 1,
        expectedTimeoutCount: 2
      })
    ]);
    expect(derived.observedExternalConstraints).toEqual([]);
  });

  it("derives audit-domain failure from proof lanes and mapped packs", () => {
    const sharedLaneResults = new Map([
      ["docs-drift", summarizeJsonLane("docs-drift", "Docs drift", {
        ok: true,
        counts: {
          pass: 1,
          fail: 0,
          env_limited: 0,
          expected_timeout: 0,
          skipped: 0
        }
      })],
      ["cli-smoke", summarizeJsonLane("cli-smoke", "CLI smoke", {
        ok: false,
        counts: {
          pass: 0,
          fail: 1,
          env_limited: 0,
          expected_timeout: 0,
          skipped: 0
        },
        detail: "cli_smoke_failed"
      })]
    ]);
    const packResults = new Map([
      ["opendevbrowser-best-practices", {
        packId: "opendevbrowser-best-practices",
        status: "pass",
        repoDefects: [],
        externalConstraints: [],
        observedExternalConstraints: [],
        skipped: []
      }]
    ]);

    const derived = deriveAuditDomainStatus({
      id: "cli-tools-surface",
      label: "CLI, tools, and surface inventory",
      priority: 2,
      proofLanes: ["docs-drift", "cli-smoke"],
      packIds: ["opendevbrowser-best-practices"],
      contractTests: ["tests/cli-help-parity.test.ts"],
      sourceSeams: ["src/cli/args.ts"],
      targetedRerunCommands: ["node scripts/cli-smoke-test.mjs"]
    }, sharedLaneResults, packResults);

    expect(derived.status).toBe("fail");
    expect(derived.repoDefects).toEqual([
      expect.objectContaining({
        id: "cli-smoke",
        detail: "lane_report_failed"
      })
    ]);
  });

  it("builds targeted rerun commands from failing and env-limited domains without duplicates", () => {
    const commands = buildTargetedRerunCommands([
      {
        id: "extension-relay-cdp",
        label: "Extension, relay, and CDP modes",
        status: "fail",
        priority: 6,
        repoDefects: [{}],
        externalConstraints: [],
        targetedRerunCommands: [
          "node scripts/live-regression-direct.mjs --out artifacts/skill-runtime-audit/lanes/live-regression.json",
          "./skills/opendevbrowser-best-practices/scripts/odb-workflow.sh cdp-channel-check"
        ],
        sourceSeams: []
      },
      {
        id: "providers-macros-workflows",
        label: "Providers, macros, and workflow wrappers",
        status: "env_limited",
        priority: 7,
        repoDefects: [],
        externalConstraints: [{ constraintCount: 2 }],
        targetedRerunCommands: [
          "node scripts/live-regression-direct.mjs --out artifacts/skill-runtime-audit/lanes/live-regression.json",
          "npm run test -- tests/macro-resolve.test.ts tests/cli-macro-resolve.test.ts"
        ],
        sourceSeams: []
      }
    ]);

    expect(commands).toEqual([
      "node scripts/live-regression-direct.mjs --out artifacts/skill-runtime-audit/lanes/live-regression.json",
      "./skills/opendevbrowser-best-practices/scripts/odb-workflow.sh cdp-channel-check",
      "npm run test -- tests/macro-resolve.test.ts tests/cli-macro-resolve.test.ts"
    ]);
  });

  it("orders the fix queue by severity then priority", () => {
    const queue = buildFixQueue([
      {
        id: "runtime-infrastructure",
        label: "Runtime infrastructure and utilities",
        status: "env_limited",
        priority: 9,
        repoDefects: [],
        externalConstraints: [{ constraintCount: 1 }],
        targetedRerunCommands: ["node scripts/cli-smoke-test.mjs"],
        sourceSeams: ["src/core/bootstrap.ts"]
      },
      {
        id: "skills-assets-discovery",
        label: "Skills, assets, and discovery",
        status: "fail",
        priority: 1,
        repoDefects: [{}],
        externalConstraints: [],
        targetedRerunCommands: ["./skills/opendevbrowser-best-practices/scripts/validate-skill-assets.sh"],
        sourceSeams: ["src/skills/skill-loader.ts"]
      },
      {
        id: "cli-tools-surface",
        label: "CLI, tools, and surface inventory",
        status: "fail",
        priority: 2,
        repoDefects: [{}],
        externalConstraints: [],
        targetedRerunCommands: ["node scripts/cli-smoke-test.mjs"],
        sourceSeams: ["src/cli/args.ts"]
      }
    ]);

    expect(queue.map((entry) => entry.id)).toEqual([
      "skills-assets-discovery",
      "cli-tools-surface",
      "runtime-infrastructure"
    ]);
  });
});
