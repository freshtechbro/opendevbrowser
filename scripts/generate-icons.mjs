#!/usr/bin/env node
/**
 * Generate all raster icon variants from favicon.svg
 * Uses @resvg/resvg-js for high-quality SVG→PNG rasterization with transparency.
 */
import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(__dirname, '..', 'assets');
const SVG = readFileSync(join(ASSETS, 'favicon.svg'), 'utf-8');

const targets = [
  // App icons
  { path: 'icon-16.png', size: 16 },
  { path: 'icon-32.png', size: 32 },
  { path: 'icon-48.png', size: 48 },
  { path: 'icon-128.png', size: 128 },
  { path: 'icon-256.png', size: 256 },
  { path: 'icon-512.png', size: 512 },
  { path: 'icon-1024.png', size: 1024 },
  // Favicons
  { path: 'favicon-16x16.png', size: 16 },
  { path: 'favicon-32x32.png', size: 32 },
  // Extension icons
  { path: 'extension-icons/icon16.png', size: 16 },
  { path: 'extension-icons/icon32.png', size: 32 },
  { path: 'extension-icons/icon48.png', size: 48 },
  { path: 'extension-icons/icon128.png', size: 128 },
];

for (const { path: relPath, size } of targets) {
  const outPath = join(ASSETS, relPath);
  mkdirSync(dirname(outPath), { recursive: true });

  const resvg = new Resvg(SVG, {
    fitTo: { mode: 'width', value: size },
    background: 'rgba(0,0,0,0)',
  });

  const rendered = resvg.render();
  const png = rendered.asPng();
  writeFileSync(outPath, png);
  console.log(`✓ ${relPath} → ${size}×${size} (${png.length} bytes)`);
}

console.log(`\nDone — ${targets.length} icons generated from favicon.svg`);
