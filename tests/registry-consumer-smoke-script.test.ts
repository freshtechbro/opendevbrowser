import { describe, expect, it } from "vitest";
import {
  assertRegistryConsumerSmoke,
  parseRegistryConsumerSmokeArgs,
  summarizeDependencyGraph
} from "../scripts/registry-consumer-smoke.mjs";

describe("registry-consumer-smoke script", () => {
  it("parses required and optional arguments", () => {
    expect(parseRegistryConsumerSmokeArgs([
      "--version",
      "0.0.18",
      "--retries",
      "3",
      "--delay-ms",
      "750",
      "--output",
      "artifacts/release/v0.0.18/registry-consumer-smoke.json"
    ])).toEqual({
      version: "0.0.18",
      outputPath: "artifacts/release/v0.0.18/registry-consumer-smoke.json",
      retries: 3,
      delayMs: 750
    });
  });

  it("rejects a missing version argument", () => {
    expect(() => parseRegistryConsumerSmokeArgs([])).toThrow("Missing required --version");
  });

  it("summarizes the resolved consumer dependency graph", () => {
    expect(summarizeDependencyGraph({
      dependencies: {
        opendevbrowser: {
          version: "0.0.18",
          dependencies: {
            "@opencode-ai/plugin": {
              version: "1.4.3",
              dependencies: {
                zod: { version: "4.1.8" }
              }
            },
            ws: { version: "8.20.0" },
            zod: { version: "3.25.76" }
          }
        }
      }
    })).toEqual({
      opendevbrowser: "0.0.18",
      plugin: "1.4.3",
      ws: "8.20.0",
      zod: "3.25.76",
      nestedPluginZod: "4.1.8"
    });
  });

  it("accepts matching help, version, and packaged assets", () => {
    expect(() => assertRegistryConsumerSmoke({
      version: "0.0.18",
      helpText: [
        "OpenDevBrowser CLI",
        "",
        "Find It Fast:",
        "  screencast / browser replay",
        "  desktop observation",
        "  computer use / browser-scoped computer use"
      ].join("\n"),
      helpAliasText: [
        "OpenDevBrowser CLI",
        "",
        "Find It Fast:",
        "  screencast / browser replay",
        "  desktop observation",
        "  computer use / browser-scoped computer use"
      ].join("\n"),
      versionPayload: { success: true, message: "opendevbrowser v0.0.18" },
      extensionDirExists: true,
      skillsDirExists: true
    })).not.toThrow();
  });

  it("rejects mismatched help aliases", () => {
    expect(() => assertRegistryConsumerSmoke({
      version: "0.0.18",
      helpText: "Find It Fast:\nscreencast / browser replay\ndesktop observation\ncomputer use / browser-scoped computer use",
      helpAliasText: "different output",
      versionPayload: { success: true, message: "opendevbrowser v0.0.18" },
      extensionDirExists: true,
      skillsDirExists: true
    })).toThrow("help alias diverged");
  });
});
