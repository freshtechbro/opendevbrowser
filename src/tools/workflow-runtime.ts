import type { ProviderExecutor } from "../providers";
import { createConfiguredProviderRuntime } from "../providers/runtime-factory";
import type { ToolDeps } from "./deps";

export const resolveProviderRuntime = (deps: ToolDeps): ProviderExecutor => {
  if (deps.providerRuntime) {
    return deps.providerRuntime as ProviderExecutor;
  }

  return createConfiguredProviderRuntime({
    config: deps.config?.get?.(),
    manager: deps.manager,
    browserFallbackPort: deps.browserFallbackPort
  });
};
