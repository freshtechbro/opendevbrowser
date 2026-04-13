import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCipheriv, createHash, pbkdf2Sync } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

const launchPersistentContext = vi.fn();
const discoverSystemChromeProfileSource = vi.fn();
const execFileSync = vi.fn();

vi.mock("playwright-core", () => ({
  chromium: {
    launchPersistentContext
  }
}));

vi.mock("node:child_process", () => ({
  execFileSync
}));

vi.mock("../src/cache/chrome-user-data", () => ({
  discoverSystemChromeProfileSource
}));

describe("loadSystemChromeCookies", () => {
  let sourceRoot: string;
  let profilePath: string;

  beforeEach(async () => {
    vi.resetModules();
    sourceRoot = await mkdtemp(join(tmpdir(), "odb-chrome-source-"));
    profilePath = join(sourceRoot, "Default");
    await mkdir(profilePath, { recursive: true });
    await writeFile(join(sourceRoot, "Local State"), JSON.stringify({ profile: { last_used: "Default" } }), "utf8");
    await writeFile(join(profilePath, "Preferences"), JSON.stringify({}), "utf8");
    await writeFile(join(profilePath, "Cookies"), "cookie-db", "utf8");

    discoverSystemChromeProfileSource.mockReturnValue({
      browserName: "chrome",
      userDataDir: sourceRoot,
      profileDirectory: "Default",
      profilePath
    });
  });

  afterEach(() => {
    launchPersistentContext.mockReset();
    discoverSystemChromeProfileSource.mockReset();
    execFileSync.mockReset();
  });

  it("stages the selected profile and returns readable cookies", async () => {
    const cookies = [{
      name: "sessionid",
      value: "abc123",
      domain: ".example.com",
      path: "/",
      expires: -1,
      httpOnly: true,
      secure: true,
      sameSite: "Lax" as const
    }];
    const close = vi.fn().mockResolvedValue(undefined);
    launchPersistentContext.mockResolvedValue({
      cookies: vi.fn().mockResolvedValue(cookies),
      close
    });
    execFileSync.mockImplementation(() => {
      throw new Error("security unavailable");
    });

    const { loadSystemChromeCookies } = await import("../src/browser/system-chrome-cookies");
    const result = await loadSystemChromeCookies("/bin/chrome");

    expect(result.cookies).toEqual(cookies);
    expect(result.source?.profileDirectory).toBe("Default");
    expect(result.warnings).toEqual([]);
    expect(launchPersistentContext).toHaveBeenCalledWith(
      expect.stringContaining("opendevbrowser-chrome-cookie-bootstrap-"),
      expect.objectContaining({
        headless: true,
        executablePath: "/bin/chrome",
        args: ["--profile-directory=Default"]
      })
    );
    expect(close).toHaveBeenCalled();
  });

  it("decrypts macOS cookies directly from sqlite when the keychain password is available", async () => {
    const safeStoragePassword = "safe-storage-secret";
    const key = pbkdf2Sync(safeStoragePassword, "saltysalt", 1003, 16, "sha1");
    const cipher = createCipheriv("aes-128-cbc", key, Buffer.alloc(16, 0x20));
    const hostKey = ".github.com";
    const encryptedHex = Buffer.concat([
      Buffer.from("v10"),
      cipher.update(Buffer.concat([createHash("sha256").update(hostKey).digest(), Buffer.from("token-123", "utf8")])),
      cipher.final()
    ]).toString("hex").toUpperCase();
    const encodeHex = (value: string) => Buffer.from(value, "utf8").toString("hex").toUpperCase();

    execFileSync.mockImplementation((command: string) => {
      if (command === "security") {
        return `${safeStoragePassword}\n`;
      }
      if (command === "sqlite3") {
        return [
          encodeHex(hostKey),
          encodeHex("user_session"),
          "",
          encryptedHex,
          encodeHex("/"),
          "13419386248156248",
          "1",
          "1",
          "1"
        ].join("\u001f");
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    const { __test__ } = await import("../src/browser/system-chrome-cookies");
    const result = await __test__.loadSystemChromeCookiesFromSqlite({
      browserName: "chrome",
      userDataDir: sourceRoot,
      profileDirectory: "Default",
      profilePath
    }, "darwin");

    expect(result.warnings).toEqual([]);
    expect(result.cookies).toEqual([{
      name: "user_session",
      value: "token-123",
      domain: ".github.com",
      path: "/",
      expires: expect.any(Number),
      httpOnly: true,
      secure: true,
      sameSite: "Lax"
    }]);
    expect(execFileSync).toHaveBeenCalledWith(
      "sqlite3",
      expect.any(Array),
      expect.objectContaining({
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024
      })
    );
    expect(launchPersistentContext).not.toHaveBeenCalled();
  });

  it("strips Chromium host-binding prefixes from decrypted cookie values", async () => {
    const safeStoragePassword = "safe-storage-secret";
    const hostKey = ".github.com";
    const key = pbkdf2Sync(safeStoragePassword, "saltysalt", 1003, 16, "sha1");
    const cipher = createCipheriv("aes-128-cbc", key, Buffer.alloc(16, 0x20));
    const encryptedHex = Buffer.concat([
      Buffer.from("v10"),
      cipher.update(Buffer.concat([createHash("sha256").update(hostKey).digest(), Buffer.from("yes", "utf8")])),
      cipher.final()
    ]).toString("hex").toUpperCase();

    const { __test__ } = await import("../src/browser/system-chrome-cookies");
    expect(__test__.decryptDarwinCookieValue(encryptedHex, key, hostKey)).toBe("yes");
  });

  it("keeps decrypted cookie prefixes when the host-binding digest does not match", async () => {
    const hostKey = ".github.com";
    const key = pbkdf2Sync("safe-storage-secret", "saltysalt", 1003, 16, "sha1");
    const mismatchedPrefix = Buffer.alloc(32, 0x78);
    const cipher = createCipheriv("aes-128-cbc", key, Buffer.alloc(16, 0x20));
    const encryptedHex = Buffer.concat([
      Buffer.from("v10"),
      cipher.update(Buffer.concat([mismatchedPrefix, Buffer.from("token-raw", "utf8")])),
      cipher.final()
    ]).toString("hex").toUpperCase();

    const { __test__ } = await import("../src/browser/system-chrome-cookies");
    expect(__test__.decryptDarwinCookieValue(encryptedHex, key, hostKey)).toBe(`${"x".repeat(32)}token-raw`);
  });

  it("returns a warning when no readable system profile exists", async () => {
    discoverSystemChromeProfileSource.mockReturnValue(null);

    const { loadSystemChromeCookies } = await import("../src/browser/system-chrome-cookies");
    const result = await loadSystemChromeCookies("/bin/chrome");

    expect(result.cookies).toEqual([]);
    expect(result.source).toBeNull();
    expect(result.warnings[0]).toContain("System Chrome profile not found");
    expect(launchPersistentContext).not.toHaveBeenCalled();
  });

  it("covers sqlite utility branches for malformed rows, same-site mapping, and expires conversion", async () => {
    const { __test__ } = await import("../src/browser/system-chrome-cookies");
    const encodeHex = (value: string) => Buffer.from(value, "utf8").toString("hex").toUpperCase();

    expect(() => __test__.parseSqliteCookieRows("A\u001fB")).toThrow("Unexpected sqlite cookie row shape");
    expect(__test__.parseSqliteCookieRows([
      encodeHex(".example.com"),
      encodeHex("session"),
      "",
      "",
      "",
      "0",
      "0",
      "0",
      "-1"
    ].join("\u001f"))).toEqual([{
      hostKey: ".example.com",
      name: "session",
      value: "",
      encryptedHex: "",
      path: "",
      expiresUtc: 0,
      httpOnly: false,
      secure: false,
      sameSite: -1
    }]);
    expect(__test__.mapChromiumSameSite(0)).toBe("None");
    expect(__test__.mapChromiumSameSite(1)).toBe("Lax");
    expect(__test__.mapChromiumSameSite(2)).toBe("Strict");
    expect(__test__.mapChromiumSameSite(-1)).toBeUndefined();
    expect(__test__.chromiumExpiresToUnixSeconds(0)).toBe(-1);
    expect(__test__.chromiumExpiresToUnixSeconds(Number.NaN)).toBe(-1);
    expect(__test__.chromiumExpiresToUnixSeconds(11_644_473_601_000_000)).toBe(1);
  });

  it("handles empty and non-prefixed decrypted cookie payloads", async () => {
    const safeStoragePassword = "safe-storage-secret";
    const hostKey = ".github.com";
    const key = pbkdf2Sync(safeStoragePassword, "saltysalt", 1003, 16, "sha1");
    const cipher = createCipheriv("aes-128-cbc", key, Buffer.alloc(16, 0x20));
    const encryptedHex = Buffer.concat([
      cipher.update(Buffer.from("plain-token", "utf8")),
      cipher.final()
    ]).toString("hex").toUpperCase();

    const { __test__ } = await import("../src/browser/system-chrome-cookies");

    expect(__test__.decryptDarwinCookieValue("", key, hostKey)).toBe("");
    expect(__test__.decryptDarwinCookieValue(encryptedHex, key, hostKey)).toBe("plain-token");
  });

  it("returns attempted false outside darwin and warns when the cookie database is missing", async () => {
    const { __test__ } = await import("../src/browser/system-chrome-cookies");

    await expect(__test__.loadSystemChromeCookiesFromSqlite({
      browserName: "chrome",
      userDataDir: sourceRoot,
      profileDirectory: "Default",
      profilePath
    }, "linux")).resolves.toEqual({
      cookies: [],
      warnings: [],
      attempted: false
    });

    await rm(join(profilePath, "Cookies"), { force: true });
    const missingDb = await __test__.loadSystemChromeCookiesFromSqlite({
      browserName: "chrome",
      userDataDir: sourceRoot,
      profileDirectory: "Default",
      profilePath
    }, "darwin");

    expect(missingDb.cookies).toEqual([]);
    expect(missingDb.attempted).toBe(true);
    expect(missingDb.warnings[0]).toContain("did not expose a readable cookie database");
  });

  it("skips unreadable sqlite cookie rows and normalizes empty paths to slash", async () => {
    const safeStoragePassword = "safe-storage-secret";
    const encodeHex = (value: string) => Buffer.from(value, "utf8").toString("hex").toUpperCase();

    execFileSync.mockImplementation((command: string) => {
      if (command === "security") {
        return `${safeStoragePassword}\n`;
      }
      if (command === "sqlite3") {
        return [
          [
            encodeHex(".example.com"),
            encodeHex("plain_cookie"),
            encodeHex("plain-value"),
            "",
            "",
            "0",
            "0",
            "0",
            "-1"
          ].join("\u001f"),
          [
            encodeHex(".example.com"),
            encodeHex("broken_cookie"),
            "",
            "00",
            encodeHex("/"),
            "0",
            "0",
            "0",
            "2"
          ].join("\u001f")
        ].join("\n");
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    const { __test__ } = await import("../src/browser/system-chrome-cookies");
    const result = await __test__.loadSystemChromeCookiesFromSqlite({
      browserName: "chrome",
      userDataDir: sourceRoot,
      profileDirectory: "Default",
      profilePath
    }, "darwin");

    expect(result.cookies).toEqual([{
      name: "plain_cookie",
      value: "plain-value",
      domain: ".example.com",
      path: "/",
      expires: -1,
      httpOnly: false,
      secure: false
    }]);
    expect(result.warnings).toEqual([
      "System Chrome cookie bootstrap skipped 1 unreadable cookies from Default."
    ]);
  });

  it("returns direct sqlite cookies without staging when the system profile can be decrypted", async () => {
    const safeStoragePassword = "safe-storage-secret";
    const hostKey = ".github.com";
    const key = pbkdf2Sync(safeStoragePassword, "saltysalt", 1003, 16, "sha1");
    const cipher = createCipheriv("aes-128-cbc", key, Buffer.alloc(16, 0x20));
    const encryptedHex = Buffer.concat([
      Buffer.from("v10"),
      cipher.update(Buffer.concat([createHash("sha256").update(hostKey).digest(), Buffer.from("direct-value", "utf8")])),
      cipher.final()
    ]).toString("hex").toUpperCase();
    const encodeHex = (value: string) => Buffer.from(value, "utf8").toString("hex").toUpperCase();

    execFileSync.mockImplementation((command: string) => {
      if (command === "security") return `${safeStoragePassword}\n`;
      if (command === "sqlite3") {
        return [
          encodeHex(hostKey),
          encodeHex("direct_cookie"),
          "",
          encryptedHex,
          encodeHex("/"),
          "13419386248156248",
          "1",
          "1",
          "0"
        ].join("\u001f");
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    const { __test__ } = await import("../src/browser/system-chrome-cookies");
    const result = await __test__.loadSystemChromeCookiesFromSqlite({
      browserName: "chrome",
      userDataDir: sourceRoot,
      profileDirectory: "Default",
      profilePath
    }, "darwin");

    expect(result.cookies).toEqual([{
      name: "direct_cookie",
      value: "direct-value",
      domain: ".github.com",
      path: "/",
      expires: expect.any(Number),
      httpOnly: true,
      secure: true,
      sameSite: "None"
    }]);
    expect(result.warnings).toEqual([]);
    expect(launchPersistentContext).not.toHaveBeenCalled();
  });

  it("returns a direct-read warning when sqlite access fails", async () => {
    execFileSync.mockImplementation((command: string) => {
      if (command === "security") {
        return "safe-storage-secret\n";
      }
      if (command === "sqlite3") {
        throw new Error("sqlite unavailable");
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    const { __test__ } = await import("../src/browser/system-chrome-cookies");
    const result = await __test__.loadSystemChromeCookiesFromSqlite({
      browserName: "chrome",
      userDataDir: sourceRoot,
      profileDirectory: "Default",
      profilePath
    }, "darwin");

    expect(result.cookies).toEqual([]);
    expect(result.attempted).toBe(true);
    expect(result.warnings[0]).toContain("System Chrome cookie bootstrap direct read failed: sqlite unavailable");
  });

  it("stages cookies without a configured executable path and omits empty sameSite values", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    launchPersistentContext.mockResolvedValue({
      cookies: vi.fn().mockResolvedValue([{
        name: "staged-cookie",
        value: "value",
        domain: ".example.com",
        path: "/",
        expires: -1,
        httpOnly: false,
        secure: true,
        sameSite: undefined
      }]),
      close
    });
    execFileSync.mockImplementation(() => {
      throw new Error("security unavailable");
    });

    const { loadSystemChromeCookies } = await import("../src/browser/system-chrome-cookies");
    const result = await loadSystemChromeCookies();

    expect(result.cookies).toEqual([{
      name: "staged-cookie",
      value: "value",
      domain: ".example.com",
      path: "/",
      expires: -1,
      httpOnly: false,
      secure: true
    }]);
    expect(launchPersistentContext).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        executablePath: undefined
      })
    );
    expect(close).toHaveBeenCalled();
  });

  it("reports missing staged cookie stores without launching a browser", async () => {
    await rm(join(profilePath, "Cookies"), { force: true });
    execFileSync.mockImplementation(() => {
      throw new Error("security unavailable");
    });

    const { loadSystemChromeCookies } = await import("../src/browser/system-chrome-cookies");
    const result = await loadSystemChromeCookies("/bin/chrome");

    expect(result.cookies).toEqual([]);
    expect(result.source?.profileDirectory).toBe("Default");
    expect(result.warnings.some((warning) => warning.includes("did not expose a readable cookie store"))).toBe(true);
    expect(launchPersistentContext).not.toHaveBeenCalled();
  });

  it("returns a fallback warning when persistent context launch fails after staging", async () => {
    execFileSync.mockImplementation((command: string) => {
      if (command === "security") {
        return "safe-storage-secret\n";
      }
      if (command === "sqlite3") {
        return "";
      }
      throw new Error(`Unexpected command: ${command}`);
    });
    launchPersistentContext.mockRejectedValue(new Error("launch failed"));

    const { loadSystemChromeCookies } = await import("../src/browser/system-chrome-cookies");
    const result = await loadSystemChromeCookies("/bin/chrome");

    expect(result.cookies).toEqual([]);
    expect(result.source?.profileDirectory).toBe("Default");
    expect(result.warnings).toContain("System Chrome cookie bootstrap failed: launch failed");
  });

  it("stringifies non-Error staging failures in the final warning", async () => {
    execFileSync.mockImplementation((command: string) => {
      if (command === "security") return "safe-storage-secret\n";
      if (command === "sqlite3") return "";
      throw new Error(`Unexpected command: ${command}`);
    });
    launchPersistentContext.mockRejectedValue("launch failed as string");

    const { loadSystemChromeCookies } = await import("../src/browser/system-chrome-cookies");
    const result = await loadSystemChromeCookies();

    expect(result.warnings).toContain("System Chrome cookie bootstrap failed: launch failed as string");
  });
});
