import { describe, expect, it } from "vitest";
import {
  buildProviderDirectAuditArgs,
  buildFixQueue,
  buildTargetedRerunCommands,
  deriveAuditDomainStatus,
  derivePackStatus,
  normalizeLaneStatus,
  preferConfiguredSmokeRerun,
  shouldUseConfiguredAuditEnv,
  summarizeJsonLane
} from "../scripts/skill-runtime-audit.mjs";
import {
  getBundledSkillDirectoryPackIds,
  loadSkillRuntimeMatrix
} from "../scripts/skill-runtime-scenarios.mjs";

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

  it("uses the current configured env for full provider and live regression lanes", () => {
    expect(shouldUseConfiguredAuditEnv("provider-direct", { smoke: false })).toBe(true);
    expect(shouldUseConfiguredAuditEnv("live-regression", { smoke: false })).toBe(true);
    expect(shouldUseConfiguredAuditEnv("provider-direct", { smoke: true })).toBe(false);
    expect(shouldUseConfiguredAuditEnv("live-regression", { smoke: true })).toBe(false);
    expect(shouldUseConfiguredAuditEnv("cli-smoke", { smoke: false })).toBe(false);
  });

  it("keeps provider direct audit args aligned with the current environment contract", () => {
    const args = buildProviderDirectAuditArgs({ smoke: false, quiet: true }, "artifacts/provider-direct.json");

    expect(args).toContain("--include-auth-gated");
    expect(args).toContain("--include-high-friction");
    expect(args).toContain("--quiet");
    expect(args).not.toContain("--use-global-env");
  });

  it("preserves rerun metadata from JSON lanes", () => {
    const lane = summarizeJsonLane("provider-direct", "Direct provider runs", {
      ok: true,
      counts: {
        pass: 1,
        fail: 0,
        env_limited: 0,
        expected_timeout: 0,
        skipped: 0
      },
      rerunMetadata: {
        requestedChallengeAutomationMode: "browser_with_helper",
        helperCapableRequested: true
      }
    });

    expect(lane.rerunMetadata).toEqual({
      requestedChallengeAutomationMode: "browser_with_helper",
      helperCapableRequested: true
    });
  });

  it("surfaces coverage-gap detail without upgrading a mixed lane to fail", () => {
    const lane = summarizeJsonLane("provider-direct", "Direct provider runs", {
      ok: true,
      counts: {
        pass: 20,
        fail: 0,
        env_limited: 0,
        expected_timeout: 0,
        skipped: 1
      },
      coverageGap: {
        status: "skipped",
        detail: "missing=social/x extra=none"
      }
    });

    expect(lane.status).toBe("pass");
    expect(lane.detail).toBe("missing=social/x extra=none");
    expect(lane.coverageGap).toEqual({
      status: "skipped",
      detail: "missing=social/x extra=none"
    });
  });

  it("prefers the configured-daemon rerun when a smoke harness lane fails", () => {
    const merged = preferConfiguredSmokeRerun({
      id: "live-regression",
      status: "fail",
      detail: "lane_report_failed",
      artifactPath: "artifacts/live-regression.json"
    }, {
      id: "live-regression",
      status: "pass",
      detail: null,
      artifactPath: "artifacts/live-regression-rerun.json",
      rerunMetadata: {
        helperCapableRequested: true
      }
    });

    expect(merged.status).toBe("pass");
    expect(merged.artifactPath).toBe("artifacts/live-regression-rerun.json");
    expect(merged.rerunMetadata).toMatchObject({
      authoritativeSource: "configured-daemon-rerun",
      helperCapableRequested: true,
      smokeHarnessResult: {
        status: "fail",
        artifactPath: "artifacts/live-regression.json"
      },
      configuredRerunResult: {
        status: "pass",
        artifactPath: "artifacts/live-regression-rerun.json"
      }
    });
  });

  it("keeps the runtime matrix aligned with inspiredesign and first-contact governance", () => {
    const matrix = loadSkillRuntimeMatrix();
    const bestPractices = matrix.canonicalPacks.find((entry) => entry.packId === "opendevbrowser-best-practices");
    const cliToolsSurface = matrix.auditDomains.find((entry) => entry.id === "cli-tools-surface");
    const providersWorkflows = matrix.auditDomains.find((entry) => entry.id === "providers-macros-workflows");
    const replayDesktopFamily = matrix.runtimeFamilies.find((entry) => entry.id === "browser-replay-desktop-observation");

    expect(bestPractices?.runtimeSurfaces.cliCommands).toEqual(expect.arrayContaining([
      "inspiredesign",
      "screencast-start",
      "desktop-status"
    ]));
    expect(bestPractices?.runtimeSurfaces.tools).toEqual(expect.arrayContaining([
      "opendevbrowser_inspiredesign_run",
      "opendevbrowser_screencast_start",
      "opendevbrowser_desktop_status"
    ]));
    expect(cliToolsSurface?.sourceSeams).toEqual(expect.arrayContaining([
      "src/cli/onboarding-metadata.json",
      "docs/FIRST_RUN_ONBOARDING.md",
      "docs/README.md"
    ]));
    expect(providersWorkflows?.contractTests).toContain("tests/providers-inspiredesign-workflow.test.ts");
    expect(providersWorkflows?.sourceSeams).toEqual(expect.arrayContaining([
      "src/cli/commands/inspiredesign.ts",
      "src/tools/inspiredesign_run.ts",
      "src/inspiredesign/contract.ts"
    ]));
    expect(replayDesktopFamily).toEqual({
      id: "browser-replay-desktop-observation",
      label: "Browser replay and desktop observation",
      proofLanes: ["docs-drift", "live-regression"]
    });
  });

  it("keeps bundled skill registry ordering aligned with the runtime matrix", () => {
    const matrixPackIds = loadSkillRuntimeMatrix().canonicalPacks.map((entry) => entry.packId);

    expect(getBundledSkillDirectoryPackIds()).toEqual(matrixPackIds);
  });
});
