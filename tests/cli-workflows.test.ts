import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedArgs } from "../src/cli/args";
import { runMacroResolve } from "../src/cli/commands/macro-resolve";
import { runProductVideoCommand } from "../src/cli/commands/product-video";
import { runResearchCommand } from "../src/cli/commands/research";
import { runShoppingCommand } from "../src/cli/commands/shopping";
import { DEFAULT_WORKFLOW_TRANSPORT_TIMEOUT_MS } from "../src/cli/transport-timeouts";

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
      useCookies: undefined,
      cookiePolicyOverride: undefined
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
    }));
    expect(callDaemon).toHaveBeenNthCalledWith(2, "shopping.run", expect.objectContaining({
      query: "macbook pro m4 32gb ram",
      browserMode: "managed"
    }));
    expect(callDaemon).toHaveBeenNthCalledWith(3, "shopping.run", expect.objectContaining({
      query: "macbook pro m4 32gb ram",
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
      "Shopping workflow completed with provider follow-up required: Costco requires login or an existing session."
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
      "Shopping workflow completed with provider follow-up required: Manual browser follow-up is required before provider resolution can continue."
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
      timeoutMs: 45000
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
      useCookies: undefined,
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
      useCookies: undefined,
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
    }));

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
    }));

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
    await expect(runShoppingCommand(makeArgs("shopping", ["run"]))).rejects.toThrow("Missing --query");
    await expect(runShoppingCommand(makeArgs("shopping", ["run", "--query=macbook", "--browser-mode=bad"]))).rejects.toThrow("Invalid --browser-mode: bad");
    await expect(runProductVideoCommand(makeArgs("product-video", ["run"]))).rejects.toThrow("Missing --product-url or --product-name");
  });
});
