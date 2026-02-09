import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ConfigStore, loadGlobalConfig, resolveConfig } from "../src/config";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

vi.mock("fs");
vi.mock("os");

let warnSpy: ReturnType<typeof vi.spyOn> | null = null;

beforeEach(() => {
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warnSpy?.mockRestore();
  warnSpy = null;
});

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
    expect(config.snapshot.maxNodes).toBe(1000);
    expect(config.security.allowRawCDP).toBe(false);
    expect(config.security.allowNonLocalCdp).toBe(false);
    expect(config.security.allowUnsafeExport).toBe(false);
    expect(config.devtools.showFullUrls).toBe(false);
    expect(config.devtools.showFullConsole).toBe(false);
    expect(config.export.maxNodes).toBe(1000);
    expect(config.export.inlineStyles).toBe(true);
    expect(config.persistProfile).toBe(true);
    expect(config.checkForUpdates).toBe(false);
    expect(config.relayPort).toBe(8787);
    expect(typeof config.relayToken).toBe("string");
    expect(config.relayToken).toMatch(/^[a-f0-9]{64}$/);
    expect(config.daemonPort).toBe(8788);
    expect(typeof config.daemonToken).toBe("string");
    expect(config.daemonToken).toMatch(/^[a-f0-9]{64}$/);
    expect(fs.mkdirSync).toHaveBeenCalledWith(
      path.join("/home/testuser", ".config", "opencode"),
      { recursive: true, mode: 0o700 }
    );
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      path.join("/home/testuser", ".config", "opencode", "opendevbrowser.jsonc"),
      expect.stringMatching(/"relayToken": "[a-f0-9]{64}".*"daemonToken": "[a-f0-9]{64}"/s),
      { encoding: "utf-8", mode: 0o600 }
    );
  });

  it("reads config from global config file", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      headless: true,
      profile: "test",
      snapshot: { maxChars: 5000, maxNodes: 1500 },
      security: { allowRawCDP: true, allowNonLocalCdp: true, allowUnsafeExport: true },
      devtools: { showFullUrls: true, showFullConsole: true },
      export: { maxNodes: 2500, inlineStyles: false },
      relayPort: 9191,
      relayToken: "secret",
      flags: ["--foo"],
      checkForUpdates: true,
      persistProfile: false
    }));

    const config = loadGlobalConfig();
    expect(config.headless).toBe(true);
    expect(config.profile).toBe("test");
    expect(config.snapshot.maxChars).toBe(5000);
    expect(config.snapshot.maxNodes).toBe(1500);
    expect(config.security.allowRawCDP).toBe(true);
    expect(config.security.allowNonLocalCdp).toBe(true);
    expect(config.security.allowUnsafeExport).toBe(true);
    expect(config.devtools.showFullUrls).toBe(true);
    expect(config.devtools.showFullConsole).toBe(true);
    expect(config.export.maxNodes).toBe(2500);
    expect(config.export.inlineStyles).toBe(false);
    expect(config.relayPort).toBe(9191);
    expect(config.relayToken).toBe("secret");
    expect(config.flags).toEqual(["--foo"]);
    expect(config.checkForUpdates).toBe(true);
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

  it("throws on malformed JSON", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue("not valid json {{{");

    expect(() => loadGlobalConfig()).toThrow("Invalid JSONC in opendevbrowser config");
  });

  it("parses JSONC with trailing commas", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(`{
      "profile": "trailing",
      "headless": true,
    }`);

    const config = loadGlobalConfig();
    expect(config.profile).toBe("trailing");
    expect(config.headless).toBe(true);
  });

  it("parses JSONC with URLs containing // without corruption", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(`{
      "chromePath": "http://example.com/path",
      "flags": ["--proxy-server=http://proxy.example.com:8080"]
    }`);

    const config = loadGlobalConfig();
    expect(config.chromePath).toBe("http://example.com/path");
    expect(config.flags).toEqual(["--proxy-server=http://proxy.example.com:8080"]);
  });

  it("accepts false relayToken to disable pairing", () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      relayToken: false
    }));

    const config = loadGlobalConfig();
    expect(config.relayToken).toBe(false);
  });

  it("skips config creation when file appears between checks", () => {
    vi.mocked(fs.existsSync)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);

    const config = loadGlobalConfig();
    expect(typeof config.relayToken).toBe("string");
    expect(config.relayToken).toMatch(/^[a-f0-9]{64}$/);
    expect(fs.mkdirSync).not.toHaveBeenCalled();
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it("ignores failures when creating the default config file", () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.mkdirSync).mockImplementation(() => {
      throw new Error("boom");
    });

    const config = loadGlobalConfig();
    expect(typeof config.relayToken).toBe("string");
    expect(config.relayToken).toMatch(/^[a-f0-9]{64}$/);
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

  it("parses overrides and applies defaults", () => {
    const config = resolveConfig({ profile: "custom" });
    expect(config.profile).toBe("custom");
    expect(config.relayPort).toBe(8787);
    expect(config.daemonPort).toBe(8788);
  });

  it("delegates to loadGlobalConfig when undefined", () => {
    const config = resolveConfig(undefined);
    expect(config.profile).toBe("default");
  });

  it("generates tokens when missing", () => {
    const config = resolveConfig({});
    expect(typeof config.relayToken).toBe("string");
    expect(typeof config.daemonToken).toBe("string");
  });

  it("rejects invalid overrides", () => {
    expect(() => resolveConfig({ relayPort: -1 })).toThrow("Invalid opendevbrowser config override");
  });
});

describe("chromePath validation", () => {
  beforeEach(() => {
    vi.mocked(os.homedir).mockReturnValue("/home/testuser");
    delete process.env.OPENCODE_CONFIG_DIR;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("rejects chromePath that does not exist", () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      if (String(p).includes("opendevbrowser.jsonc")) return true;
      return false;
    });
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      chromePath: "/nonexistent/chrome"
    }));
    vi.mocked(fs.accessSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });

    expect(() => loadGlobalConfig()).toThrow("Invalid opendevbrowser config");
  });

  it("rejects chromePath that exists but is not executable", () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      if (String(p).includes("opendevbrowser.jsonc")) return true;
      if (String(p).includes("/path/to/notexec")) return true;
      return false;
    });
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      chromePath: "/path/to/notexec"
    }));
    vi.mocked(fs.accessSync).mockImplementation(() => {
      throw new Error("EACCES");
    });

    expect(() => loadGlobalConfig()).toThrow("Invalid opendevbrowser config");
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
