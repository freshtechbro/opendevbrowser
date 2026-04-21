import { describe, expect, it } from "vitest";
import tsupConfig from "../tsup.config";

describe("tsup config", () => {
  it("bundles yjs into the published runtime entries", () => {
    expect(tsupConfig.noExternal).toContain("yjs");
    expect(tsupConfig.entry).toEqual([
      "src/index.ts",
      "src/cli/index.ts",
      "src/cli/installers/postinstall-skill-sync.ts",
      "src/skills/skill-loader.ts"
    ]);
  });
});
