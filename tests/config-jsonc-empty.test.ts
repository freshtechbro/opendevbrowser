import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs";
import * as os from "os";

vi.mock("fs");
vi.mock("os");
vi.mock("jsonc-parser", () => ({
  parse: (_content: string, _errors: Array<{ error: number; offset: number; length: number }>) => undefined
}));

describe("loadGlobalConfig with empty JSONC payload", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.mocked(os.homedir).mockReturnValue("/home/testuser");
  });

  it("falls back to defaults when parser returns undefined without errors", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue("");

    const { loadGlobalConfig } = await import("../src/config");
    const config = loadGlobalConfig();
    expect(config.profile).toBe("default");
    expect(config.headless).toBe(false);
  });
});
