import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { readCookiesFromSource } from "../src/providers/cookie-source";

const tempDirs: string[] = [];

afterEach(() => {
  delete process.env.EMPTY_CAPTURE_COOKIES;
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("cookie source diagnostics", () => {
  it("reports empty env cookie sources explicitly", async () => {
    process.env.EMPTY_CAPTURE_COOKIES = "[]";

    await expect(readCookiesFromSource({
      type: "env",
      value: "EMPTY_CAPTURE_COOKIES"
    })).resolves.toEqual({
      cookies: [],
      available: false,
      message: "Cookie env EMPTY_CAPTURE_COOKIES is empty."
    });
  });

  it("reports empty file cookie sources explicitly", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cookie-source-"));
    tempDirs.push(dir);
    const filePath = join(dir, "cookies.json");
    writeFileSync(filePath, "[]", "utf8");

    await expect(readCookiesFromSource({
      type: "file",
      value: filePath
    })).resolves.toEqual({
      cookies: [],
      available: false,
      message: `Cookie file is empty: ${filePath}`
    });
  });
});
