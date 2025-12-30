import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { writeFileAtomic } from "../src/utils/fs";

describe("writeFileAtomic", () => {
  const testDir = path.join(__dirname, ".test-fs-atomic");
  const testFile = path.join(testDir, "test-config.json");

  beforeEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("creates directory if it does not exist", () => {
    const content = '{"test": true}';
    writeFileAtomic(testFile, content);

    expect(fs.existsSync(testDir)).toBe(true);
    expect(fs.readFileSync(testFile, "utf-8")).toBe(content);
  });

  it("writes content atomically to existing directory", () => {
    fs.mkdirSync(testDir, { recursive: true });
    const content = '{"key": "value"}';

    writeFileAtomic(testFile, content);

    expect(fs.readFileSync(testFile, "utf-8")).toBe(content);
  });

  it("overwrites existing file atomically", () => {
    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(testFile, '{"old": true}');

    const newContent = '{"new": true}';
    writeFileAtomic(testFile, newContent);

    expect(fs.readFileSync(testFile, "utf-8")).toBe(newContent);
  });

  it("respects custom encoding option", () => {
    const content = "test content";
    writeFileAtomic(testFile, content, { encoding: "utf-8" });

    expect(fs.readFileSync(testFile, "utf-8")).toBe(content);
  });

  it("respects custom mode option", () => {
    const content = "test content";
    writeFileAtomic(testFile, content, { mode: 0o600 });

    expect(fs.readFileSync(testFile, "utf-8")).toBe(content);
    const stats = fs.statSync(testFile);
    expect(stats.mode & 0o777).toBe(0o600);
  });

  it("does not leave temp files on success", () => {
    fs.mkdirSync(testDir, { recursive: true });

    writeFileAtomic(testFile, "content");

    const files = fs.readdirSync(testDir);
    const tempFiles = files.filter((f) => f.endsWith(".tmp"));
    expect(tempFiles.length).toBe(0);
    expect(files).toContain("test-config.json");
  });

  it("preserves file content integrity with special characters", () => {
    const content = '{"unicode": "日本語", "emoji": "🚀", "newlines": "a\\nb\\nc"}';
    writeFileAtomic(testFile, content);

    expect(fs.readFileSync(testFile, "utf-8")).toBe(content);
  });

  it("handles empty content", () => {
    writeFileAtomic(testFile, "");

    expect(fs.readFileSync(testFile, "utf-8")).toBe("");
  });

  it("handles large content", () => {
    const largeContent = "x".repeat(100000);
    writeFileAtomic(testFile, largeContent);

    expect(fs.readFileSync(testFile, "utf-8")).toBe(largeContent);
  });

  it("creates nested directories", () => {
    const nestedFile = path.join(testDir, "a", "b", "c", "config.json");
    const content = '{"nested": true}';

    writeFileAtomic(nestedFile, content);

    expect(fs.existsSync(nestedFile)).toBe(true);
    expect(fs.readFileSync(nestedFile, "utf-8")).toBe(content);
  });

  it("cleans up temp file and rethrows on write failure", () => {
    fs.mkdirSync(testDir, { recursive: true });
    const readOnlyDir = path.join(testDir, "readonly");
    fs.mkdirSync(readOnlyDir);
    fs.chmodSync(readOnlyDir, 0o444);

    const failFile = path.join(readOnlyDir, "fail.json");

    try {
      expect(() => writeFileAtomic(failFile, "content")).toThrow();
    } finally {
      fs.chmodSync(readOnlyDir, 0o755);
    }

    const files = fs.readdirSync(readOnlyDir);
    const tempFiles = files.filter((f) => f.endsWith(".tmp"));
    expect(tempFiles.length).toBe(0);
  });

  it("handles cleanup failure gracefully", () => {
    expect(() => writeFileAtomic("/nonexistent/path/file.json", "content")).toThrow();
  });

  it("cleans up temp file when rename fails", () => {
    fs.mkdirSync(testDir, { recursive: true });
    const targetDir = path.join(testDir, "target-is-dir");
    fs.mkdirSync(targetDir);

    expect(() => writeFileAtomic(targetDir, "content")).toThrow();

    const files = fs.readdirSync(testDir);
    const tempFiles = files.filter((f) => f.endsWith(".tmp"));
    expect(tempFiles.length).toBe(0);
  });
});
