import { describe, expect, it } from "vitest";
import GENERATED_MANIFEST_JSON from "../src/public-surface/generated-manifest.json";
import { getHelpText } from "../src/cli/help";
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
    expect(GENERATED_MANIFEST_JSON).toEqual(GENERATED_MANIFEST);
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

  it("documents typed Canvas guidance fields and params-file handoff examples", () => {
    const canvasCommand = GENERATED_MANIFEST.cli.commands.find((command) => command.name === "canvas");

    expect(canvasCommand).toBeDefined();
    expect(canvasCommand?.examples).toContain(
      "npx opendevbrowser canvas --command canvas.plan.set --params-file ./canvas-plan.request.json --output-format json"
    );
    expect(canvasCommand?.notes.join(" ")).toContain("nextStepGuidance");
    expect(canvasCommand?.notes.join(" ")).toContain("paramsExamples");
    expect(canvasCommand?.notes.join(" ")).toContain("fieldExamples");
    expect(canvasCommand?.notes.join(" ")).toContain("validationChecks");
    expect(canvasCommand?.notes.join(" ")).toContain("doNotProceedIf");
  });

  it("documents harvest capture-mode in the public inspiredesign usage", () => {
    const inspiredesignCommand = GENERATED_MANIFEST.cli.commands.find((command) => command.name === "inspiredesign");

    expect(inspiredesignCommand?.usage).toContain("inspiredesign harvest");
    expect(inspiredesignCommand?.usage).toContain("[--capture-mode <mode>]");
    expect(inspiredesignCommand?.notes.join(" ")).toContain("inspiredesign run forces captureMode=deep for any explicit --url");
    expect(inspiredesignCommand?.notes.join(" ")).toContain("inspiredesign harvest forces deep capture for non-Pinterest explicit --url references");
    expect(inspiredesignCommand?.notes.join(" ")).toContain("Pinterest-only discovery and compatible Pinterest URL recovery force captureMode=off even when --capture-mode deep is requested");
  });

  it("documents inspiredesign media-analysis dependency guidance", () => {
    const inspiredesignCommand = GENERATED_MANIFEST.cli.commands.find((command) => command.name === "inspiredesign");
    const statusCapabilitiesCommand = GENERATED_MANIFEST.cli.commands.find((command) => command.name === "status-capabilities");
    const inspiredesignTool = GENERATED_MANIFEST.tools.entries.find((entry) => entry.name === "opendevbrowser_inspiredesign_run");
    const notes = inspiredesignCommand?.notes.join(" ") ?? "";
    const statusNotes = statusCapabilitiesCommand?.notes.join(" ") ?? "";
    const toolNotes = inspiredesignTool?.notes?.join(" ") ?? "";

    for (const publicText of [notes, statusNotes, toolNotes]) {
      expect(publicText).toContain("FFmpeg");
      expect(publicText).toContain("FFprobe");
    }

    expect(notes).toContain("recommended optional host tools");
    expect(notes).toContain("OPENDEVBROWSER_FFMPEG_PATH");
    expect(notes).toContain("OPENDEVBROWSER_FFPROBE_PATH");
    expect(notes).toContain("inspiredesign.mediaAnalysis.ffmpegPath");
    expect(notes).toContain("inspiredesign.mediaAnalysis.ffprobePath");
    expect(notes).toContain("then ffmpeg and ffprobe on PATH");
    expect(notes).toContain("Missing binaries degrade media-analysis.json only");
    expect(notes).toContain("do not fail pin-media readiness");
    expect(notes).toContain("never make media-analysis.json satisfy product readiness");
    expect(statusNotes).toContain("host.mediaAnalysis");
    expect(statusNotes).toContain("optional media-analysis host capability");
    expect(statusNotes).not.toContain("media-analysis prerequisites");
    expect(toolNotes).toContain("host.mediaAnalysis");
    expect(toolNotes).toContain("optional media-analysis host capability");
    expect(toolNotes).not.toContain("media-analysis prerequisites");
  });

  it("documents inspiredesign readiness blockers and Pinterest evidence prerequisites", () => {
    const inspiredesignCommand = GENERATED_MANIFEST.cli.commands.find((command) => command.name === "inspiredesign");
    const notes = inspiredesignCommand?.notes.join(" ") ?? "";
    const inspiredesignTool = GENERATED_MANIFEST.tools.entries.find((entry) => entry.name === "opendevbrowser_inspiredesign_run");
    const helpText = getHelpText();

    expect(notes).toContain("Canvas continuation requires readiness=ready, non-empty ranked references");
    expect(notes).toContain("snapshot_ready screenshot evidence, motion_ready screencast evidence, or pin_media_ready first-party pin-media evidence");
    expect(notes).toContain("media-analysis.json is a design-fact artifact only");
    expect(notes).toContain("never grants readiness authority");
    expect(notes).toContain("raw media-analysis fields must not enter canvas-plan.request.json");
    expect(notes).toContain("remote media URLs are not product-ready unless persisted first-party bytes appear in pin-media-index.json");
    expect(notes).toContain("zero references");
    expect(notes).toContain("empty ranked references");
    expect(notes).toContain("missing required screenshot, screencast, or pin-media evidence");
    expect(notes).toContain("diagnostic-only captures");
    expect(inspiredesignTool?.description).toContain("screenshot evidence");
    expect(inspiredesignTool?.description).toContain("screencast evidence");
    expect(inspiredesignTool?.description).toContain("manifest-backed pin-media evidence for canonical Pinterest pins");
    expect(helpText).toContain("Require nextStepGuidance.readiness=ready, non-empty ranked references");
    expect(helpText).toContain("Pinterest snapshot_ready, motion_ready, or pin_media_ready manifest-backed evidence before Canvas continuation");
    expect(helpText).toContain("Treat media-analysis.json as design facts only");
    expect(helpText).toContain("raw media-analysis fields must not enter canvas-plan.request.json");
  });
});
