import { describe, expect, it } from "vitest";
import { buildPublicSurfaceManifest, PUBLIC_SURFACE_MANIFEST_SCHEMA_VERSION as SOURCE_SCHEMA_VERSION } from "../src/public-surface/source";
import {
  PUBLIC_SURFACE_MANIFEST as GENERATED_MANIFEST,
  PUBLIC_SURFACE_MANIFEST_GENERATED_AT,
  PUBLIC_SURFACE_MANIFEST_SCHEMA_VERSION as GENERATED_SCHEMA_VERSION
} from "../src/public-surface/generated-manifest";

describe("public surface manifest", () => {
  it("matches the source-built manifest snapshot", () => {
    expect(GENERATED_SCHEMA_VERSION).toBe(SOURCE_SCHEMA_VERSION);
    expect(GENERATED_MANIFEST).toEqual(buildPublicSurfaceManifest(PUBLIC_SURFACE_MANIFEST_GENERATED_AT));
  });
});
