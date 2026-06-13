import { lstat, mkdir, readdir, readFile, realpath, rm, writeFile } from "fs/promises";
import { dirname, isAbsolute, join, posix, relative, resolve, sep, win32 } from "path";
import { randomUUID } from "crypto";

export const DEFAULT_ARTIFACT_TTL_HOURS = 72;
export const MAX_ARTIFACT_TTL_HOURS = 168;

type ArtifactContent = string | Buffer | Record<string, unknown>;

export interface ArtifactFile {
  path: string;
  content: ArtifactContent;
}

export interface ArtifactManifest {
  run_id: string;
  created_at: string;
  ttl_hours: number;
  expires_at: string;
  files: string[];
}

export interface ArtifactBundle {
  runId: string;
  basePath: string;
  manifest: ArtifactManifest;
}

const SAFE_NAMESPACE_PATTERN = /^[A-Za-z0-9_-]+$/;

const clampTtlHours = (value: number | undefined): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_ARTIFACT_TTL_HOURS;
  }
  return Math.min(MAX_ARTIFACT_TTL_HOURS, Math.floor(value));
};

const serializeContent = (content: ArtifactContent): string | Buffer => {
  if (typeof content === "string" || Buffer.isBuffer(content)) {
    return content;
  }
  return `${JSON.stringify(content, null, 2)}\n`;
};

const isInsideDirectory = (parent: string, child: string): boolean => {
  const relativePath = relative(parent, child);
  return relativePath === "" || (!relativePath.startsWith(`..${sep}`) && relativePath !== ".." && !isAbsolute(relativePath));
};

const validateArtifactNamespace = (namespace: string): string => {
  if (typeof namespace !== "string" || !SAFE_NAMESPACE_PATTERN.test(namespace)) {
    throw new Error("Artifact namespace must be a safe path segment");
  }
  return namespace;
};

const ensureSafeArtifactDirectory = async (directoryPath: string, errorMessage: string): Promise<string> => {
  await mkdir(directoryPath, { recursive: true, mode: 0o700 });
  const metadata = await lstat(directoryPath);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(errorMessage);
  }
  return realpath(directoryPath);
};

const readSafeArtifactDirectory = async (directoryPath: string, errorMessage: string): Promise<string> => {
  const metadata = await lstat(directoryPath);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(errorMessage);
  }
  return realpath(directoryPath);
};

const validateArtifactFilePath = (filePath: string, basePath: string): { manifestPath: string; absolutePath: string } => {
  if (typeof filePath !== "string" || filePath.trim().length === 0) {
    throw new Error("Artifact file path must be a safe relative path");
  }
  if (isAbsolute(filePath) || win32.isAbsolute(filePath)) {
    throw new Error("Artifact file path must be a safe relative path");
  }
  if (filePath.includes("\\")) {
    throw new Error("Artifact file path must be a safe relative path");
  }
  const segments = filePath.split(/[\\/]+/);
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    throw new Error("Artifact file path must be a safe relative path");
  }
  const manifestPath = posix.normalize(filePath);
  const absolutePath = resolve(basePath, manifestPath);
  if (!isInsideDirectory(basePath, absolutePath)) {
    throw new Error("Artifact file path must be a safe relative path");
  }
  return { manifestPath, absolutePath };
};

export interface CreateArtifactBundleArgs {
  namespace: string;
  files: ArtifactFile[];
  outputDir: string;
  ttlHours?: number;
  now?: Date;
}

