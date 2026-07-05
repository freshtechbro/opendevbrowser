import type { BrowserManagerLike } from "../browser/manager-types";
import type { ChallengeOrchestrator } from "../challenges";
import type {
  OpenDevBrowserConfig,
  ProvidersChallengeOrchestrationConfig
} from "../config";
import { createDesktopRuntime, type DesktopRuntimeLike } from "../desktop";
import { createProviderRuntimeBundle, type BundledProviderRuntime } from "../providers/runtime-bundle";
import type { BrowserFallbackPort } from "../providers/types";
import {
  createAutomationCoordinator,
  type AutomationCoordinatorLike
} from "../automation/coordinator";
import type { RelayStatus } from "../relay/relay-server";

type CreateCoreRuntimeAssembliesArgs = {
  cacheRoot: string;
  config: OpenDevBrowserConfig;
  manager: BrowserManagerLike;
  challengeConfig: ProvidersChallengeOrchestrationConfig;
  challengeOrchestrator?: ChallengeOrchestrator;
  relayStatus?: () => RelayStatus | null;
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
  const { challengeConfig } = args;
  const { providerRuntime, browserFallbackPort } = createProviderRuntimeBundle({
    config: args.config,
    manager: args.manager,
    challengeConfig,
    challengeOrchestrator: args.challengeOrchestrator
  });
  const desktopRuntime = createDesktopRuntime({
    cacheRoot: args.cacheRoot,
    config: args.config.desktop
  });
  const automationCoordinator = createAutomationCoordinator({
    manager: args.manager,
    desktopRuntime,
    challengeMode: challengeConfig.mode,
    governedLanes: challengeConfig.governed,
    helperBridgeEnabled: challengeConfig.optionalComputerUseBridge.enabled,
    snapshotMaxChars: args.config.snapshot.maxChars,
    mediaAnalysisConfig: args.config.inspiredesign.mediaAnalysis,
    ...(args.relayStatus ? { relayStatus: args.relayStatus } : {})
  });

  return {
    providerRuntime,
    ...(browserFallbackPort ? { browserFallbackPort } : {}),
    desktopRuntime,
    automationCoordinator
  };
}
