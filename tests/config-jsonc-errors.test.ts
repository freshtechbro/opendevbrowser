import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs";
import * as os from "os";

vi.mock("fs");
vi.mock("os");
const parseMock = vi.hoisted(() => vi.fn());
vi.mock("jsonc-parser", () => ({
  parse: (...args: unknown[]) => parseMock(...args),
  modify: () => [],
  applyEdits: (content: string) => content
}));

describe("loadGlobalConfig JSONC parser errors", () => {
  beforeEach(() => {
    vi.resetModules();
    parseMock.mockReset();
    vi.mocked(os.homedir).mockReturnValue("/home/testuser");
  });

  it("throws when jsonc-parser reports errors", async () => {
    parseMock.mockImplementation((_content: string, errors: Array<{ error: number; offset: number; length: number }>) => {
      errors.push({ error: 1, offset: 12, length: 1 });
      return {};
    });
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue("{ bad");

    const { loadGlobalConfig } = await import("../src/config");
    expect(() => loadGlobalConfig()).toThrow("Invalid JSONC in opendevbrowser config");
  });

  it("throws when jsonc-parser yields an undefined error entry", async () => {
    parseMock.mockImplementation((_content: string, errors: Array<{ error: number; offset: number; length: number }>) => {
      errors.push(undefined as unknown as { error: number; offset: number; length: number });
      return {};
    });
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue("{ bad");

    const { loadGlobalConfig } = await import("../src/config");
    expect(() => loadGlobalConfig()).toThrow("parse error");
  });
});
