import path from "node:path";
import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import {
  buildCompileCacheGuardEnv,
  parsePackageToolArgs,
  resolvePackageTool,
  runPackageTool
} from "../scripts/run-package-tool.mjs";

class MockChildProcess extends EventEmitter {}

type SpawnCall = {
  command: string;
  args: string[];
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    stdio: string;
  };
};

describe("run-package-tool script", () => {
  it("adds the compile-cache guard without mutating unrelated env keys", () => {
    const guardedEnv = buildCompileCacheGuardEnv({
      KEEP_ME: "value",
      NODE_COMPILE_CACHE: "/tmp/node-cache"
    });

    expect(guardedEnv.KEEP_ME).toBe("value");
    expect(guardedEnv.NODE_DISABLE_COMPILE_CACHE).toBe("1");
    expect("NODE_COMPILE_CACHE" in guardedEnv).toBe(false);
  });

  it("parses a required tool name and passthrough args", () => {
    expect(parsePackageToolArgs(["eslint", "--help"])).toEqual({
      toolName: "eslint",
      toolArgs: ["--help"]
    });
    expect(() => parsePackageToolArgs([])).toThrow("Missing required package tool name");
  });

  it("resolves supported tool entries and rejects unsupported tools", () => {
    expect(resolvePackageTool("eslint")).toContain(
      path.join("node_modules", "eslint", "bin", "eslint.js")
    );
    expect(resolvePackageTool("tsc")).toContain(
      path.join("node_modules", "typescript", "bin", "tsc")
    );
    expect(resolvePackageTool("tsup")).toContain(
      path.join("node_modules", "tsup", "dist", "cli-default.js")
    );
    expect(() => resolvePackageTool("unknown-tool")).toThrow("Unsupported package tool");
  });

  it("spawns local tools through process.execPath with guarded env and propagates exit codes", async () => {
    const spawnCalls: SpawnCall[] = [];
    const spawnImpl = (
      command: string,
      args: string[],
      options: SpawnCall["options"]
    ) => {
      spawnCalls.push({ command, args, options });
      const child = new MockChildProcess();
      queueMicrotask(() => {
        child.emit("exit", 2, null);
      });
      return child;
    };

    const result = await runPackageTool("eslint", ["--help"], spawnImpl);

    expect(result).toEqual({ exitCode: 2, signal: null });
    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0]?.command).toBe(process.execPath);
    expect(spawnCalls[0]?.args).toEqual([
      expect.stringContaining(path.join("node_modules", "eslint", "bin", "eslint.js")),
      "--help"
    ]);
    expect(spawnCalls[0]?.options.cwd).toBe(path.resolve(process.cwd()));
    expect(spawnCalls[0]?.options.stdio).toBe("inherit");
    expect(spawnCalls[0]?.options.env.NODE_DISABLE_COMPILE_CACHE).toBe("1");
    expect("NODE_COMPILE_CACHE" in spawnCalls[0].options.env).toBe(false);
  });
});
