#!/usr/bin/env node
/**
 * Generates charcoal black (#2D2D2D) icon PNGs with 3D premium styling.
 * Creates a browser window glyph with gradients and depth using pure Node.js PNG generation.
 */

import { writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { deflateSync } from 'zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

// 3D Premium color palette
const COLORS = {
  // Main body gradient (top to bottom)
  bodyTop: { r: 55, g: 55, b: 55 },      // #373737 - lighter top
  bodyBottom: { r: 35, g: 35, b: 35 },   // #232323 - darker bottom
  // Header gradient (slightly lighter)
  headerTop: { r: 65, g: 65, b: 65 },    // #414141
  headerBottom: { r: 45, g: 45, b: 45 }, // #2D2D2D
  // Highlight edge (top/left light source)
  highlight: { r: 85, g: 85, b: 85 },    // #555555
  // Shadow edge (bottom/right)
  shadow: { r: 25, g: 25, b: 25 },       // #191919
};

// CRC32 implementation for PNG
const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function createPNG(size, drawFunc) {
  // PNG signature
  const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  
  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0); // width
  ihdrData.writeUInt32BE(size, 4); // height
  ihdrData[8] = 8;  // bit depth
  ihdrData[9] = 6;  // color type (RGBA)
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  
  const ihdrType = Buffer.from('IHDR');
  const ihdrCrc = crc32(Buffer.concat([ihdrType, ihdrData]));
  const ihdr = Buffer.alloc(12 + 13);
  ihdr.writeUInt32BE(13, 0);
  ihdrType.copy(ihdr, 4);
  ihdrData.copy(ihdr, 8);
  ihdr.writeUInt32BE(ihdrCrc, 21);
  
  // Generate pixel data
  const pixels = drawFunc(size);
  const rawData = Buffer.alloc(size * (1 + size * 4));
  
  for (let y = 0; y < size; y++) {
    rawData[y * (1 + size * 4)] = 0; // filter byte
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const outIdx = y * (1 + size * 4) + 1 + x * 4;
      rawData[outIdx] = pixels[idx];
      rawData[outIdx + 1] = pixels[idx + 1];
      rawData[outIdx + 2] = pixels[idx + 2];
      rawData[outIdx + 3] = pixels[idx + 3];
    }
  }
  
  // Compress
  const compressed = deflateSync(rawData);
  
  // IDAT chunk
  const idatType = Buffer.from('IDAT');
  const idatCrc = crc32(Buffer.concat([idatType, compressed]));
  const idat = Buffer.alloc(12 + compressed.length);
  idat.writeUInt32BE(compressed.length, 0);
  idatType.copy(idat, 4);
  compressed.copy(idat, 8);
  idat.writeUInt32BE(idatCrc, 8 + compressed.length);
  
  // IEND chunk
  const iend = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82]);
  
  return Buffer.concat([signature, ihdr, idat, iend]);
}

// Check if point (x,y) is inside a rounded rectangle
function isRoundedRect(x, y, left, top, width, height, radius) {
  if (x >= left && x < left + width && y >= top && y < top + height) {
    // Check corners
    // Top-left
    if (x < left + radius && y < top + radius) {
      const dx = x - (left + radius);
      const dy = y - (top + radius);
      if (dx * dx + dy * dy > radius * radius) return false;
    }
    // Top-right
    if (x >= left + width - radius && y < top + radius) {
      const dx = x - (left + width - radius - 1);
      const dy = y - (top + radius);
      if (dx * dx + dy * dy > radius * radius) return false;
    }
    // Bottom-left
    if (x < left + radius && y >= top + height - radius) {
      const dx = x - (left + radius);
      const dy = y - (top + height - radius - 1);
      if (dx * dx + dy * dy > radius * radius) return false;
    }
    // Bottom-right
    if (x >= left + width - radius && y >= top + height - radius) {
      const dx = x - (left + width - radius - 1);
      const dy = y - (top + height - radius - 1);
      if (dx * dx + dy * dy > radius * radius) return false;
    }
    return true;
  }
  return false;
}

// Linear interpolation between two colors based on position (0-1)
function lerpColor(color1, color2, t) {
  return {
    r: Math.round(color1.r + (color2.r - color1.r) * t),
    g: Math.round(color1.g + (color2.g - color1.g) * t),
    b: Math.round(color1.b + (color2.b - color1.b) * t),
  };
}

