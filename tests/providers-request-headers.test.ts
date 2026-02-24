import { afterEach, describe, expect, it, vi } from "vitest";

const loadHeaders = async () => {
  vi.resetModules();
  return await import("../src/providers/shared/request-headers");
};

describe("provider request headers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("uses browser-like defaults when overrides are unset", async () => {
    const module = await loadHeaders();
    expect(module.providerRequestHeaders["user-agent"]).toContain("Mozilla/5.0");
    expect(module.providerRequestHeaders["accept-language"]).toBe("en-US,en;q=0.9");
  });

  it("uses OPDEVBROWSER_PROVIDER_* overrides when configured", async () => {
    vi.stubEnv("OPDEVBROWSER_PROVIDER_USER_AGENT", "OpenDevBrowser-Test-UA/1.0");
    vi.stubEnv("OPDEVBROWSER_PROVIDER_ACCEPT_LANGUAGE", "fr-FR,fr;q=0.7");

    const module = await loadHeaders();
    expect(module.providerRequestHeaders["user-agent"]).toBe("OpenDevBrowser-Test-UA/1.0");
    expect(module.providerRequestHeaders["accept-language"]).toBe("fr-FR,fr;q=0.7");
  });
});

