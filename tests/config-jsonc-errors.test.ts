import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs";
import * as os from "os";

vi.mock("fs");
vi.mock("os");
vi.mock("jsonc-parser", () => ({
  parse: (_content: string, errors: Array<{ error: number; offset: number; length: number }>) => {
    errors.push({ error: 1, offset: undefined as unknown as number, length: 1 });
    return {};
  }
}));

describe("loadGlobalConfig JSONC parser errors", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.mocked(os.homedir).mockReturnValue("/home/testuser");
  });

  it("throws when jsonc-parser reports errors", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue("{ bad");

    const { loadGlobalConfig } = await import("../src/config");
    expect(() => loadGlobalConfig()).toThrow("Invalid JSONC in opendevbrowser config");
  });
});
