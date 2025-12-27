import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ConfigStore, loadGlobalConfig, resolveConfig } from "../src/config";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

vi.mock("fs");
vi.mock("os");

describe("loadGlobalConfig", () => {
  beforeEach(() => {
    vi.mocked(os.homedir).mockReturnValue("/home/testuser");
    delete process.env.OPENCODE_CONFIG_DIR;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns defaults when no config file exists", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const config = loadGlobalConfig();
    expect(config.headless).toBe(false);
    expect(config.profile).toBe("default");
    expect(config.snapshot.maxChars).toBe(16000);
    expect(config.security.allowRawCDP).toBe(false);
    expect(config.security.allowNonLocalCdp).toBe(false);
    expect(config.security.allowUnsafeExport).toBe(false);
    expect(config.persistProfile).toBe(true);
    expect(config.relayPort).toBe(8787);
    expect(config.relayToken).toBeUndefined();
  });

  it("reads config from global config file", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      headless: true,
      profile: "test",
      snapshot: { maxChars: 5000 },
      security: { allowRawCDP: true, allowNonLocalCdp: true, allowUnsafeExport: true },
      relayPort: 9191,
      relayToken: "secret",
      flags: ["--foo"],
      persistProfile: false
    }));

    const config = loadGlobalConfig();
    expect(config.headless).toBe(true);
    expect(config.profile).toBe("test");
    expect(config.snapshot.maxChars).toBe(5000);
    expect(config.security.allowRawCDP).toBe(true);
    expect(config.security.allowNonLocalCdp).toBe(true);
    expect(config.security.allowUnsafeExport).toBe(true);
    expect(config.relayPort).toBe(9191);
    expect(config.relayToken).toBe("secret");
    expect(config.flags).toEqual(["--foo"]);
    expect(config.persistProfile).toBe(false);

    expect(fs.existsSync).toHaveBeenCalledWith(
      path.join("/home/testuser", ".config", "opencode", "opendevbrowser.jsonc")
    );
  });

  it("respects OPENCODE_CONFIG_DIR env var", () => {
    process.env.OPENCODE_CONFIG_DIR = "/custom/config";
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ profile: "envdir" }));

    const config = loadGlobalConfig();
    expect(config.profile).toBe("envdir");
    expect(fs.existsSync).toHaveBeenCalledWith(
      path.join("/custom/config", "opendevbrowser.jsonc")
    );
  });

  it("strips JSONC comments", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(`{
      // This is a comment
      "profile": "commented",
      /* Block comment */
      "headless": true
    }`);

    const config = loadGlobalConfig();
    expect(config.profile).toBe("commented");
    expect(config.headless).toBe(true);
  });

  it("throws on invalid config values", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      snapshot: { maxChars: 1 }
    }));

    expect(() => loadGlobalConfig()).toThrow("Invalid opendevbrowser config");
  });

  it("returns defaults on malformed JSON", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue("not valid json {{{");

    const config = loadGlobalConfig();
    expect(config.profile).toBe("default");
  });
});

describe("resolveConfig", () => {
  beforeEach(() => {
    vi.mocked(os.homedir).mockReturnValue("/home/testuser");
    vi.mocked(fs.existsSync).mockReturnValue(false);
    delete process.env.OPENCODE_CONFIG_DIR;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("delegates to loadGlobalConfig", () => {
    const config = resolveConfig({});
    expect(config.profile).toBe("default");
  });
});

describe("ConfigStore", () => {
  beforeEach(() => {
    vi.mocked(os.homedir).mockReturnValue("/home/testuser");
    vi.mocked(fs.existsSync).mockReturnValue(false);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("stores and returns config", () => {
    const initial = loadGlobalConfig();
    const store = new ConfigStore(initial);
    expect(store.get()).toBe(initial);

    const next = { ...initial, profile: "next" };
    store.set(next);
    expect(store.get().profile).toBe("next");
  });
});
