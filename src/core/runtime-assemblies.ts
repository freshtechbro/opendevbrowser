import type { BrowserManagerLike } from "../browser/manager-types";
import type { ChallengeOrchestrator } from "../challenges";
import type { OpenDevBrowserConfig } from "../config";
import { createDesktopRuntime, type DesktopRuntimeLike } from "../desktop";
import { createProviderRuntimeBundle, type BundledProviderRuntime } from "../providers/runtime-bundle";
import type { BrowserFallbackPort } from "../providers/types";
import {
  createAutomationCoordinator,
  type AutomationCoordinatorLike
} from "../automation/coordinator";

type CreateCoreRuntimeAssembliesArgs = {
  cacheRoot: string;
  config: OpenDevBrowserConfig;
  manager: BrowserManagerLike;
  challengeOrchestrator?: ChallengeOrchestrator;
};

type CoreRuntimeAssemblies = {
  providerRuntime: BundledProviderRuntime;
  browserFallbackPort?: BrowserFallbackPort;
  desktopRuntime: DesktopRuntimeLike;
  automationCoordinator: AutomationCoordinatorLike;
};

export function createCoreRuntimeAssemblies(
  args: CreateCoreRuntimeAssembliesArgs
): CoreRuntimeAssemblies {
  const { providerRuntime, browserFallbackPort } = createProviderRuntimeBundle({
    config: args.config,
    manager: args.manager,
    challengeOrchestrator: args.challengeOrchestrator
  });
  const desktopRuntime = createDesktopRuntime({
    cacheRoot: args.cacheRoot,
    config: args.config.desktop
  });
  const automationCoordinator = createAutomationCoordinator({
    manager: args.manager,
    desktopRuntime
  });

  return {
    providerRuntime,
    ...(browserFallbackPort ? { browserFallbackPort } : {}),
    desktopRuntime,
    automationCoordinator
  };
}
