import { describe, expect, it } from "vitest";
import { auditZombiePaths, isZombieDuplicatePath } from "../scripts/audit-zombie-files.mjs";

describe("audit-zombie-files", () => {
  it("flags known duplicate naming patterns", () => {
    expect(isZombieDuplicatePath("src/snapshot/AGENTS 2.md")).toBe(true);
    expect(isZombieDuplicatePath("docs/CLI copy.md")).toBe(true);
    expect(isZombieDuplicatePath("docs/CLI-copy.md")).toBe(true);
    expect(isZombieDuplicatePath("docs/notes.bak")).toBe(true);
    expect(isZombieDuplicatePath("docs/notes.orig")).toBe(true);
    expect(isZombieDuplicatePath("docs/notes.old")).toBe(true);
  });

  it("does not flag canonical files that include copy in non-basename segments", () => {
    expect(isZombieDuplicatePath("scripts/copy-extension-assets.mjs")).toBe(false);
    expect(isZombieDuplicatePath("src/cli/index.ts")).toBe(false);
    expect(isZombieDuplicatePath("docs/CLI.md")).toBe(false);
  });

  it("returns sorted flagged file paths", () => {
    const result = auditZombiePaths([
      "docs/B copy.md",
      "src/a.ts",
      "docs/A copy.md"
    ]);
    expect(result).toEqual(["docs/A copy.md", "docs/B copy.md"]);
  });
});
