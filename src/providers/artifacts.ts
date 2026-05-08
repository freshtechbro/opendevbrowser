import { mkdir, readdir, readFile, rm, stat, writeFile } from "fs/promises";
import { dirname, join, resolve } from "path";
import { randomUUID } from "crypto";
import { tmpdir } from "os";

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

export const createArtifactBundle = async (args: {
  namespace: string;
  files: ArtifactFile[];
  outputDir?: string;
  ttlHours?: number;
  now?: Date;
}): Promise<ArtifactBundle> => {
  const runId = randomUUID();
  const now = args.now ?? new Date();
  const ttlHours = clampTtlHours(args.ttlHours);
  const expiresAt = new Date(now.getTime() + ttlHours * 60 * 60 * 1000);
  const root = args.outputDir ? resolve(args.outputDir) : join(tmpdir(), "opendevbrowser");
  const basePath = join(root, args.namespace, runId);

  await mkdir(basePath, { recursive: true, mode: 0o700 });

  const writtenFiles: string[] = [];
  for (const file of args.files) {
    const filePath = join(basePath, file.path);
    const directory = dirname(filePath);
    if (directory && directory !== basePath) {
      await mkdir(directory, { recursive: true, mode: 0o700 });
    }
    await writeFile(filePath, serializeContent(file.content), { mode: 0o600 });
    writtenFiles.push(file.path);
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

export const cleanupExpiredArtifacts = async (
  rootDir: string,
  now: Date = new Date()
): Promise<{ removed: string[]; skipped: string[] }> => {
  const removed: string[] = [];
  const skipped: string[] = [];

  let namespaces: string[] = [];
  try {
    namespaces = await readdir(rootDir);
  } catch {
    return { removed, skipped };
  }

  for (const namespace of namespaces) {
    const namespacePath = join(rootDir, namespace);
    let runs: string[] = [];
    try {
      runs = await readdir(namespacePath);
    } catch {
      continue;
    }

    for (const run of runs) {
      const runPath = join(namespacePath, run);
      const manifestPath = join(runPath, "bundle-manifest.json");
      try {
        const metadata = await stat(manifestPath);
        if (!metadata.isFile()) {
          skipped.push(runPath);
          continue;
        }
        const manifestRaw = await readFile(manifestPath, "utf8");
        const manifest = JSON.parse(manifestRaw) as ArtifactManifest;
        if (isExpired(manifest, now)) {
          await rm(runPath, { recursive: true, force: true });
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
