import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_MANIFEST_PATH = path.join(ROOT, "src/public-surface/generated-manifest.json");

function ensureManifestShape(manifest, manifestPath) {
  const counts = manifest?.counts;
  const cli = manifest?.cli;
  const tools = manifest?.tools;
  if (
    typeof counts?.commandCount !== "number"
    || typeof counts?.toolCount !== "number"
    || typeof counts?.cliToolPairCount !== "number"
    || !Array.isArray(cli?.commands)
    || !Array.isArray(tools?.entries)
    || !Array.isArray(tools?.cliToolPairs)
  ) {
    throw new Error(`Invalid public surface manifest: ${manifestPath}`);
  }
  return manifest;
}

export function readPublicSurfaceManifest(rootDir = ROOT) {
  const manifestPath = rootDir === ROOT
    ? DEFAULT_MANIFEST_PATH
    : path.join(rootDir, "src/public-surface/generated-manifest.json");
  return ensureManifestShape(JSON.parse(fs.readFileSync(manifestPath, "utf8")), manifestPath);
}

export function getPublicSurfaceCounts(rootDir = ROOT) {
  const manifest = readPublicSurfaceManifest(rootDir);
  return {
    commandCount: manifest.counts.commandCount,
    toolCount: manifest.counts.toolCount,
    cliToolPairCount: manifest.counts.cliToolPairCount,
    commandNames: manifest.cli.commands.map((entry) => entry.name),
    toolNames: manifest.tools.entries.map((entry) => entry.name),
    cliToolPairs: manifest.tools.cliToolPairs.map((entry) => [entry.cliCommand, entry.toolName])
  };
}

export function getPublicSurfaceToolEntries(rootDir = ROOT) {
  return readPublicSurfaceManifest(rootDir).tools.entries.map((entry) => ({
    name: entry.name,
    description: entry.description,
    cliEquivalent: entry.cliEquivalent ?? null
  }));
}
