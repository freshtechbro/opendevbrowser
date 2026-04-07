import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("playwright runtime loading", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.resetModules();
    vi.unmock("playwright-core");
  });

  it("does not load playwright-core during BrowserManager construction", async () => {
    vi.doMock("playwright-core", () => {
      throw new Error("playwright-core should not load during BrowserManager construction");
    });

    const [{ BrowserManager }, { resolveConfig }] = await Promise.all([
      import("../src/browser/browser-manager"),
      import("../src/config")
    ]);

    expect(() => new BrowserManager("/tmp/project", resolveConfig({}))).not.toThrow();
  });

  it("wraps playwright integrity failures with remediation guidance", async () => {
    vi.doMock("playwright-core", () => {
      throw new Error("Cannot find module './registry'");
    });

    const { loadChromium } = await import("../src/browser/playwright-runtime");

    await expect(loadChromium()).rejects.toThrow(
      "Failed to load playwright-core. The local install appears incomplete or corrupted"
    );
    await expect(loadChromium()).rejects.toThrow("Repair with `npm install`, `npm ci`, or by reinstalling `playwright-core`.");
  });

  it("memoizes successful playwright-core loads", async () => {
    const chromium = {
      launchPersistentContext: vi.fn(),
      connectOverCDP: vi.fn()
    };
    const playwrightFactory = vi.fn(() => ({ chromium }));
    vi.doMock("playwright-core", playwrightFactory);

    const { loadChromium } = await import("../src/browser/playwright-runtime");

    await expect(loadChromium()).resolves.toBe(chromium);
    await expect(loadChromium()).resolves.toBe(chromium);
    expect(playwrightFactory).toHaveBeenCalledTimes(1);
  });

  it("wraps non-Error playwright load failures", async () => {
    const { createPlaywrightIntegrityError } = await import("../src/browser/playwright-runtime");

    const error = createPlaywrightIntegrityError("registry missing");

    expect(error.message).toContain("registry missing");
    expect(error.message).toContain("Repair with `npm install`, `npm ci`, or by reinstalling `playwright-core`.");
    expect(error.cause).toBeUndefined();
  });

  it("falls back to an unknown-error label when the load failure is missing", async () => {
    const { createPlaywrightIntegrityError } = await import("../src/browser/playwright-runtime");

    const error = createPlaywrightIntegrityError(undefined);

    expect(error.message).toContain("unknown error");
    expect(error.cause).toBeUndefined();
  });

  it("preserves the original Error as the integrity failure cause", async () => {
    const { createPlaywrightIntegrityError } = await import("../src/browser/playwright-runtime");
    const original = new Error("registry missing");

    const error = createPlaywrightIntegrityError(original);

    expect(error.message).toContain("registry missing");
    expect(error.cause).toBe(original);
  });
});
