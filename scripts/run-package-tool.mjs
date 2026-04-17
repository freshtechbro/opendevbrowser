import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const PACKAGE_TOOL_ENTRIES = Object.freeze({
  eslint: ["node_modules", "eslint", "bin", "eslint.js"],
  tsc: ["node_modules", "typescript", "bin", "tsc"],
  tsup: ["node_modules", "tsup", "dist", "cli-default.js"]
});

export function buildCompileCacheGuardEnv(baseEnv = process.env) {
  const guardedEnv = { ...baseEnv };
  delete guardedEnv.NODE_COMPILE_CACHE;
  guardedEnv.NODE_DISABLE_COMPILE_CACHE = "1";
  return guardedEnv;
}

export function parsePackageToolArgs(args = process.argv.slice(2)) {
  const [toolName, ...toolArgs] = args;
  if (!toolName) {
    throw new Error("Missing required package tool name");
  }
  return { toolName, toolArgs };
}

export function resolvePackageTool(toolName) {
  const segments = PACKAGE_TOOL_ENTRIES[toolName];
  if (!segments) {
    throw new Error(`Unsupported package tool: ${toolName}`);
  }
  const entryPath = path.join(ROOT, ...segments);
  if (!existsSync(entryPath)) {
    throw new Error(`Missing package tool entry: ${entryPath}`);
  }
  return entryPath;
}

export async function runPackageTool(toolName, toolArgs = [], spawnImpl = spawn) {
  const entryPath = resolvePackageTool(toolName);
  return await new Promise((resolve) => {
    const child = spawnImpl(process.execPath, [entryPath, ...toolArgs], {
      cwd: ROOT,
      env: buildCompileCacheGuardEnv(),
      stdio: "inherit"
    });

    child.once("error", (error) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${message}\n`);
      resolve({ exitCode: 1, signal: null });
    });
    child.once("exit", (code, signal) => {
      resolve({ exitCode: typeof code === "number" ? code : 1, signal });
    });
  });
}

export async function runPackageToolCli(args = process.argv.slice(2)) {
  try {
    const { toolName, toolArgs } = parsePackageToolArgs(args);
    const result = await runPackageTool(toolName, toolArgs);
    if (result.signal) {
      process.kill(process.pid, result.signal);
      return 1;
    }
    return result.exitCode;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    return 1;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  const exitCode = await runPackageToolCli();
  process.exit(exitCode);
}