export const createArtifactBundle = async (args: CreateArtifactBundleArgs): Promise<ArtifactBundle> => {
  const outputDir = args.outputDir;
  if (typeof outputDir !== "string") {
    throw new Error("outputDir is required");
  }
  if (outputDir.trim().length === 0) {
    throw new Error("outputDir cannot be empty");
  }

  const runId = randomUUID();
  const now = args.now ?? new Date();
  const ttlHours = clampTtlHours(args.ttlHours);
  const expiresAt = new Date(now.getTime() + ttlHours * 60 * 60 * 1000);
  const namespace = validateArtifactNamespace(args.namespace);
  const root = resolve(outputDir);
  const realRoot = await ensureSafeArtifactDirectory(root, "Artifact output directory must be a real directory");
  const namespacePath = join(root, namespace);
  const realNamespace = await ensureSafeArtifactDirectory(namespacePath, "Artifact namespace directory must be a real directory");
  if (!isInsideDirectory(realRoot, realNamespace)) {
    throw new Error("Artifact namespace directory must stay inside output directory");
  }
  const basePath = join(namespacePath, runId);

  await mkdir(basePath, { mode: 0o700 });
  const realBasePath = await readSafeArtifactDirectory(basePath, "Artifact bundle directory must be a real directory");
  if (!isInsideDirectory(realRoot, realBasePath) || !isInsideDirectory(realNamespace, realBasePath)) {
    throw new Error("Artifact bundle directory must stay inside output directory");
  }

  const writtenFiles: string[] = [];
  for (const file of args.files) {
    const safePath = validateArtifactFilePath(file.path, basePath);
    const directory = dirname(safePath.absolutePath);
    if (directory && directory !== basePath) {
      await mkdir(directory, { recursive: true, mode: 0o700 });
    }
    await writeFile(safePath.absolutePath, serializeContent(file.content), { mode: 0o600 });
    writtenFiles.push(safePath.manifestPath);
  }

  const manifest: ArtifactManifest = {
    run_id: runId,
    created_at: now.toISOString(),
    ttl_hours: ttlHours,
    expires_at: expiresAt.toISOString(),
    files: [...writtenFiles, "bundle-manifest.json"]
  };

  await writeFile(join(basePath, "bundle-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });

  return {
    runId,
    basePath,
    manifest
  };
};

const isExpired = (manifest: ArtifactManifest, now: Date): boolean => {
  const expiry = new Date(manifest.expires_at);
  if (Number.isNaN(expiry.getTime())) return false;
  return expiry.getTime() <= now.getTime();
};

const readSafeDirectory = async (
  directoryPath: string,
  realRoot: string
): Promise<{ entries: string[]; realPath: string } | null> => {
  const metadata = await lstat(directoryPath);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    return null;
  }
  const realDirectory = await realpath(directoryPath);
  if (!isInsideDirectory(realRoot, realDirectory)) {
    return null;
  }
  return {
    entries: await readdir(directoryPath),
    realPath: realDirectory
  };
};

export const cleanupExpiredArtifacts = async (
  rootDir: string,
  now: Date = new Date()
): Promise<{ removed: string[]; skipped: string[] }> => {
  const removed: string[] = [];
  const skipped: string[] = [];

  let namespaces: string[] = [];
  let realRoot = "";
  try {
    const rootMetadata = await lstat(rootDir);
    if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
      skipped.push(rootDir);
      return { removed, skipped };
    }
    realRoot = await realpath(rootDir);
    namespaces = await readdir(rootDir);
  } catch {
    return { removed, skipped };
  }

  for (const namespace of namespaces) {
    const namespacePath = join(rootDir, namespace);
    let namespaceDirectory: { entries: string[]; realPath: string } | null = null;
    try {
      namespaceDirectory = await readSafeDirectory(namespacePath, realRoot);
    } catch {
      continue;
    }
    if (!namespaceDirectory) {
      continue;
    }

    for (const run of namespaceDirectory.entries) {
      const runPath = join(namespacePath, run);
      const manifestPath = join(runPath, "bundle-manifest.json");
      try {
        const runMetadata = await lstat(runPath);
        if (!runMetadata.isDirectory() || runMetadata.isSymbolicLink()) {
          skipped.push(runPath);
          continue;
        }
        const realRunPath = await realpath(runPath);
        if (!isInsideDirectory(realRoot, realRunPath) || !isInsideDirectory(namespaceDirectory.realPath, realRunPath)) {
          skipped.push(runPath);
          continue;
        }
        const metadata = await lstat(manifestPath);
        if (!metadata.isFile() || metadata.isSymbolicLink()) {
          skipped.push(runPath);
          continue;
        }
        const manifestRaw = await readFile(manifestPath, "utf8");
        const manifest = JSON.parse(manifestRaw) as ArtifactManifest;
        if (isExpired(manifest, now)) {
          const deletionTarget = await realpath(runPath);
          if (deletionTarget !== realRunPath || !isInsideDirectory(realRoot, deletionTarget) || !isInsideDirectory(namespaceDirectory.realPath, deletionTarget)) {
            skipped.push(runPath);
            continue;
          }
          await rm(deletionTarget, { recursive: true, force: true });
          removed.push(runPath);
        } else {
          skipped.push(runPath);
        }
      } catch {
        skipped.push(runPath);
      }
    }
  }

  return { removed, skipped };
};
