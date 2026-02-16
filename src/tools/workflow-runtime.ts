import { createDefaultRuntime, type ProviderExecutor } from "../providers";
import type { ToolDeps } from "./deps";

export const resolveProviderRuntime = (deps: ToolDeps): ProviderExecutor => {
  if (deps.providerRuntime) {
    return deps.providerRuntime as ProviderExecutor;
  }

  const runtimeConfig = deps.config?.get?.();
  return createDefaultRuntime({}, {
    ...(typeof runtimeConfig?.blockerDetectionThreshold === "number"
      ? { blockerDetectionThreshold: runtimeConfig.blockerDetectionThreshold }
      : {}),
    promptInjectionGuard: {
      enabled: runtimeConfig?.security.promptInjectionGuard?.enabled ?? true
    }
  });
};
