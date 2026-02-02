import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const loadHost = async () => {
  const module = await import("../scripts/native/host.cjs");
  return (module as { __test__?: Record<string, unknown>; default?: { __test__?: Record<string, unknown> } }).default?.__test__
    ?? module.__test__;
};

describe("native host helpers", () => {
  it("writes token file with 0600 permissions", async () => {
    const helpers = await loadHost();
    if (!helpers) throw new Error("helpers not found");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odb-native-"));
    const tokenPath = path.join(dir, "token");
    const token = (helpers.writeTokenFile as (p: string) => string)(tokenPath);
    const mode = fs.statSync(tokenPath).mode & 0o777;
    expect(mode).toBe(0o600);
    expect(token).toMatch(/^[a-f0-9]{64}$/);
  });

  it("redacts tokens in logs", async () => {
    const helpers = await loadHost();
    if (!helpers) throw new Error("helpers not found");
    const redacted = (helpers.redactLogLine as (line: string, token: string) => string)(
      "Authorization: Bearer secret-token",
      "secret-token"
    );
    expect(redacted).not.toContain("secret-token");
    expect(redacted).toContain("[redacted]");
  });

  it("rotates logs when size exceeds threshold", async () => {
    const helpers = await loadHost();
    if (!helpers) throw new Error("helpers not found");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odb-native-log-"));
    const logPath = path.join(dir, "log");
    fs.writeFileSync(logPath, Buffer.alloc(5 * 1024 * 1024 + 1));
    const rotated = (helpers.rotateLogIfNeeded as (p: string) => boolean)(logPath);
    expect(rotated).toBe(true);
    expect(fs.existsSync(`${logPath}.1`)).toBe(true);
  });

  it("rejects oversized native messages", async () => {
    const helpers = await loadHost();
    if (!helpers) throw new Error("helpers not found");
    const header = Buffer.alloc(4);
    header.writeUInt32LE(8 * 1024 * 1024 + 1, 0);
    const result = (helpers.parseNativeMessages as (b: Buffer) => { error?: Error })(header);
    expect(result.error).toBeInstanceOf(Error);
  });
});
