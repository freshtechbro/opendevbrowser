import { createHash } from "crypto";
import { access, readFile } from "fs/promises";
import { dirname, isAbsolute, join, resolve } from "path";
import { pathToFileURL } from "url";
import type { CanvasFrameworkAdapterRegistry } from "../framework-adapters/registry";
import type { CanvasLibraryAdapterRegistry } from "../library-adapters/registry";
import { parseCanvasAdapterPluginManifest, normalizeCanvasAdapterPluginDeclaration } from "./manifest";
import type {
  CanvasAdapterPluginDeclaration,
  CanvasAdapterPluginLoadError,
  CanvasAdapterPluginLibraryDescriptor,
  CanvasAdapterPluginManifest,
  CanvasAdapterPluginFrameworkDescriptor,
  CanvasLoadedAdapterPlugin
} from "./types";
import { validatePluginTrust } from "./validator";

type PluginCacheEntry = {
  fingerprint: string;
  loaded: CanvasLoadedAdapterPlugin;
};

type ResolvedPluginDeclaration = {
  ref: string;
  source: "package" | "repo" | "config";
  enabled: boolean;
  trustedWorkspaceRoots?: string[];
  capabilityOverrides?: CanvasAdapterPluginManifest["capabilities"];
};

const pluginCache = new Map<string, PluginCacheEntry>();

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8")) as unknown;
}

