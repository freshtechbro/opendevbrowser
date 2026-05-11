import { describe, expect, it } from "vitest";
import {
  buildPublicSurfaceManifest,
  buildPublicSurfaceToolSurfaces,
  PUBLIC_SURFACE_MANIFEST_SCHEMA_VERSION as SOURCE_SCHEMA_VERSION
} from "../src/public-surface/source";
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

  it("carries source-owned examples and notes for commands and tools", () => {
    for (const command of GENERATED_MANIFEST.cli.commands) {
      expect(command.examples.length).toBeGreaterThan(0);
      for (const example of command.examples) {
        expect(example.startsWith("npx opendevbrowser")).toBe(true);
      }
      expect(Array.isArray(command.notes)).toBe(true);
    }

    for (const entry of GENERATED_MANIFEST.tools.entries) {
      expect(entry.example?.length ?? 0).toBeGreaterThan(0);
      expect(Array.isArray(entry.notes ?? [])).toBe(true);
    }
  });

  it("keeps tool-local examples and CLI fallback examples distinct", () => {
    const toolSurfaces = buildPublicSurfaceToolSurfaces();
    const promptingGuide = toolSurfaces.find((entry) => entry.name === "opendevbrowser_prompting_guide");
    const macroResolve = toolSurfaces.find((entry) => entry.name === "opendevbrowser_macro_resolve");

    expect(promptingGuide).toEqual(expect.objectContaining({
      example: "{\"topic\":\"quick start\"}",
      notes: [
        "Tool-only helper. Use it before low-level browser commands when an agent needs the canonical quick start."
      ]
    }));
    expect(promptingGuide?.cliEquivalent).toBeUndefined();

    expect(macroResolve).toEqual(expect.objectContaining({
      cliEquivalent: "macro-resolve",
      example: "npx opendevbrowser macro-resolve --expression '@community.search(\"browser automation failures\", 4)' --execute --browser-mode extension --use-cookies --cookie-policy required --challenge-automation-mode browser_with_helper --output-format json"
    }));
    expect(macroResolve?.notes).toBeUndefined();
  });
});
