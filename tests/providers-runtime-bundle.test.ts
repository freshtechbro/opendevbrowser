import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ProviderRuntimeBundleConfig } from "../src/providers/runtime-bundle";
import type { BrowserFallbackPort } from "../src/providers/types";

const runtimeFactoryMocks = vi.hoisted(() => ({
  createBrowserFallbackPort: vi.fn<((
    manager?: unknown,
    cookieConfig?: unknown,
    transportConfig?: unknown,
    challengeOrchestrator?: unknown,
    challengeMode?: unknown,
    helperBridgeEnabled?: unknown
  ) => BrowserFallbackPort | undefined)>(),
  createConfiguredProviderRuntime: vi.fn()
}));

vi.mock("../src/providers/runtime-factory", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/providers/runtime-factory")>();
  return {
    ...actual,
    createBrowserFallbackPort: runtimeFactoryMocks.createBrowserFallbackPort,
    createConfiguredProviderRuntime: runtimeFactoryMocks.createConfiguredProviderRuntime
  };
});

import { buildRuntimeInitFromConfig } from "../src/providers/runtime-factory";
import { createProviderRuntimeBundle, resolveBundledProviderRuntime } from "../src/providers/runtime-bundle";

const makeConfig = (
  overrides: Partial<NonNullable<ProviderRuntimeBundleConfig["providers"]>> = {}
): ProviderRuntimeBundleConfig => ({
  blockerDetectionThreshold: 0.7,
  security: {
    allowRawCDP: false,
    allowNonLocalCdp: false,
    allowUnsafeExport: false,
    promptInjectionGuard: { enabled: true }
  },
  providers: {
    tiers: {
      default: "A",
      enableHybrid: false,
      enableRestrictedSafe: false,
      hybridRiskThreshold: 0.6,
      restrictedSafeRecoveryIntervalMs: 60_000
    },
    adaptiveConcurrency: {
      enabled: false,
      maxGlobal: 8,
      maxPerDomain: 4
    },
    crawler: {
      workerThreads: 4,
      queueMax: 2000
    },
    antiBotPolicy: {
      enabled: true,
      cooldownMs: 30_000,
      maxChallengeRetries: 1,
      allowBrowserEscalation: false
    },
    challengeOrchestration: {
      mode: "off",
      maxRuntimeRetries: 0,
      noProgressLimit: 1,
      verifyAfterEveryStep: true,
      stepTimeoutMs: 10_000,
      minAttemptGapMs: 250,
      allowAuthNavigation: false,
      allowSessionReuse: false,
      allowCookieReuse: false,
      allowNonSecretFormFill: false,
      allowInteractionExploration: false,
      governed: {
        allowOwnedEnvironmentFixtures: false,
        allowSanctionedIdentity: false,
        allowServiceAdapters: false
      },
      optionalComputerUseBridge: {
        enabled: false
      }
    },
    transcript: {
      modeDefault: "auto",
      strategyOrder: ["native_caption_parse"],
      enableYtdlp: false,
      enableAsr: false,
      enableYtdlpAudioAsr: false,
      enableApify: false,
      apifyActorId: "streamers/youtube-scraper",
      enableBrowserFallback: false,
      ytdlpTimeoutMs: 10_000
    },
    ...overrides
  },
  relayPort: 8787,
  relayToken: false
});

const makeFallbackPort = (): BrowserFallbackPort => ({
  resolve: vi.fn(async () => {
    throw new Error("Browser fallback should not be used in this unit test.");
  })
});

const makeProviderRuntime = () => ({
  search: vi.fn(),
  fetch: vi.fn(),
  crawl: vi.fn(),
  post: vi.fn()
});

