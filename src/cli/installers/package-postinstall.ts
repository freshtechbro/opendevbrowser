import * as fs from "fs";
import * as path from "path";
import { getAutostartStatus, installAutostart, type AutostartDeps, type AutostartInstallResult, type AutostartStatus } from "../daemon-autostart";
import {
  INSTALL_AUTOSTART_SKIP_ENV_VAR,
  reconcileInstallAutostart,
  shouldSkipInstallAutostartReconciliation,
  type AutostartAction
} from "../install-autostart-reconciliation";
import { getPackageRoot } from "../../utils/package-assets";
import {
  runPostinstallSkillSync,
  type PostinstallSkillSyncResult,
  type RunPostinstallSkillSyncOptions
} from "./postinstall-skill-sync";

const PACKAGE_NAME = "opendevbrowser";
const CLI_ENTRYPOINT_RELATIVE_SEGMENTS = ["dist", "cli", "index.js"] as const;

export type PackagePostinstallContextSkipReason =
  | "not_postinstall"
  | "package_mismatch"
  | "non_npm_package_manager"
  | "local_install"
  | "ambiguous_install"
  | "conflicting_global_context";

export type PostinstallAutostartSkipReason =
  | "disabled"
  | "missing_cli_entrypoint"
  | "unsupported_platform"
  | "already_healthy"
  | "not_repairable"
  | PackagePostinstallContextSkipReason;

export interface PackagePostinstallGlobalContext {
  eligible: boolean;
  message: string;
  reason?: PackagePostinstallContextSkipReason;
  signal?: "npm_config_global" | "npm_config_location";
}

export interface PostinstallAutostartResult {
  success: boolean;
  skipped: boolean;
  attempted: boolean;
  message: string;
  warnings: string[];
  reason?: PostinstallAutostartSkipReason;
  action?: AutostartAction;
  autostart?: AutostartStatus;
  cliPath?: string;
}

export interface PackagePostinstallResult {
  success: boolean;
  skipped: boolean;
  message: string;
  warnings: string[];
  skillSync: PostinstallSkillSyncResult;
  autostart: PostinstallAutostartResult;
}

export interface PackagePostinstallAutostartDeps {
  getAutostartStatus?: (deps?: AutostartDeps) => AutostartStatus;
  installAutostart?: (deps?: AutostartDeps) => AutostartInstallResult;
}

export interface RunPackagePostinstallOptions {
  env?: NodeJS.ProcessEnv;
  skillSyncOptions?: RunPostinstallSkillSyncOptions;
  runSkillSync?: (options?: RunPostinstallSkillSyncOptions) => PostinstallSkillSyncResult;
  packageRoot?: string;
  resolvePackageRoot?: () => string;
  resolveCliEntrypoint?: (packageRoot: string) => string | null;
  existsSync?: typeof fs.existsSync;
  detectGlobalInstall?: (env: NodeJS.ProcessEnv) => PackagePostinstallGlobalContext;
  autostartDeps?: PackagePostinstallAutostartDeps;
}

function createAutostartSkippedResult(
  reason: PostinstallAutostartSkipReason,
  message: string,
  details: Partial<PostinstallAutostartResult> = {}
): PostinstallAutostartResult {
  return {
    success: true,
    skipped: true,
    attempted: false,
    reason,
    message,
    warnings: [],
    ...details
  };
}

function createAutostartWarningResult(
  reason: PostinstallAutostartSkipReason,
  message: string,
  details: Partial<PostinstallAutostartResult> = {}
): PostinstallAutostartResult {
  return {
    success: false,
    skipped: true,
    attempted: false,
    reason,
    message,
    warnings: [message],
    ...details
  };
}

function createContextResult(
  eligible: boolean,
  message: string,
  reason?: PackagePostinstallContextSkipReason,
  signal?: PackagePostinstallGlobalContext["signal"]
): PackagePostinstallGlobalContext {
  return {
    eligible,
    message,
    ...(reason ? { reason } : {}),
    ...(signal ? { signal } : {})
  };
}

function detectGlobalSignal(env: NodeJS.ProcessEnv): PackagePostinstallGlobalContext {
  const globalValue = env.npm_config_global;
  const location = env.npm_config_location;

  if (globalValue === "true" && (location === undefined || location === "global")) {
    return createContextResult(true, "npm global package postinstall detected.", undefined, "npm_config_global");
  }

  if (globalValue === "true" || (globalValue === "false" && location === "global")) {
    return createContextResult(false, "Postinstall autostart skipped because npm global signals conflict.", "conflicting_global_context");
  }

  if (globalValue === undefined && location === "global") {
    return createContextResult(true, "npm global package postinstall detected.", undefined, "npm_config_location");
  }

  if (globalValue === "false" || (location !== undefined && location !== "global")) {
    return createContextResult(false, "Postinstall autostart skipped for local package install.", "local_install");
  }

  return createContextResult(false, "Postinstall autostart skipped because npm global install context is ambiguous.", "ambiguous_install");
}

export function detectNpmGlobalPackagePostinstall(
  env: NodeJS.ProcessEnv = process.env
): PackagePostinstallGlobalContext {
  if (env.npm_lifecycle_event !== "postinstall") {
    return createContextResult(false, "Postinstall autostart skipped outside npm postinstall lifecycle.", "not_postinstall");
  }

  if (env.npm_package_name && env.npm_package_name !== PACKAGE_NAME) {
    return createContextResult(false, "Postinstall autostart skipped for a different package.", "package_mismatch");
  }

  if (env.npm_config_user_agent && !env.npm_config_user_agent.startsWith("npm/")) {
    return createContextResult(false, "Postinstall autostart skipped for non-npm package manager context.", "non_npm_package_manager");
  }

  return detectGlobalSignal(env);
}

