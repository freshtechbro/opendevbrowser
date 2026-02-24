import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedArgs } from "../src/cli/args";
import { runProductVideoCommand } from "../src/cli/commands/product-video";
import { runResearchCommand } from "../src/cli/commands/research";
import { runShoppingCommand } from "../src/cli/commands/shopping";

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
      outputDir: "/tmp/out",
      ttlHours: 72,
      useCookies: undefined,
      cookiePolicyOverride: undefined
    });
    expect(result).toMatchObject({ success: true });
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
      useCookies: undefined,
      cookiePolicyOverride: undefined
    }, {
      timeoutMs: 120000
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
      useCookies: undefined,
      cookiePolicyOverride: undefined
    }, {
      timeoutMs: 45000
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
    }), { timeoutMs: 120000 });
  });

  it("enforces run subcommand and required input", async () => {
    await expect(runResearchCommand(makeArgs("research", ["status"]))).rejects.toThrow("Usage: opendevbrowser research run");
    await expect(runShoppingCommand(makeArgs("shopping", ["run"]))).rejects.toThrow("Missing --query");
    await expect(runProductVideoCommand(makeArgs("product-video", ["run"]))).rejects.toThrow("Missing --product-url or --product-name");
  });
});
