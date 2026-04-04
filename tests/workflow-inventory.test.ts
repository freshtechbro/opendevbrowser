import { describe, expect, it } from "vitest";
import {
  buildWorkflowInventory,
  deriveCliToolPairs,
  VALIDATION_SCENARIOS
} from "../scripts/shared/workflow-inventory.mjs";
import {
  classifyScenarioPreflight,
  determineScenarioStatus,
  parseWorkflowValidationArgs,
  renderWorkflowExecutionInventoryMarkdown,
  selectWorkflowValidationScenarios
} from "../scripts/workflow-validation-matrix.mjs";
import { renderWorkflowSurfaceMapMarkdown } from "../scripts/workflow-inventory-report.mjs";

describe("workflow inventory", () => {
  it("builds a code-derived workflow inventory with the expected current splits", () => {
    const inventory = buildWorkflowInventory();

    expect(inventory.coverage.commandCount).toBe(64);
    expect(inventory.coverage.toolCount).toBe(57);
    expect(inventory.coverage.cliToolPairCount).toBe(54);
    expect(inventory.coverage.cliOnlyCommandCount).toBe(10);
    expect(inventory.coverage.toolOnlySurfaceCount).toBe(3);
  });

  it("derives CLI to tool pairs from the tool surface source", () => {
    const pairs = deriveCliToolPairs();
    const byCli = new Map(pairs);

    expect(byCli.get("review")).toBe("opendevbrowser_review");
    expect(byCli.get("pointer-move")).toBe("opendevbrowser_pointer_move");
    expect(byCli.get("research")).toBe("opendevbrowser_research_run");
    expect(byCli.get("shopping")).toBe("opendevbrowser_shopping_run");
    expect(byCli.get("product-video")).toBe("opendevbrowser_product_video_run");
    expect(byCli.get("canvas")).toBe("opendevbrowser_canvas");
    expect(byCli.get("session-inspector")).toBe("opendevbrowser_session_inspector");
  });

  it("maps guarded and tool-only surfaces explicitly instead of pretending they are CLI executable", () => {
    const inventory = buildWorkflowInventory();
    const connect = inventory.cliCommands.find((item) => item.label === "connect");
    const native = inventory.cliCommands.find((item) => item.label === "native");
    const rpc = inventory.cliCommands.find((item) => item.label === "rpc");
    const promptingGuide = inventory.toolSurfaces.find((item) => item.label === "opendevbrowser_prompting_guide");

    expect(connect?.executionPolicy).toBe("guarded");
    expect(native?.executionPolicy).toBe("guarded");
    expect(rpc?.executionPolicy).toBe("guarded");
    expect(promptingGuide?.executionPolicy).toBe("non_cli");
  });

  it("declares primary and secondary validation tasks for the main executable scenarios", () => {
    const ids = new Set(VALIDATION_SCENARIOS.map((scenario) => scenario.id));
    for (const id of [
      "feature.cli.onboarding",
      "feature.cli.smoke",
      "workflow.research.run",
      "workflow.shopping.run",
      "workflow.product_video.url",
      "workflow.product_video.name",
      "workflow.macro.web_search",
      "workflow.macro.web_fetch",
      "workflow.macro.community_search",
      "workflow.macro.media_search",
      "feature.annotate.direct",
      "feature.canvas.managed_headless"
    ]) {
      expect(ids.has(id)).toBe(true);
    }
    for (const scenario of VALIDATION_SCENARIOS.filter((entry) => entry.executionPolicy === "automated")) {
      expect(scenario.primaryTask.length).toBeGreaterThan(0);
      expect(scenario.secondaryTask.length).toBeGreaterThan(0);
      expect(scenario.allowedStatuses.length).toBeGreaterThan(0);
    }
  });

  it("uses supported research source-selection values, honest env-limited web search boundaries, and explicit extension metadata", () => {
    const research = VALIDATION_SCENARIOS.find((scenario) => scenario.id === "workflow.research.run");
    const onboarding = VALIDATION_SCENARIOS.find((scenario) => scenario.id === "feature.cli.onboarding");
    const webSearch = VALIDATION_SCENARIOS.find((scenario) => scenario.id === "workflow.macro.web_search");
    const webFetch = VALIDATION_SCENARIOS.find((scenario) => scenario.id === "workflow.macro.web_fetch");
    const relayAnnotate = VALIDATION_SCENARIOS.find((scenario) => scenario.id === "feature.annotate.relay");
    const extensionCanvas = VALIDATION_SCENARIOS.find((scenario) => scenario.id === "feature.canvas.extension");
    const cdpCanvas = VALIDATION_SCENARIOS.find((scenario) => scenario.id === "feature.canvas.cdp");

    expect(onboarding?.ownerFiles).toContain("src/cli/onboarding-metadata.json");
    expect(onboarding?.ownerFiles).toContain("docs/FIRST_RUN_ONBOARDING.md");
    expect(research?.primaryArgs).toContain("all");
    expect(research?.secondaryArgs).toContain("all");
    expect(research?.primaryArgs).not.toContain("--sources");
    expect(research?.secondaryArgs).not.toContain("--sources");
    expect(webSearch?.allowedStatuses).toEqual(["pass", "env_limited"]);
    expect(webFetch?.secondaryArgs.join(" ")).toContain("https://playwright.dev/docs/api/class-locator");
    expect(relayAnnotate?.requiresExtension).toBe(true);
    expect(extensionCanvas?.requiresExtension).toBe(true);
    expect(cdpCanvas?.requiresExtension).toBe(true);
  });

  it("allows env_limited for honest macro shell boundaries and product-video manual follow-up", () => {
    const community = VALIDATION_SCENARIOS.find((scenario) => scenario.id === "workflow.macro.community_search");
    const media = VALIDATION_SCENARIOS.find((scenario) => scenario.id === "workflow.macro.media_search");
    const productVideoUrl = VALIDATION_SCENARIOS.find((scenario) => scenario.id === "workflow.product_video.url");
    const productVideoName = VALIDATION_SCENARIOS.find((scenario) => scenario.id === "workflow.product_video.name");

    expect(community?.allowedStatuses).toEqual(["pass", "env_limited"]);
    expect(media?.allowedStatuses).toEqual(["pass", "env_limited"]);
    expect(productVideoUrl?.allowedStatuses).toEqual(["pass", "env_limited"]);
    expect(productVideoName?.allowedStatuses).toEqual(["pass", "env_limited"]);
  });
});