describe("provider runtime bundle", () => {
  beforeEach(() => {
    runtimeFactoryMocks.createBrowserFallbackPort.mockReset();
    runtimeFactoryMocks.createConfiguredProviderRuntime.mockReset();
    runtimeFactoryMocks.createBrowserFallbackPort.mockReturnValue(makeFallbackPort());
    runtimeFactoryMocks.createConfiguredProviderRuntime.mockReturnValue(makeProviderRuntime());
  });

  it("derives challenge config from config when callers omit an explicit threaded override", () => {
    const config = makeConfig();

    createProviderRuntimeBundle({
      config
    });

    expect(runtimeFactoryMocks.createBrowserFallbackPort).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({
        policy: undefined,
        source: undefined
      }),
      expect.any(Object),
      expect.any(Object),
      "off",
      false
    );
    expect(runtimeFactoryMocks.createConfiguredProviderRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        config,
        challengeConfig: config.providers?.challengeOrchestration
      })
    );
  });

  it("preserves an explicit challenge config override above config defaults", () => {
    const config = makeConfig();
    const challengeConfig = {
      ...config.providers!.challengeOrchestration,
      mode: "browser_with_helper",
      optionalComputerUseBridge: { enabled: true }
    };

    createProviderRuntimeBundle({
      config,
      challengeConfig
    });

    expect(runtimeFactoryMocks.createBrowserFallbackPort).toHaveBeenCalledWith(
      undefined,
      expect.any(Object),
      expect.any(Object),
      expect.any(Object),
      "browser_with_helper",
      true
    );
    expect(runtimeFactoryMocks.createConfiguredProviderRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        config,
        challengeConfig
      })
    );
  });

  it("uses config challenge orchestration defaults when runtime init is built without an explicit threaded config", () => {
    const config = makeConfig();

    const runtimeInit = buildRuntimeInitFromConfig(config);

    expect(runtimeInit.challengeAutomationModeDefault).toBe("off");
  });

  it("reuses a bundled runtime when the effective config-backed challenge policy is unchanged", () => {
    const config = makeConfig();
    const existingRuntime = createProviderRuntimeBundle({ config }).providerRuntime;

    runtimeFactoryMocks.createConfiguredProviderRuntime.mockClear();

    const resolved = resolveBundledProviderRuntime({
      config,
      existingRuntime
    });

    expect(resolved).toBe(existingRuntime);
    expect(runtimeFactoryMocks.createConfiguredProviderRuntime).not.toHaveBeenCalled();
  });

  it("rebuilds a reused runtime when config-backed challenge policy changes without an explicit override", () => {
    const originalConfig = makeConfig();
    const existingRuntime = createProviderRuntimeBundle({ config: originalConfig }).providerRuntime;
    const updatedConfig = makeConfig({
      challengeOrchestration: {
        ...originalConfig.providers!.challengeOrchestration,
        mode: "browser_with_helper",
        optionalComputerUseBridge: { enabled: true }
      }
    });
    const rebuiltRuntime = makeProviderRuntime();

    runtimeFactoryMocks.createBrowserFallbackPort.mockClear();
    runtimeFactoryMocks.createConfiguredProviderRuntime.mockReset();
    runtimeFactoryMocks.createConfiguredProviderRuntime.mockReturnValue(rebuiltRuntime);

    const resolved = resolveBundledProviderRuntime({
      config: updatedConfig,
      existingRuntime
    });

    expect(resolved).toBe(rebuiltRuntime);
    expect(runtimeFactoryMocks.createConfiguredProviderRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        config: updatedConfig,
        challengeConfig: updatedConfig.providers?.challengeOrchestration
      })
    );
  });

  it("reuses a stamped browser fallback port when a runtime rebuild keeps the same challenge policy", () => {
    const config = makeConfig();
    const fallbackPort = makeFallbackPort();
    const rebuiltRuntime = makeProviderRuntime();
    runtimeFactoryMocks.createBrowserFallbackPort.mockReturnValue(fallbackPort);
    createProviderRuntimeBundle({ config });

    runtimeFactoryMocks.createBrowserFallbackPort.mockClear();
    runtimeFactoryMocks.createConfiguredProviderRuntime.mockReset();
    runtimeFactoryMocks.createConfiguredProviderRuntime.mockReturnValue(rebuiltRuntime);

    const resolved = resolveBundledProviderRuntime({
      config,
      existingRuntime: makeProviderRuntime(),
      browserFallbackPort: fallbackPort,
      init: { timeoutMs: 5000 }
    });

    expect(resolved).toBe(rebuiltRuntime);
    expect(runtimeFactoryMocks.createBrowserFallbackPort).not.toHaveBeenCalled();
    expect(runtimeFactoryMocks.createConfiguredProviderRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        browserFallbackPort: fallbackPort
      })
    );
  });

  it("rebuilds a stamped browser fallback port when the effective challenge policy changes", () => {
    const originalConfig = makeConfig();
    const originalFallbackPort = makeFallbackPort();
    const rebuiltFallbackPort = makeFallbackPort();
    runtimeFactoryMocks.createBrowserFallbackPort
      .mockReturnValueOnce(originalFallbackPort)
      .mockReturnValueOnce(rebuiltFallbackPort);
    const existingRuntime = createProviderRuntimeBundle({ config: originalConfig }).providerRuntime;
    const updatedConfig = makeConfig({
      challengeOrchestration: {
        ...originalConfig.providers!.challengeOrchestration,
        mode: "browser_with_helper",
        optionalComputerUseBridge: { enabled: true }
      }
    });
    const rebuiltRuntime = makeProviderRuntime();

    runtimeFactoryMocks.createBrowserFallbackPort.mockClear();
    runtimeFactoryMocks.createConfiguredProviderRuntime.mockReset();
    runtimeFactoryMocks.createConfiguredProviderRuntime.mockReturnValue(rebuiltRuntime);

    const resolved = resolveBundledProviderRuntime({
      config: updatedConfig,
      existingRuntime,
      browserFallbackPort: originalFallbackPort
    });

    expect(resolved).toBe(rebuiltRuntime);
    expect(runtimeFactoryMocks.createBrowserFallbackPort).toHaveBeenCalledTimes(1);
    expect(runtimeFactoryMocks.createConfiguredProviderRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        browserFallbackPort: rebuiltFallbackPort,
        challengeConfig: updatedConfig.providers?.challengeOrchestration
      })
    );
  });

  it("rebuilds an unstamped browser fallback port when relay transport becomes available", () => {
    const config = {
      ...makeConfig(),
      relayToken: "test-token"
    };
    const originalFallbackPort = makeFallbackPort();
    const rebuiltFallbackPort = makeFallbackPort();
    const rebuiltRuntime = makeProviderRuntime();
    runtimeFactoryMocks.createBrowserFallbackPort.mockReturnValue(rebuiltFallbackPort);
    runtimeFactoryMocks.createConfiguredProviderRuntime.mockReturnValue(rebuiltRuntime);

    const resolved = resolveBundledProviderRuntime({
      config,
      existingRuntime: makeProviderRuntime(),
      browserFallbackPort: originalFallbackPort,
      init: { timeoutMs: 5000 }
    });

    expect(resolved).toBe(rebuiltRuntime);
    expect(runtimeFactoryMocks.createBrowserFallbackPort).toHaveBeenCalledWith(
      undefined,
      expect.any(Object),
      { extensionWsEndpoint: "ws://127.0.0.1:8787" },
      expect.any(Object),
      "off",
      false
    );
    expect(runtimeFactoryMocks.createConfiguredProviderRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        browserFallbackPort: rebuiltFallbackPort
      })
    );
  });

  it("rebuilds a reused runtime when callers thread an explicit challenge config override", () => {
    const config = makeConfig();
    const existingRuntime = makeProviderRuntime();
    const rebuiltRuntime = makeProviderRuntime();
    const challengeConfig = {
      ...config.providers!.challengeOrchestration,
      mode: "browser_with_helper",
      optionalComputerUseBridge: { enabled: true }
    };
    runtimeFactoryMocks.createConfiguredProviderRuntime.mockReturnValue(rebuiltRuntime);

    const resolved = resolveBundledProviderRuntime({
      config,
      existingRuntime,
      challengeConfig
    });

    expect(resolved).toBe(rebuiltRuntime);
    expect(runtimeFactoryMocks.createConfiguredProviderRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        config,
        challengeConfig
      })
    );
  });

  it("reuses an unstamped injected runtime even when config-backed challenge policy is present", () => {
    const config = makeConfig();
    const existingRuntime = makeProviderRuntime();

    runtimeFactoryMocks.createConfiguredProviderRuntime.mockReset();

    const resolved = resolveBundledProviderRuntime({
      config,
      existingRuntime
    });

    expect(resolved).toBe(existingRuntime);
    expect(runtimeFactoryMocks.createConfiguredProviderRuntime).not.toHaveBeenCalled();
  });
});
