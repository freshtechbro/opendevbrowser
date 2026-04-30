import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedArgs } from "../src/cli/args";
import { runInspiredesignCommand } from "../src/cli/commands/inspiredesign";
import { runMacroResolve } from "../src/cli/commands/macro-resolve";
import { runProductVideoCommand } from "../src/cli/commands/product-video";
import { runResearchCommand } from "../src/cli/commands/research";
import { runShoppingCommand } from "../src/cli/commands/shopping";
import { DEFAULT_WORKFLOW_TRANSPORT_TIMEOUT_MS } from "../src/cli/transport-timeouts";
import {
  buildInspiredesignFollowthroughSummary,
  buildInspiredesignNextStep
} from "../src/inspiredesign/handoff";

const { callDaemon } = vi.hoisted(() => ({
  callDaemon: vi.fn()
}));

vi.mock("../src/cli/client", () => ({
  callDaemon
}));

const makeArgs = (command: ParsedArgs["command"], rawArgs: string[]): ParsedArgs => ({
  command,
  mode: undefined,
  withConfig: false,
  noPrompt: false,
  noInteractive: false,
  quiet: false,
  outputFormat: "json",
  transport: "relay",
  skillsMode: "global",
  fullInstall: false,
  rawArgs
});

describe("workflow CLI commands", () => {
  beforeEach(() => {
    callDaemon.mockReset();
  });

  it("parses and dispatches research run payload", async () => {
    callDaemon.mockResolvedValue({ ok: true });

    const result = await runResearchCommand(makeArgs("research", [
      "run",
      "--topic=browser automation",
      "--days=14",
      "--source-selection=all",
      "--sources=web,shopping",
      "--mode=context",
      "--include-engagement",
      "--limit-per-source=5",
      "--output-dir=/tmp/out",
      "--ttl-hours=72"
    ]));

    expect(callDaemon).toHaveBeenCalledWith("research.run", {
      topic: "browser automation",
      days: 14,
      from: undefined,
      to: undefined,
      sourceSelection: "all",
      sources: ["web", "shopping"],
      mode: "context",
      includeEngagement: true,
      limitPerSource: 5,
      timeoutMs: DEFAULT_WORKFLOW_TRANSPORT_TIMEOUT_MS,
      outputDir: "/tmp/out",
      ttlHours: 72,
      useCookies: undefined,
      cookiePolicyOverride: undefined
    });
    expect(result).toMatchObject({ success: true });
  });

  it("supports explicit timeout for research workflows", async () => {
    callDaemon.mockResolvedValue({ ok: true });

    await runResearchCommand(makeArgs("research", [
      "run",
      "--topic=browser automation",
      "--timeout-ms=45000"
    ]));

    expect(callDaemon).toHaveBeenCalledWith("research.run", {
      topic: "browser automation",
      days: undefined,
      from: undefined,
      to: undefined,
      sourceSelection: undefined,
      sources: undefined,
      mode: "compact",
      includeEngagement: false,
      limitPerSource: undefined,
      timeoutMs: 45000,
      outputDir: undefined,
      ttlHours: undefined,
      useCookies: undefined,
      cookiePolicyOverride: undefined
    });
  });

  it("parses and dispatches shopping run payload", async () => {
    callDaemon.mockResolvedValue({ ok: true });

    await runShoppingCommand(makeArgs("shopping", [
      "run",
      "--query=usb hub",
      "--providers=shopping/amazon,shopping/others",
      "--budget=50",
      "--region=us",
      "--sort=lowest_price",
      "--mode=md"
    ]));

    expect(callDaemon).toHaveBeenCalledWith("shopping.run", {
      query: "usb hub",
      providers: ["shopping/amazon", "shopping/others"],
      budget: 50,
      region: "us",
      sort: "lowest_price",
      mode: "md",
      timeoutMs: DEFAULT_WORKFLOW_TRANSPORT_TIMEOUT_MS,
      outputDir: undefined,
      ttlHours: undefined,
      browserMode: undefined,
      useCookies: undefined,
      cookiePolicyOverride: undefined
    }, {
      timeoutMs: 180000
    });
  });

  it("supports explicit timeout for shopping workflows", async () => {
    callDaemon.mockResolvedValue({ ok: true });

    await runShoppingCommand(makeArgs("shopping", [
      "run",
      "--query=wireless mouse",
      "--providers=shopping/bestbuy",
      "--timeout-ms=45000"
    ]));

    expect(callDaemon).toHaveBeenCalledWith("shopping.run", {
      query: "wireless mouse",
      providers: ["shopping/bestbuy"],
      budget: undefined,
      region: undefined,
      sort: undefined,
      mode: "compact",
      timeoutMs: 45000,
      outputDir: undefined,
      ttlHours: undefined,
      useCookies: undefined,
      cookiePolicyOverride: undefined
    }, {
      timeoutMs: 120000
    });
  });

  it("extends shopping transport timeout beyond the previous client cap for long-running workflows", async () => {
    callDaemon.mockResolvedValue({ ok: true });

    await runShoppingCommand(makeArgs("shopping", [
      "run",
      "--query=wireless mouse",
      "--providers=shopping/bestbuy",
      "--timeout-ms=360000"
    ]));

    expect(callDaemon).toHaveBeenCalledWith("shopping.run", {
      query: "wireless mouse",
      providers: ["shopping/bestbuy"],
      budget: undefined,
      region: undefined,
      sort: undefined,
      mode: "compact",
      timeoutMs: 360000,
      outputDir: undefined,
      ttlHours: undefined,
      useCookies: undefined,
      cookiePolicyOverride: undefined
    }, {
      timeoutMs: 420000
    });
  });

  it("forwards explicit shopping browser-mode overrides", async () => {
    callDaemon.mockResolvedValue({ ok: true });

    await runShoppingCommand(makeArgs("shopping", [
      "run",
      "--query=macbook pro m4 32gb ram",
      "--browser-mode=extension"
    ]));
    await runShoppingCommand(makeArgs("shopping", [
      "run",
      "--query=macbook pro m4 32gb ram",
      "--browser-mode=managed"
    ]));
    await runShoppingCommand(makeArgs("shopping", [
      "run",
      "--query=macbook pro m4 32gb ram",
      "--browser-mode=auto"
    ]));

    expect(callDaemon).toHaveBeenNthCalledWith(1, "shopping.run", expect.objectContaining({
      query: "macbook pro m4 32gb ram",
      browserMode: "extension"
    }), {
      timeoutMs: 180000
    });
    expect(callDaemon).toHaveBeenNthCalledWith(2, "shopping.run", expect.objectContaining({
      query: "macbook pro m4 32gb ram",
      browserMode: "managed"
    }), {
      timeoutMs: 180000
    });
    expect(callDaemon).toHaveBeenNthCalledWith(3, "shopping.run", expect.objectContaining({
      query: "macbook pro m4 32gb ram",
      browserMode: "auto"
    }), {
      timeoutMs: 180000
    });
  });

  it("forwards explicit research browser-mode overrides", async () => {
    callDaemon.mockResolvedValue({ ok: true });

    await runResearchCommand(makeArgs("research", [
      "run",
      "--topic=browser automation on X",
      "--browser-mode=extension"
    ]));
    await runResearchCommand(makeArgs("research", [
      "run",
      "--topic=browser automation on Reddit",
      "--browser-mode=managed"
    ]));
    await runResearchCommand(makeArgs("research", [
      "run",
      "--topic=browser automation",
      "--browser-mode=auto"
    ]));

    expect(callDaemon).toHaveBeenNthCalledWith(1, "research.run", expect.objectContaining({
      topic: "browser automation on X",
      browserMode: "extension"
    }));
    expect(callDaemon).toHaveBeenNthCalledWith(2, "research.run", expect.objectContaining({
      topic: "browser automation on Reddit",
      browserMode: "managed"
    }));
    expect(callDaemon).toHaveBeenNthCalledWith(3, "research.run", expect.objectContaining({
      topic: "browser automation",
      browserMode: "auto"
    }));
  });

  it("forwards explicit browser-mode overrides across provider workflows", async () => {
    callDaemon.mockResolvedValue({ ok: true });

    await runProductVideoCommand(makeArgs("product-video", [
      "run",
      "--product-url=https://example.com/item",
      "--browser-mode=extension"
    ]));
    expect(callDaemon).toHaveBeenLastCalledWith("product.video.run", expect.objectContaining({
      product_url: "https://example.com/item",
      browserMode: "extension"
    }));

    await runInspiredesignCommand(makeArgs("inspiredesign", [
      "run",
      "--brief=Reference audit",
      "--browser-mode=managed"
    ]));
    expect(callDaemon).toHaveBeenLastCalledWith("inspiredesign.run", expect.objectContaining({
      brief: "Reference audit",
      browserMode: "managed"
    }));

    await runMacroResolve(makeArgs("macro-resolve", [
      "--expression=@community.search(\"openai\")",
      "--execute",
      "--browser-mode=auto"
    ]));
    expect(callDaemon).toHaveBeenLastCalledWith("macro.resolve", expect.objectContaining({
      expression: "@community.search(\"openai\")",
      browserMode: "auto"
    }));
  });

  it("surfaces provider follow-up requirements in workflow completion messages", async () => {
    callDaemon.mockResolvedValue({
      meta: {
        failures: [{
          provider: "shopping/costco",
          error: {
            code: "auth",
            reasonCode: "token_required",
            details: {
              constraint: {
                kind: "session_required",
                evidenceCode: "auth_required"
              }
            }
          }
        }]
      }
    });

    const result = await runShoppingCommand(makeArgs("shopping", [
      "run",
      "--query=wireless mouse",
      "--providers=shopping/costco"
    ]));

    expect(result.message).toBe(
      "Shopping workflow completed with provider follow-up required: Costco requires login or an existing session. Next step: Reuse an authenticated browser session, import logged-in cookies, or use the provider sign-in flow."
    );
  });

  it("prefers explicit camelCase workflow summaries in completion messages", async () => {
    callDaemon.mockResolvedValue({
      meta: {
        primaryConstraintSummary: "Manual browser follow-up is required before provider resolution can continue.",
        failures: [{
          provider: "shopping/costco",
          error: {
            code: "auth",
            reasonCode: "token_required",
            details: {
              constraint: {
                kind: "session_required",
                evidenceCode: "auth_required"
              }
            }
          }
        }]
      }
    });

    const result = await runShoppingCommand(makeArgs("shopping", [
      "run",
      "--query=wireless mouse",
      "--providers=shopping/costco"
    ]));

    expect(result.message).toBe(
      "Shopping workflow completed with provider follow-up required: Manual browser follow-up is required before provider resolution can continue. Next step: Reuse an authenticated browser session, import logged-in cookies, or use the provider sign-in flow."
    );
  });

  it("appends the first explicit workflow guidance step when primary constraint guidance is present", async () => {
    callDaemon.mockResolvedValue({
      meta: {
        primaryConstraintSummary: "Manual browser follow-up is required before provider resolution can continue.",
        primaryConstraint: {
          summary: "Manual browser follow-up is required before provider resolution can continue.",
          guidance: {
            reason: "The provider still needs a rendered browser page.",
            recommendedNextCommands: [
              "Retry with browser assistance or a headed browser session.",
              "Rerun the same provider or workflow after the rendered page is ready."
            ]
          }
        }
      }
    });

    const result = await runShoppingCommand(makeArgs("shopping", [
      "run",
      "--query=wireless mouse",
      "--providers=shopping/costco"
    ]));

    expect(result.message).toBe(
      "Shopping workflow completed with provider follow-up required: Manual browser follow-up is required before provider resolution can continue. Next step: Retry with browser assistance or a headed browser session."
    );
  });

  it("supports explicit timeout for macro-resolve execution", async () => {
    callDaemon.mockResolvedValue({ ok: true });

    await runMacroResolve(makeArgs("macro-resolve", [
      "--expression=@media.search(\"browser automation x\", \"x\", 5)",
      "--execute",
      "--timeout-ms=45000"
    ]));

    expect(callDaemon).toHaveBeenCalledWith("macro.resolve", {
      expression: "@media.search(\"browser automation x\", \"x\", 5)",
      defaultProvider: undefined,
      includeCatalog: false,
      execute: true,
      timeoutMs: 45000
    }, {
      timeoutMs: 120000
    });
  });

  it("parses and dispatches inspiredesign run payload with repeated urls", async () => {
    callDaemon.mockResolvedValue({ ok: true });

    await runInspiredesignCommand(makeArgs("inspiredesign", [
      "run",
      "--brief=Build a docs landing page contract",
      "--url=https://example.com/a",
      "--url=https://example.com/b",
      "--capture-mode=deep",
      "--include-prototype-guidance",
      "--mode=md"
    ]));

    expect(callDaemon).toHaveBeenCalledWith("inspiredesign.run", {
      brief: "Build a docs landing page contract",
      urls: ["https://example.com/a", "https://example.com/b"],
      captureMode: "deep",
      includePrototypeGuidance: true,
      mode: "md",
      timeoutMs: DEFAULT_WORKFLOW_TRANSPORT_TIMEOUT_MS,
      outputDir: undefined,
      ttlHours: undefined,
      useCookies: undefined,
      challengeAutomationMode: undefined,
      cookiePolicyOverride: undefined
    });
  });

  it("defaults inspiredesign capture mode to off when no urls are supplied", async () => {
    callDaemon.mockResolvedValue({ ok: true });

    await runInspiredesignCommand(makeArgs("inspiredesign", [
      "run",
      "--brief=Design system baseline"
    ]));

    expect(callDaemon).toHaveBeenCalledWith("inspiredesign.run", expect.objectContaining({
      brief: "Design system baseline",
      captureMode: "off",
      mode: "compact"
    }));
  });

  it("forces inspiredesign capture mode to deep when urls are supplied", async () => {
    callDaemon.mockResolvedValue({ ok: true });

    await runInspiredesignCommand(makeArgs("inspiredesign", [
      "run",
      "--brief=Design system baseline",
      "--url=https://example.com/reference"
    ]));

    expect(callDaemon).toHaveBeenCalledWith("inspiredesign.run", expect.objectContaining({
      brief: "Design system baseline",
      urls: ["https://example.com/reference"],
      captureMode: "deep",
      mode: "compact"
    }));
  });

  it("overrides explicit off capture mode to deep when urls are supplied", async () => {
    callDaemon.mockResolvedValue({ ok: true });

    await runInspiredesignCommand(makeArgs("inspiredesign", [
      "run",
      "--brief=Design system baseline",
      "--url=https://example.com/reference",
      "--capture-mode=off"
    ]));

    expect(callDaemon).toHaveBeenCalledWith("inspiredesign.run", expect.objectContaining({
      brief: "Design system baseline",
      urls: ["https://example.com/reference"],
      captureMode: "deep",
      mode: "compact"
    }));
  });

  it("surfaces inspiredesign success follow-through guidance", async () => {
    callDaemon.mockResolvedValue({
      followthroughSummary: buildInspiredesignFollowthroughSummary(),
      suggestedNextAction: buildInspiredesignNextStep()
    });

    const result = await runInspiredesignCommand(makeArgs("inspiredesign", [
      "run",
      "--brief=Design system baseline"
    ]));

    expect(result).toEqual({
      success: true,
      message: `Inspiredesign workflow completed. ${buildInspiredesignFollowthroughSummary()} Next step: ${buildInspiredesignNextStep()}`,
      data: {
        followthroughSummary: buildInspiredesignFollowthroughSummary(),
        suggestedNextAction: buildInspiredesignNextStep()
      }
    });
  });

  it("surfaces inspiredesign provider follow-up requirements before generic follow-through", async () => {
    callDaemon.mockResolvedValue({
      followthroughSummary: buildInspiredesignFollowthroughSummary(),
      suggestedNextAction: buildInspiredesignNextStep(),
      meta: {
        primaryConstraintSummary: "Deep capture failed for 1 reference.",
        primaryConstraint: {
          guidance: {
            recommendedNextCommands: [
              "Retry deep capture for https://example.com/reference after restoring the required browser session state."
            ]
          }
        }
      }
    });

    const result = await runInspiredesignCommand(makeArgs("inspiredesign", [
      "run",
      "--brief=Design system baseline",
      "--url=https://example.com/reference"
    ]));

    expect(result).toEqual({
      success: true,
      message: "Inspiredesign workflow completed with provider follow-up required: Deep capture failed for 1 reference. Next step: Retry deep capture for https://example.com/reference after restoring the required browser session state.",
      data: {
        followthroughSummary: buildInspiredesignFollowthroughSummary(),
        suggestedNextAction: buildInspiredesignNextStep(),
        meta: {
          primaryConstraintSummary: "Deep capture failed for 1 reference.",
          primaryConstraint: {
            guidance: {
              recommendedNextCommands: [
                "Retry deep capture for https://example.com/reference after restoring the required browser session state."
              ]
            }
          }
        }
      }
    });
  });

  it.each([
    {
      name: "research",
      label: "Research workflow",
      run: () => runResearchCommand(makeArgs("research", [
        "run",
        "--topic=browser automation"
      ]))
    },
    {
      name: "shopping",
      label: "Shopping workflow",
      run: () => runShoppingCommand(makeArgs("shopping", [
        "run",
        "--query=usb hub"
      ]))
    },
    {
      name: "product-video",
      label: "Product video asset workflow",
      run: () => runProductVideoCommand(makeArgs("product-video", [
        "run",
        "--product-name=Sample Product"
      ]))
    }
  ])("surfaces $name success follow-through guidance", async ({ label, run }) => {
    callDaemon.mockResolvedValue({
      followthroughSummary: "Review the returned bundle before publishing the workflow outcome.",
      suggestedNextAction: "Inspect the artifact path and rerun with tighter inputs if you need stronger evidence."
    });

    const result = await run();

    expect(result).toEqual({
      success: true,
      message: `${label} completed. Review the returned bundle before publishing the workflow outcome. Next step: Inspect the artifact path and rerun with tighter inputs if you need stronger evidence.`,
      data: {
        followthroughSummary: "Review the returned bundle before publishing the workflow outcome.",
        suggestedNextAction: "Inspect the artifact path and rerun with tighter inputs if you need stronger evidence."
      }
    });
  });

  it("parses and dispatches product-video run payload", async () => {
    callDaemon.mockResolvedValue({ ok: true });

    await runProductVideoCommand(makeArgs("product-video", [
      "run",
      "--product-name=Sample Product",
      "--provider-hint=shopping/amazon",
      "--include-screenshots=false",
      "--include-all-images=true",
      "--include-copy=false",
      "--output-dir=/tmp/assets",
      "--ttl-hours=48"
    ]));

    expect(callDaemon).toHaveBeenCalledWith("product.video.run", {
      product_url: undefined,
      product_name: "Sample Product",
      provider_hint: "shopping/amazon",
      include_screenshots: false,
      include_all_images: true,
      include_copy: false,
      output_dir: "/tmp/assets",
      ttl_hours: 48,
      timeoutMs: 120000,
      browserMode: undefined,
      useCookies: undefined,
      challengeAutomationMode: undefined,
      cookiePolicyOverride: undefined
    });
  });

  it("supports explicit timeout for product-video workflows", async () => {
    callDaemon.mockResolvedValue({ ok: true });

    await runProductVideoCommand(makeArgs("product-video", [
      "run",
      "--product-url=https://example.com/item",
      "--timeout-ms=45000"
    ]));

    expect(callDaemon).toHaveBeenCalledWith("product.video.run", {
      product_url: "https://example.com/item",
      product_name: undefined,
      provider_hint: undefined,
      include_screenshots: undefined,
      include_all_images: undefined,
      include_copy: undefined,
      output_dir: undefined,
      ttl_hours: undefined,
      timeoutMs: 45000,
      browserMode: undefined,
      useCookies: undefined,
      challengeAutomationMode: undefined,
      cookiePolicyOverride: undefined
    });
  });

  it("parses workflow cookie overrides and forwards them", async () => {
    callDaemon.mockResolvedValue({ ok: true });

    await runResearchCommand(makeArgs("research", [
      "run",
      "--topic=cookie routing",
      "--use-cookies=false",
      "--cookie-policy-override=required"
    ]));
    expect(callDaemon).toHaveBeenLastCalledWith("research.run", expect.objectContaining({
      topic: "cookie routing",
      useCookies: false,
      cookiePolicyOverride: "required"
    }));

    await runShoppingCommand(makeArgs("shopping", [
      "run",
      "--query=wireless keyboard",
      "--use-cookies",
      "--cookie-policy=auto"
    ]));
    expect(callDaemon).toHaveBeenLastCalledWith("shopping.run", expect.objectContaining({
      query: "wireless keyboard",
      useCookies: true,
      cookiePolicyOverride: "auto"
    }), {
      timeoutMs: 180000
    });

    await runProductVideoCommand(makeArgs("product-video", [
      "run",
      "--product-name=Device",
      "--use-cookies=false",
      "--cookie-policy-override=off"
    ]));
    expect(callDaemon).toHaveBeenLastCalledWith("product.video.run", expect.objectContaining({
      product_name: "Device",
      useCookies: false,
      cookiePolicyOverride: "off"
    }));
  });

  it("propagates challengeAutomationMode across workflow commands", async () => {
    callDaemon.mockResolvedValue({ ok: true });

    await runResearchCommand(makeArgs("research", [
      "run",
      "--topic=browser automation",
      "--challenge-automation-mode=browser_with_helper"
    ]));
    expect(callDaemon).toHaveBeenLastCalledWith("research.run", expect.objectContaining({
      topic: "browser automation",
      challengeAutomationMode: "browser_with_helper"
    }));

    await runShoppingCommand(makeArgs("shopping", [
      "run",
      "--query=wireless keyboard",
      "--challenge-automation-mode",
      "browser"
    ]));
    expect(callDaemon).toHaveBeenLastCalledWith("shopping.run", expect.objectContaining({
      query: "wireless keyboard",
      challengeAutomationMode: "browser"
    }), {
      timeoutMs: 180000
    });

    await runProductVideoCommand(makeArgs("product-video", [
      "run",
      "--product-url=https://example.com/item",
      "--challenge-automation-mode",
      "off"
    ]));
    expect(callDaemon).toHaveBeenLastCalledWith("product.video.run", expect.objectContaining({
      product_url: "https://example.com/item",
      challengeAutomationMode: "off"
    }));
  });

  it("enforces run subcommand and required input", async () => {
    await expect(runResearchCommand(makeArgs("research", ["status"]))).rejects.toThrow("Usage: opendevbrowser research run");
    await expect(runResearchCommand(makeArgs("research", ["run", "--topic=browser", "--browser-mode=bad"]))).rejects.toThrow("Invalid --browser-mode: bad");
    await expect(runShoppingCommand(makeArgs("shopping", ["run"]))).rejects.toThrow("Missing --query");
    await expect(runShoppingCommand(makeArgs("shopping", ["run", "--query=macbook", "--browser-mode=bad"]))).rejects.toThrow("Invalid --browser-mode: bad");
    await expect(runProductVideoCommand(makeArgs("product-video", ["run", "--product-url=https://example.com", "--browser-mode=bad"]))).rejects.toThrow("Invalid --browser-mode: bad");
    await expect(runInspiredesignCommand(makeArgs("inspiredesign", ["run", "--brief=Design system", "--browser-mode=bad"]))).rejects.toThrow("Invalid --browser-mode: bad");
    await expect(runMacroResolve(makeArgs("macro-resolve", ["--expression=@web.search(\"x\")", "--browser-mode=bad"]))).rejects.toThrow("Invalid --browser-mode: bad");
    await expect(runMacroResolve(makeArgs("macro-resolve", ["--expression=@web.search(\"x\")", "--browser-mode=managed"]))).rejects.toThrow("--browser-mode requires --execute for macro-resolve");
    await expect(runMacroResolve(makeArgs("macro-resolve", ["--expression=@web.search(\"x\")", "--challenge-automation-mode=browser"]))).rejects.toThrow("--challenge-automation-mode requires --execute for macro-resolve");
    await expect(runProductVideoCommand(makeArgs("product-video", ["run"]))).rejects.toThrow("Missing --product-url or --product-name");
    await expect(runInspiredesignCommand(makeArgs("inspiredesign", ["run"]))).rejects.toThrow("Missing --brief");
    await expect(runInspiredesignCommand(makeArgs("inspiredesign", ["run", "--brief=Design system", "--capture-mode=wrong"]))).rejects.toThrow("Invalid --capture-mode: wrong");
  });
});
