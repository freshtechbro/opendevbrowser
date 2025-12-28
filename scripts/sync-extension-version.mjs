#!/usr/bin/env node
/**
 * Syncs extension/manifest.json version with root package.json version.
 * Run via: npm run extension:sync
 */

import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

const pkgPath = join(rootDir, 'package.json');
const manifestPath = join(rootDir, 'extension', 'manifest.json');

const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

if (manifest.version !== pkg.version) {
  manifest.version = pkg.version;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
  console.log(`Synced extension version to ${pkg.version}`);
} else {
  console.log(`Extension version already at ${pkg.version}`);
}
