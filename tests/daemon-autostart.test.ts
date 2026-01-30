import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { pathToFileURL } from "url";
import {
  buildLaunchAgentPlist,
  buildWindowsTaskArgs,
  resolveCliEntrypoint
} from "../src/cli/daemon-autostart";

describe("daemon autostart helpers", () => {
  it("resolves CLI entrypoint from argv1 when present", () => {
    const root = mkdtempSync(join(tmpdir(), "odb-cli-entry-"));
    const cliPath = join(root, "index.js");
    writeFileSync(cliPath, "// test", "utf-8");

    const entry = resolveCliEntrypoint({
      argv1: cliPath
    });

    expect(entry.cliPath).toBe(resolve(cliPath));
    expect(entry.command).toContain(entry.nodePath);
    expect(entry.command).toContain(entry.cliPath);
  });

  it("resolves CLI entrypoint from module location when argv1 is missing", () => {
    const root = mkdtempSync(join(tmpdir(), "odb-cli-module-"));
    const cliDir = join(root, "cli");
    const commandsDir = join(cliDir, "commands");
    const cliPath = join(cliDir, "index.js");
    const commandPath = join(commandsDir, "daemon.js");
    mkdirSync(commandsDir, { recursive: true });
    writeFileSync(cliPath, "// cli", "utf-8");
    writeFileSync(commandPath, "// command", "utf-8");

    const entry = resolveCliEntrypoint({
      argv1: join(root, "missing.js"),
      moduleUrl: pathToFileURL(commandPath).toString()
    });

    expect(entry.cliPath).toBe(resolve(cliPath));
  });

  it("builds a launch agent plist with program arguments", () => {
    const entry = {
      nodePath: "/node",
      cliPath: "/cli/index.js",
      args: ["/cli/index.js", "serve"],
      command: "\"/node\" \"/cli/index.js\" serve"
    };
    const plist = buildLaunchAgentPlist(entry, { label: "com.test.daemon" });
    expect(plist).toContain("com.test.daemon");
    expect(plist).toContain("/node");
    expect(plist).toContain("/cli/index.js");
    expect(plist).toContain("serve");
  });

  it("builds Windows task args", () => {
    const entry = {
      nodePath: "C:\\node.exe",
      cliPath: "C:\\cli\\index.js",
      args: ["C:\\cli\\index.js", "serve"],
      command: "\"C:\\node.exe\" \"C:\\cli\\index.js\" serve"
    };
    const task = buildWindowsTaskArgs(entry, "Test Task");
    expect(task.args).toContain("/Create");
    expect(task.args).toContain("/TN");
    expect(task.args).toContain("Test Task");
    expect(task.command).toContain("serve");
  });
});
