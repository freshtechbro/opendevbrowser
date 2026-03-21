import { CUSTOM_ELEMENTS_V1_ADAPTER } from "./custom-elements-v1";
import { HTML_STATIC_V1_ADAPTER } from "./html-static-v1";
import { REACT_TSX_V2_ADAPTER } from "./react-tsx-v2";
import { SVELTE_SFC_V1_ADAPTER } from "./svelte-sfc-v1";
import type { CanvasFrameworkAdapter } from "./types";
import { VUE_SFC_V1_ADAPTER } from "./vue-sfc-v1";
import type { CanvasCodeSyncBindingMetadata } from "../code-sync/types";

export class CanvasFrameworkAdapterRegistry {
  private readonly adapters = new Map<string, CanvasFrameworkAdapter>();

  register(adapter: CanvasFrameworkAdapter): void {
    if (this.adapters.has(adapter.id)) {
      throw new Error(`duplicate_adapter_id:${adapter.id}`);
    }
    this.adapters.set(adapter.id, adapter);
  }

  get(id: string): CanvasFrameworkAdapter | null {
    return this.adapters.get(id) ?? null;
  }

  list(): CanvasFrameworkAdapter[] {
    return [...this.adapters.values()];
  }

  resolveForBinding(metadata: CanvasCodeSyncBindingMetadata): CanvasFrameworkAdapter | null {
    return this.get(metadata.frameworkAdapterId);
  }

  detectForPath(filePath: string): CanvasFrameworkAdapter | null {
    return this.list().find((adapter) => adapter.fileMatchers.some((matcher) => matcher.test(filePath))) ?? null;
  }
}

export function createFrameworkAdapterRegistry(): CanvasFrameworkAdapterRegistry {
  const registry = new CanvasFrameworkAdapterRegistry();
  for (const adapter of [
    REACT_TSX_V2_ADAPTER,
    HTML_STATIC_V1_ADAPTER,
    CUSTOM_ELEMENTS_V1_ADAPTER,
    VUE_SFC_V1_ADAPTER,
    SVELTE_SFC_V1_ADAPTER
  ]) {
    registry.register(adapter);
  }
  return registry;
}