describe("workflow validation matrix helpers", () => {
  it("parses workflow validation options", () => {
    const parsed = parseWorkflowValidationArgs([
      "--variant",
      "secondary",
      "--scenario",
      "workflow.shopping.run",
      "--out",
      "/tmp/out.json"
    ]);

    expect(parsed.variant).toBe("secondary");
    expect(parsed.scenarioIds).toEqual(["workflow.shopping.run"]);
    expect(parsed.out).toBe("/tmp/out.json");
  });

  it("rejects unknown scenario ids during parse", () => {
    expect(() => parseWorkflowValidationArgs(["--scenario", "not.real"])).toThrow("Unknown scenario id");
  });

  it("rejects guarded-only selections because they are inventoried, not executable", () => {
    expect(() => selectWorkflowValidationScenarios({
      variant: "primary",
      scenarioIds: ["guarded.native.bridge"]
    })).toThrow("No automated workflow validation scenarios");
  });

  it("classifies allowed timeouts and shell-only failures honestly", () => {
    expect(determineScenarioStatus({
      status: 1,
      timedOut: true,
      detail: "Node script timed out after 180000ms (scripts/annotate-live-probe.mjs --transport direct).",
      json: null
    }, {
      allowedStatuses: ["pass", "expected_timeout"]
    })).toMatchObject({
      status: "expected_timeout",
      ok: true
    });

    expect(determineScenarioStatus({
      status: 1,
      timedOut: false,
      detail: "Macro execution returned only shell records (challenge_shell).",
      json: { status: "fail" }
    }, {
      allowedStatuses: ["pass", "env_limited"]
    })).toMatchObject({
      status: "env_limited",
      detail: "shell_only_records=challenge_shell",
      ok: true
    });
  });

  it("classifies explicit manual browser follow-up failures as env_limited when the scenario allows it", () => {
    expect(determineScenarioStatus({
      status: 1,
      timedOut: false,
      detail: "Best Buy requires manual browser follow-up; this run did not determine a reliable PDP price.",
      json: { status: "fail" }
    }, {
      allowedStatuses: ["pass", "env_limited"]
    })).toMatchObject({
      status: "env_limited",
      detail: "Best Buy requires manual browser follow-up; this run did not determine a reliable PDP price.",
      ok: true
    });
  });

  it("gates reused dirty relay state only for extension-required scenarios", () => {
    const currentDaemonStatus = {
      status: 0,
      json: {
        data: {
          relay: {
            extensionHandshakeComplete: true,
            annotationConnected: true
          }
        }
      }
    };

    expect(classifyScenarioPreflight({
      scenario: { requiresExtension: true },
      startedDaemon: false,
      relayWasDirty: true,
      initialDaemonOk: true,
      initialExtensionReady: true,
      currentDaemonStatus
    })).toMatchObject({
      status: "env_limited",
      detail: "relay_busy_existing_clients"
    });

    expect(classifyScenarioPreflight({
      scenario: { requiresExtension: false },
      startedDaemon: false,
      relayWasDirty: true,
      initialDaemonOk: true,
      initialExtensionReady: true,
      currentDaemonStatus
    })).toBeNull();
  });

  it("renders a compact execution ledger with infra and inventoried sections", () => {
    const markdown = renderWorkflowExecutionInventoryMarkdown({
      variant: "primary",
      generatedAt: "2026-04-02T00:00:00.000Z",
      counts: { pass: 2, fail: 1 },
      infraSteps: [
        {
          id: "infra.daemon_status",
          status: "pass",
          detail: null
        }
      ],
      steps: [
        {
          id: "feature.cli.smoke",
          command: "node scripts/cli-smoke-test.mjs",
          variantTask: "Run the low-level smoke matrix.",
          status: "pass",
          detail: null,
          artifactPath: "/tmp/cli-smoke.json",
          ownerFiles: ["scripts/cli-smoke-test.mjs"]
        },
        {
          id: "workflow.shopping.run",
          command: "opendevbrowser shopping run ...",
          variantTask: "Compare monitors.",
          status: "fail",
          detail: "challenge_detected",
          artifactPath: "/tmp/shopping.json",
          ownerFiles: ["src/providers/workflows.ts", "src/providers/shopping-postprocess.ts"]
        }
      ],
      inventoriedSurfaces: [
        {
          id: "guarded.connect.remote",
          entryPath: "opendevbrowser connect",
          executionPolicy: "guarded",
          variantTask: "Attach to an already-running remote debugging endpoint.",
          executionState: "inventoried_not_executed"
        }
      ]
    });

    expect(markdown).toContain("# Workflow Execution Inventory");
    expect(markdown).toContain("## Infra preflight");
    expect(markdown).toContain("## Executed automated scenarios");
    expect(markdown).toContain("## Inventoried but not executed");
    expect(markdown).toContain("feature.cli.smoke");
    expect(markdown).toContain("challenge_detected");
    expect(markdown).toContain("/tmp/shopping.json");
    expect(markdown).toContain("src/providers/shopping-postprocess.ts");
    expect(markdown).toContain("guarded.connect.remote");
  });

  it("renders workflow surface maps with stable scenario ids", () => {
    const markdown = renderWorkflowSurfaceMapMarkdown({
      generatedAt: "2026-04-02T00:00:00.000Z",
      coverage: {
        commandCount: 63,
        toolCount: 56,
        cliToolPairCount: 53,
        cliOnlyCommandCount: 10,
        toolOnlySurfaceCount: 3,
        providerIdCount: 5,
        cliOnlyCommands: ["serve"],
        toolOnlySurfaces: ["opendevbrowser_prompting_guide"]
      },
      cliCommands: [
        { family: "providers", familyLabel: "First-class provider workflows", label: "research" }
      ],
      toolFamilies: [
        { label: "First-class workflows", members: ["opendevbrowser_research_run"] }
      ],
      scenarios: [
        {
          id: "workflow.research.run",
          entryPath: "opendevbrowser research run",
          executionPolicy: "automated",
          primaryTask: "Primary research task.",
          secondaryTask: "Secondary research task."
        },
        {
          id: "guarded.native.bridge",
          entryPath: "opendevbrowser native ...",
          executionPolicy: "guarded",
          primaryTask: "Native bridge task."
        }
      ]
    });

    expect(markdown).toContain("`workflow.research.run`");
    expect(markdown).toContain("`guarded.native.bridge`");
  });
});