async function loadPackageJson(worktree: string): Promise<Record<string, unknown>> {
  const packagePath = join(worktree, "package.json");
  try {
    return await readJson(packagePath) as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

function createFingerprint(parts: string[]): string {
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

function uniqueStrings(values: string[] | undefined): string[] | undefined {
  if (!values || values.length === 0) {
    return undefined;
  }
  return [...new Set(values)];
}

function applyCapabilityOverrideList<T extends { capabilities: CanvasAdapterPluginManifest["capabilities"] }>(
  value: T,
  capabilityOverrides: Set<string> | null
): T {
  if (!capabilityOverrides) {
    return value;
  }
  return {
    ...value,
    capabilities: value.capabilities.filter((capability) => capabilityOverrides.has(capability))
  };
}

function applyDeclarationOverrides(
  manifest: CanvasAdapterPluginManifest,
  declaration: ResolvedPluginDeclaration
): CanvasAdapterPluginManifest {
  const capabilityOverrides = declaration.capabilityOverrides && declaration.capabilityOverrides.length > 0
    ? new Set(declaration.capabilityOverrides)
    : null;
  return {
    ...manifest,
    capabilities: capabilityOverrides
      ? manifest.capabilities.filter((capability) => capabilityOverrides.has(capability))
      : [...manifest.capabilities],
    trustedWorkspaceRoots: uniqueStrings([
      ...manifest.trustedWorkspaceRoots,
      ...(declaration.trustedWorkspaceRoots ?? [])
    ]) ?? [],
    frameworkAdapters: manifest.frameworkAdapters.map((descriptor) =>
      applyCapabilityOverrideList<CanvasAdapterPluginFrameworkDescriptor>({ ...descriptor }, capabilityOverrides)
    ),
    libraryAdapters: manifest.libraryAdapters.map((descriptor) =>
      applyCapabilityOverrideList<CanvasAdapterPluginLibraryDescriptor>({ ...descriptor }, capabilityOverrides)
    )
  };
}

async function resolveDeclarationRef(worktree: string, ref: string): Promise<{ packageRoot: string; manifestPath: string }> {
  const direct = isAbsolute(ref) ? ref : resolve(worktree, ref);
  if (await exists(direct)) {
    const manifestPath = direct.endsWith(".json") ? direct : join(direct, "canvas-adapter.plugin.json");
    return {
      packageRoot: direct.endsWith(".json") ? dirname(direct) : direct,
      manifestPath
    };
  }
  const nodeModulesPath = join(worktree, "node_modules", ref);
  const manifestPath = join(nodeModulesPath, "canvas-adapter.plugin.json");
  return {
    packageRoot: nodeModulesPath,
    manifestPath
  };
}

async function readDeclarationSource(worktree: string): Promise<{
  packageDeclarations: CanvasAdapterPluginDeclaration[];
  repoDeclarations: CanvasAdapterPluginDeclaration[];
}> {
  const packageJson = await loadPackageJson(worktree);
  const openDevBrowserConfig = isRecord(packageJson.opendevbrowser) ? packageJson.opendevbrowser : null;
  const canvasConfig = openDevBrowserConfig && isRecord(openDevBrowserConfig.canvas) ? openDevBrowserConfig.canvas : null;
  const packageDeclarations = Array.isArray(canvasConfig?.adapterPlugins)
    ? canvasConfig.adapterPlugins as CanvasAdapterPluginDeclaration[]
    : [];
  const repoFile = join(worktree, ".opendevbrowser", "canvas", "adapters.json");
  const repoDeclarations = await exists(repoFile)
    ? ((await readJson(repoFile) as { adapterPlugins?: CanvasAdapterPluginDeclaration[] }).adapterPlugins ?? [])
    : [];
  return { packageDeclarations, repoDeclarations };
}

function mergeDeclarations(params: {
  packageDeclarations: CanvasAdapterPluginDeclaration[];
  repoDeclarations: CanvasAdapterPluginDeclaration[];
  configDeclarations: CanvasAdapterPluginDeclaration[];
}): ResolvedPluginDeclaration[] {
  const merged = new Map<string, ResolvedPluginDeclaration>();
  for (const [source, declarations] of [
    ["package", params.packageDeclarations],
    ["repo", params.repoDeclarations],
    ["config", params.configDeclarations]
  ] as const) {
    for (const raw of declarations) {
      const declaration = normalizeCanvasAdapterPluginDeclaration(raw);
      const existing = merged.get(declaration.ref);
      merged.set(declaration.ref, {
        ref: declaration.ref,
        source,
        enabled: declaration.enabled !== false,
        trustedWorkspaceRoots: uniqueStrings(declaration.trustedWorkspaceRoots ?? existing?.trustedWorkspaceRoots),
        capabilityOverrides: declaration.capabilityOverrides ?? existing?.capabilityOverrides
      });
    }
  }
  return [...merged.values()].filter((entry) => entry.enabled);
}

function applyCapabilityOverridesToRegisteredAdapters(params: {
  manifest: CanvasAdapterPluginManifest;
  declaration: ResolvedPluginDeclaration;
  frameworkRegistry: CanvasFrameworkAdapterRegistry;
  libraryRegistry: CanvasLibraryAdapterRegistry;
}): void {
  const capabilityOverrides = params.declaration.capabilityOverrides && params.declaration.capabilityOverrides.length > 0
    ? new Set(params.declaration.capabilityOverrides)
    : null;
  if (!capabilityOverrides) {
    return;
  }
  for (const descriptor of params.manifest.frameworkAdapters) {
    const adapter = params.frameworkRegistry.get(descriptor.id);
    if (adapter) {
      adapter.capabilities = adapter.capabilities.filter((capability) => capabilityOverrides.has(capability));
    }
  }
  for (const descriptor of params.manifest.libraryAdapters) {
    const adapter = params.libraryRegistry.get(descriptor.id);
    if (adapter) {
      adapter.capabilities = adapter.capabilities.filter((capability) => capabilityOverrides.has(capability));
    }
  }
}

async function fingerprintPluginFiles(manifestPath: string, packageRoot: string, manifest: CanvasAdapterPluginManifest): Promise<string> {
  const entryPath = resolve(packageRoot, manifest.entry);
  const fixturePath = resolve(packageRoot, manifest.fixtureDir);
  const packageJsonPath = join(packageRoot, "package.json");
  const [manifestContent, entryContent, packageJsonContent] = await Promise.all([
    readFile(manifestPath, "utf8"),
    readFile(entryPath, "utf8"),
    await exists(packageJsonPath) ? readFile(packageJsonPath, "utf8") : Promise.resolve(""),
  ]);
  return createFingerprint([manifestContent, entryContent, packageJsonContent, fixturePath]);
}

export async function loadCanvasAdapterPlugins(params: {
  worktree: string;
  configDeclarations?: CanvasAdapterPluginDeclaration[];
  frameworkRegistry: CanvasFrameworkAdapterRegistry;
  libraryRegistry: CanvasLibraryAdapterRegistry;
}): Promise<{
  plugins: CanvasLoadedAdapterPlugin[];
  errors: CanvasAdapterPluginLoadError[];
}> {
  const { packageDeclarations, repoDeclarations } = await readDeclarationSource(params.worktree);
  const declarations = mergeDeclarations({
    packageDeclarations,
    repoDeclarations,
    configDeclarations: params.configDeclarations ?? []
  });
  const plugins: CanvasLoadedAdapterPlugin[] = [];
  const errors: CanvasAdapterPluginLoadError[] = [];
  const seenPluginIds = new Set<string>();

  for (const declaration of declarations) {
    try {
      const { packageRoot, manifestPath } = await resolveDeclarationRef(params.worktree, declaration.ref);
      const parsedManifest = parseCanvasAdapterPluginManifest(await readJson(manifestPath));
      const manifest = applyDeclarationOverrides(parsedManifest, declaration);
      await validatePluginTrust({
        ref: declaration.ref,
        packageRoot,
        manifest,
        worktree: params.worktree,
        source: declaration.source
      });
      const fingerprint = await fingerprintPluginFiles(manifestPath, packageRoot, manifest);
      const cacheKey = `${manifest.pluginId}:${manifestPath}`;
      const cached = pluginCache.get(cacheKey);
      if (cached?.fingerprint === fingerprint) {
        plugins.push(cached.loaded);
        continue;
      }
      if (seenPluginIds.has(manifest.pluginId)) {
        throw Object.assign(new Error("duplicate_plugin_id"), { pluginId: manifest.pluginId });
      }
      seenPluginIds.add(manifest.pluginId);
      const entryPath = resolve(packageRoot, manifest.entry);
      const pluginModule = await import(pathToFileURL(entryPath).href);
      const factory = pluginModule.createCanvasAdapterPlugin;
      if (typeof factory !== "function") {
        throw Object.assign(new Error("entry_export_invalid"), { pluginId: manifest.pluginId });
      }
      const definition = await factory({ manifest });
      await definition.validateWorkspace({ worktree: params.worktree });
      await definition.initialize({ worktree: params.worktree });
      await definition.registerFrameworkAdapters(params.frameworkRegistry);
      await definition.registerLibraryAdapters(params.libraryRegistry);
      applyCapabilityOverridesToRegisteredAdapters({
        manifest,
        declaration,
        frameworkRegistry: params.frameworkRegistry,
        libraryRegistry: params.libraryRegistry
      });
      const loaded = {
        manifest,
        definition,
        packageRoot,
        fixtureDir: resolve(packageRoot, manifest.fixtureDir)
      } satisfies CanvasLoadedAdapterPlugin;
      pluginCache.set(cacheKey, { fingerprint, loaded });
      plugins.push(loaded);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isZodLikeError = Boolean(
        error
        && typeof error === "object"
        && "name" in error
        && (error as { name?: string }).name === "ZodError"
      ) || message.includes("ZodError");
      errors.push({
        code: message === "duplicate_plugin_id"
          ? "duplicate_plugin_id"
          : message === "entry_export_invalid"
            ? "entry_export_invalid"
            : message === "trust_denied"
              ? "trust_denied"
              : isZodLikeError
                ? "plugin_manifest_invalid"
                : message.includes("Cannot find module")
                  ? "dependency_missing"
                  : "plugin_load_failed",
        ...(typeof (error as { pluginId?: string }).pluginId === "string" ? { pluginId: (error as { pluginId: string }).pluginId } : {}),
        ref: declaration.ref,
        message
      });
    }
  }

  return { plugins, errors };
}
