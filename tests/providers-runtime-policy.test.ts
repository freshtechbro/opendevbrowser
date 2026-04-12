import { describe, expect, it } from "vitest";
import { resolveProviderRuntimePolicy } from "../src/providers/runtime-policy";

describe("provider runtime policy", () => {
  it("resolves browser-mode intent into fallback modes and forced transport", () => {
    const extensionPolicy = resolveProviderRuntimePolicy({
      source: "shopping",
      runtimePolicy: { browserMode: "extension" }
    });
    const managedPolicy = resolveProviderRuntimePolicy({
      source: "shopping",
      runtimePolicy: { browserMode: "managed" }
    });
    const autoPolicy = resolveProviderRuntimePolicy({
      source: "shopping",
      runtimePolicy: { browserMode: "auto" }
    });

    expect(extensionPolicy.browser).toEqual({
      preferredModes: ["extension"],
      forceTransport: true
    });
    expect(managedPolicy.browser).toEqual({
      preferredModes: ["managed_headed"],
      forceTransport: true
    });
    expect(autoPolicy.browser).toEqual({
      preferredModes: ["extension", "managed_headed"],
      forceTransport: false
    });
  });

  it("resolves cookie intent from runtime policy input", () => {
    const requiredCookies = resolveProviderRuntimePolicy({
      source: "web",
      runtimePolicy: {
        useCookies: true,
        cookiePolicyOverride: "required"
      }
    });
    const cookiesOff = resolveProviderRuntimePolicy({
      source: "web",
      runtimePolicy: {
        useCookies: false
      }
    });

    expect(requiredCookies.cookies).toEqual({
      requested: true,
      policy: "required"
    });
    expect(cookiesOff.cookies).toEqual({
      requested: false,
      policy: "off"
    });
  });

  it("downgrades requested cookies to auto when config policy is off", () => {
    const cookiesAuto = resolveProviderRuntimePolicy({
      source: "web",
      runtimePolicy: {
        useCookies: true
      },
      configCookiePolicy: "off"
    });

    expect(cookiesAuto.cookies).toEqual({
      requested: true,
      policy: "auto"
    });
  });
});