// Draw a "Browser Window" icon with 3D premium look
// Gradient fills, highlight edges, and subtle depth
function drawTabIcon(size) {
  const pixels = new Uint8Array(size * size * 4);
  const padding = Math.max(1, Math.floor(size * 0.125));
  
  // Outer shape
  const outerLeft = padding;
  const outerTop = padding;
  const outerWidth = size - padding * 2;
  const outerHeight = size - padding * 2;
  const outerRadius = Math.max(1, Math.floor(size * 0.15));
  
  // Header height (about 25% of height)
  const headerHeight = Math.floor(outerHeight * 0.25);
  
  // Inner cutout (for the body part)
  const borderThickness = Math.max(1, Math.floor(size * 0.08));
  const innerLeft = outerLeft + borderThickness;
  const innerTop = outerTop + headerHeight;
  const innerWidth = outerWidth - borderThickness * 2;
  const innerHeight = outerHeight - headerHeight - borderThickness;
  const innerRadius = Math.max(0, outerRadius - borderThickness);
  
  // Edge highlight thickness (for 3D effect)
  const edgeThickness = Math.max(1, Math.floor(size * 0.02));
  
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      
      let pixelOn = false;
      let color = { r: 0, g: 0, b: 0 };
      
      // Must be inside outer shape
      if (isRoundedRect(x, y, outerLeft, outerTop, outerWidth, outerHeight, outerRadius)) {
        const isHeader = y < (outerTop + headerHeight);
        const isInsideInner = isRoundedRect(x, y, innerLeft, innerTop, innerWidth, innerHeight, innerRadius);
        
        if (isHeader || !isInsideInner) {
          pixelOn = true;
          
          // Calculate vertical gradient position (0 = top, 1 = bottom)
          const gradientT = (y - outerTop) / outerHeight;
          
          // Calculate distance from edges for highlight/shadow
          const distFromLeft = x - outerLeft;
          const distFromTop = y - outerTop;
          const distFromRight = (outerLeft + outerWidth) - x;
          const distFromBottom = (outerTop + outerHeight) - y;
          
          if (isHeader) {
            // Header area - use header gradient
            const headerT = (y - outerTop) / headerHeight;
            color = lerpColor(COLORS.headerTop, COLORS.headerBottom, headerT);
            
            // Top edge highlight on header
            if (distFromTop <= edgeThickness) {
              const highlightT = distFromTop / edgeThickness;
              color = lerpColor(COLORS.highlight, color, highlightT);
            }
          } else {
            // Body border area - use body gradient
            color = lerpColor(COLORS.bodyTop, COLORS.bodyBottom, gradientT);
          }
          
          // Left edge highlight (light source from top-left)
          if (distFromLeft <= edgeThickness && distFromLeft < distFromRight) {
            const highlightT = distFromLeft / edgeThickness;
            color = lerpColor(COLORS.highlight, color, highlightT * 0.7);
          }
          
          // Right edge shadow
          if (distFromRight <= edgeThickness && distFromRight < distFromLeft) {
            const shadowT = distFromRight / edgeThickness;
            color = lerpColor(COLORS.shadow, color, shadowT * 0.7);
          }
          
          // Bottom edge shadow
          if (distFromBottom <= edgeThickness) {
            const shadowT = distFromBottom / edgeThickness;
            color = lerpColor(COLORS.shadow, color, shadowT * 0.7);
          }
        }
      }
      
      if (pixelOn) {
        pixels[idx] = color.r;
        pixels[idx + 1] = color.g;
        pixels[idx + 2] = color.b;
        pixels[idx + 3] = 255;
      } else {
        pixels[idx] = 0;
        pixels[idx + 1] = 0;
        pixels[idx + 2] = 0;
        pixels[idx + 3] = 0;
      }
    }
  }
  
  return pixels;
}

// Generate icons
const sizes = [16, 32, 48, 128, 512];
const iconDir = join(rootDir, 'extension', 'icons');
const assetsDir = join(rootDir, 'docs', 'assets');

for (const size of sizes) {
  const png = createPNG(size, drawTabIcon);
  if (size === 512) {
    writeFileSync(join(assetsDir, `icon${size}.png`), png);
    console.log(`Created docs/assets/icon${size}.png`);
  } else {
    writeFileSync(join(iconDir, `icon${size}.png`), png);
    console.log(`Created extension/icons/icon${size}.png`);
  }
}

console.log('Done!');
