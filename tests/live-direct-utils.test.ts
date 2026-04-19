import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runNodeAsync } from "../scripts/live-direct-utils.mjs";

const tempDirs = [];

function writeTempScript(source) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odb-live-direct-utils-"));
  const scriptPath = path.join(dir, "child.mjs");
  fs.writeFileSync(scriptPath, `${source}\n`, "utf8");
  tempDirs.push(dir);
  return scriptPath;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("live-direct-utils", () => {
  it("parses trailing pretty-printed JSON from async child runs", async () => {
    const scriptPath = writeTempScript(`
      console.log("/tmp/fixture-artifact.json");
      console.log(JSON.stringify({
        ok: true,
        summary: {
          status: "pass"
        }
      }, null, 2));
    `);

    const result = await runNodeAsync([scriptPath]);

    expect(result.status).toBe(0);
    expect(result.json).toEqual({
      ok: true,
      summary: {
        status: "pass"
      }
    });
  });

  it("reports async child timeouts with the standard timeout detail", async () => {
    const scriptPath = writeTempScript(`
      await new Promise((resolve) => setTimeout(resolve, 200));
    `);

    const result = await runNodeAsync([scriptPath], {
      allowFailure: true,
      timeoutMs: 50
    });

    expect(result.status).toBeGreaterThan(0);
    expect(result.timedOut).toBe(true);
    expect(result.detail).toContain("Node script timed out after 50ms");
  });

  it("kills stubborn async children that ignore SIGTERM", async () => {
    const scriptPath = writeTempScript(`
      process.on("SIGTERM", () => {
        process.stdout.write("ignoring-sigterm\\n");
      });
      process.stdout.write("ready\\n");
      setInterval(() => {}, 1_000);
    `);

    const startedAt = Date.now();
    const result = await runNodeAsync([scriptPath], {
      allowFailure: true,
      timeoutMs: 1_500
    });

    expect(result.status).toBeGreaterThan(0);
    expect(result.timedOut).toBe(true);
    expect(result.stdout).toContain("ready");
    expect(result.stdout).toContain("ignoring-sigterm");
    expect(result.signal).toBe("SIGKILL");
    expect(Date.now() - startedAt).toBeLessThan(4_000);
  });
});
