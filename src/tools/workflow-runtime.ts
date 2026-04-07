import type { ToolDeps } from "./deps";
import type { RuntimeInit } from "../providers";
import { resolveBundledProviderRuntime } from "../providers/runtime-bundle";

export const resolveProviderRuntime = async (
  deps: ToolDeps,
  options?: { init?: Omit<RuntimeInit, "providers"> }
): Promise<NonNullable<ToolDeps["providerRuntime"]>> => {
  return resolveBundledProviderRuntime({
    existingRuntime: deps.providerRuntime,
    config: deps.config?.get?.(),
    manager: deps.manager,
    browserFallbackPort: deps.browserFallbackPort,
    init: options?.init
  });
};
