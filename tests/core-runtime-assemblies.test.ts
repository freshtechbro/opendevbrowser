import { beforeEach, describe, expect, it, vi } from "vitest";

const createProviderRuntimeBundle = vi.fn();
const createDesktopRuntime = vi.fn();
const createAutomationCoordinator = vi.fn();

vi.mock("../src/providers/runtime-bundle", () => ({
  createProviderRuntimeBundle
}));

vi.mock("../src/desktop", () => ({
  createDesktopRuntime
}));

vi.mock("../src/automation/coordinator", () => ({
  createAutomationCoordinator
}));

describe("createCoreRuntimeAssemblies", () => {
  beforeEach(() => {
    createProviderRuntimeBundle.mockReset();
    createDesktopRuntime.mockReset();
    createAutomationCoordinator.mockReset();
  });

  it("assembles provider runtime, browser fallback, desktop runtime, and coordinator through one seam", async () => {
    const providerRuntime = {
      search: vi.fn(),
      fetch: vi.fn(),
      crawl: vi.fn(),
      post: vi.fn()
    };
    const browserFallbackPort = {
      resolve: vi.fn()
    };
    const desktopRuntime = {
      status: vi.fn(),
      listWindows: vi.fn(),
      activeWindow: vi.fn(),
      captureDesktop: vi.fn(),
      captureWindow: vi.fn(),
      accessibilitySnapshot: vi.fn()
    };
    const automationCoordinator = {
      desktopAvailable: vi.fn(),
      requestDesktopObservation: vi.fn(),
      verifyAfterDesktopObservation: vi.fn()
    };
    createProviderRuntimeBundle.mockReturnValue({
      providerRuntime,
      browserFallbackPort
    });
    createDesktopRuntime.mockReturnValue(desktopRuntime);
    createAutomationCoordinator.mockReturnValue(automationCoordinator);

    const { createCoreRuntimeAssemblies } = await import("../src/core/runtime-assemblies");
    const config = { desktop: { permissionLevel: "observe" } } as never;
    const manager = { status: vi.fn() } as never;
    const challengeOrchestrator = { orchestrate: vi.fn() } as never;
    const assemblies = createCoreRuntimeAssemblies({
      cacheRoot: "/tmp/opendevbrowser",
      config,
      manager,
      challengeOrchestrator
    });

    expect(createProviderRuntimeBundle).toHaveBeenCalledWith({
      config,
      manager,
      challengeOrchestrator
    });
    expect(createDesktopRuntime).toHaveBeenCalledWith({
      cacheRoot: "/tmp/opendevbrowser",
      config: config.desktop
    });
    expect(createAutomationCoordinator).toHaveBeenCalledWith({
      manager,
      desktopRuntime
    });
    expect(assemblies).toEqual({
      providerRuntime,
      browserFallbackPort,
      desktopRuntime,
      automationCoordinator
    });
  });
});
