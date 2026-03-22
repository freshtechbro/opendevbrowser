import { z } from "zod";
import type { CanvasAdapterPluginDeclaration, CanvasAdapterPluginManifest } from "./types";
import { CODE_SYNC_CAPABILITIES } from "../code-sync/types";

const capabilitySchema = z.enum(CODE_SYNC_CAPABILITIES);

const frameworkDescriptorSchema = z.object({
  id: z.string().min(1),
  sourceFamily: z.string().min(1),
  adapterKind: z.string().min(1),
  adapterVersion: z.number().int().min(1),
  moduleExport: z.string().min(1),
  capabilities: z.array(capabilitySchema).default([]),
  fileMatchers: z.array(z.string().min(1)).optional()
});

const libraryDescriptorSchema = z.object({
  id: z.string().min(1),
  frameworkId: z.string().min(1),
  kind: z.string().min(1),
  resolutionStrategy: z.enum(["import", "tag"]),
  moduleExport: z.string().min(1),
  capabilities: z.array(capabilitySchema).default([]),
  packages: z.array(z.string().min(1)).optional()
});

export const canvasAdapterPluginManifestSchema = z.object({
  schemaVersion: z.string().min(1),
  adapterApiVersion: z.string().min(1),
  pluginId: z.string().min(1),
  displayName: z.string().min(1),
  version: z.string().min(1),
  engine: z.object({
    opendevbrowser: z.string().min(1)
  }),
  entry: z.string().min(1),
  moduleFormat: z.literal("esm"),
  frameworkAdapters: z.array(frameworkDescriptorSchema).default([]),
  libraryAdapters: z.array(libraryDescriptorSchema).default([]),
  capabilities: z.array(capabilitySchema).default([]),
  fixtureDir: z.string().min(1),
  trustedWorkspaceRoots: z.array(z.string().min(1)).default([]),
  packageRoot: z.string().min(1),
  sdkImport: z.string().min(1)
});

export function normalizeCanvasAdapterPluginDeclaration(value: CanvasAdapterPluginDeclaration): Exclude<CanvasAdapterPluginDeclaration, string> & { ref: string } {
  if (typeof value === "string") {
    return { ref: value, enabled: true };
  }
  return {
    ref: value.ref,
    enabled: value.enabled !== false,
    ...(value.trustedWorkspaceRoots ? { trustedWorkspaceRoots: [...value.trustedWorkspaceRoots] } : {}),
    ...(value.capabilityOverrides ? { capabilityOverrides: [...value.capabilityOverrides] } : {})
  };
}

export function parseCanvasAdapterPluginManifest(input: unknown): CanvasAdapterPluginManifest {
  return canvasAdapterPluginManifestSchema.parse(input);
}