function resolvePackageRootForPostinstall(options: RunPackagePostinstallOptions): string {
  if (options.packageRoot) {
    return path.resolve(options.packageRoot);
  }

  if (options.resolvePackageRoot) {
    return path.resolve(options.resolvePackageRoot());
  }

  return getPackageRoot();
}

export function resolvePackagedCliEntrypoint(
  packageRoot: string,
  existsSync: typeof fs.existsSync = fs.existsSync
): string | null {
  const cliPath = path.join(packageRoot, ...CLI_ENTRYPOINT_RELATIVE_SEGMENTS);
  return existsSync(cliPath) ? cliPath : null;
}

function createAutostartDeps(
  cliPath: string,
  deps: PackagePostinstallAutostartDeps = {}
) {
  const resolvedGetAutostartStatus = deps.getAutostartStatus ?? getAutostartStatus;
  const resolvedInstallAutostart = deps.installAutostart ?? installAutostart;

  return {
    getAutostartStatus: () => resolvedGetAutostartStatus({ argv1: cliPath }),
    installAutostart: () => resolvedInstallAutostart({ argv1: cliPath })
  };
}

function convertReconciliationResult(
  result: ReturnType<typeof reconcileInstallAutostart>,
  cliPath: string
): PostinstallAutostartResult {
  if (result.autostartAction === "repair_failed") {
    const detail = result.autostartError ? `: ${result.autostartError}` : ".";
    const message = `Package postinstall autostart reconciliation failed${detail}`;
    return {
      success: false,
      skipped: false,
      attempted: true,
      message,
      warnings: [message],
      action: result.autostartAction,
      autostart: result.autostart,
      cliPath
    };
  }

  return convertNonFailingReconciliationResult(result, cliPath);
}

function convertNonFailingReconciliationResult(
  result: ReturnType<typeof reconcileInstallAutostart>,
  cliPath: string
): PostinstallAutostartResult {
  const action = result.autostartAction;
  if (action === "unsupported") {
    return createAutostartSkippedResult("unsupported_platform", "Postinstall autostart skipped on unsupported platform.", {
      action,
      autostart: result.autostart,
      cliPath
    });
  }

  if (action === "already_healthy") {
    return createAutostartSkippedResult("already_healthy", "Postinstall autostart already healthy.", {
      action,
      autostart: result.autostart,
      cliPath
    });
  }

  if (action === "installed" || action === "repaired") {
    return {
      success: true,
      skipped: false,
      attempted: result.attempted,
      message: `Postinstall autostart ${action}.`,
      warnings: [],
      action,
      autostart: result.autostart,
      cliPath
    };
  }

  return createAutostartSkippedResult("not_repairable", "Postinstall autostart status is not repairable.", {
    autostart: result.autostart,
    cliPath
  });
}

function runPackageAutostartPostinstall(options: RunPackagePostinstallOptions = {}): PostinstallAutostartResult {
  const env = options.env ?? process.env;
  if (shouldSkipInstallAutostartReconciliation(env)) {
    return createAutostartSkippedResult(
      "disabled",
      `Postinstall autostart skipped (${INSTALL_AUTOSTART_SKIP_ENV_VAR}=1).`
    );
  }

  const context = (options.detectGlobalInstall ?? detectNpmGlobalPackagePostinstall)(env);
  if (!context.eligible) {
    return createAutostartSkippedResult(context.reason ?? "ambiguous_install", context.message);
  }

  const packageRoot = resolvePackageRootForPostinstall(options);
  const resolveCliEntrypoint = options.resolveCliEntrypoint ?? ((root: string) => {
    return resolvePackagedCliEntrypoint(root, options.existsSync ?? fs.existsSync);
  });
  const cliPath = resolveCliEntrypoint(packageRoot);

  if (!cliPath) {
    const expectedPath = path.join(packageRoot, ...CLI_ENTRYPOINT_RELATIVE_SEGMENTS);
    return createAutostartWarningResult(
      "missing_cli_entrypoint",
      `Package postinstall autostart skipped: packaged CLI entrypoint not found at ${expectedPath}.`
    );
  }

  const reconciliation = reconcileInstallAutostart(
    { success: true, alreadyInstalled: true },
    createAutostartDeps(cliPath, options.autostartDeps),
    { env }
  );
  return convertReconciliationResult(reconciliation, cliPath);
}

function collectSkillSyncWarnings(result: PostinstallSkillSyncResult): string[] {
  return result.success && !result.skipped ? [] : [result.message];
}

export function runPackagePostinstall(
  options: RunPackagePostinstallOptions = {}
): PackagePostinstallResult {
  const runSkillSync = options.runSkillSync ?? runPostinstallSkillSync;
  const skillSync = runSkillSync(options.skillSyncOptions);
  const autostart = runPackageAutostartPostinstall(options);
  const warnings = [...collectSkillSyncWarnings(skillSync), ...autostart.warnings];
  const success = skillSync.success && autostart.success;
  const skipped = skillSync.skipped && autostart.skipped;

  return {
    success,
    skipped,
    message: success ? "Package postinstall completed." : "Package postinstall completed with warnings.",
    warnings,
    skillSync,
    autostart
  };
}
