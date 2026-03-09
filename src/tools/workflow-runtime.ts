import type { ToolDeps } from "./deps";

export const resolveProviderRuntime = async (deps: ToolDeps): Promise<NonNullable<ToolDeps["providerRuntime"]>> => {
  if (deps.providerRuntime) {
    return deps.providerRuntime;
  }

  const { createConfiguredProviderRuntime } = await import("../providers/runtime-factory");
  return createConfiguredProviderRuntime({
    config: deps.config?.get?.(),
    manager: deps.manager,
    browserFallbackPort: deps.browserFallbackPort
  });
};
