# OpenDevBrowser Asset Inventory

Status: active  
Last updated: 2026-04-12

This inventory reflects the current `assets/` tree used by README, extension packaging, and private website branding flows, plus the generated first-contact discovery assets mirrored into release and website sync flows.

## Source and usage

- Source directory: `assets/`
- Private website sync target: `opendevbrowser-website-deploy/frontend/public/brand/` via `npm run sync:assets --prefix frontend` (private repo)
- Extension sync target: `extension/icons/` via `npm run extension:build` (`scripts/copy-extension-assets.mjs`)
- Design reference: `assets/DESIGN_SPEC.md`

## Generated first-contact discovery assets

These files live outside `assets/`, but they are treated as release-facing inventory because help, onboarding, and website sync flows mirror them directly.

| File | Role | Notes |
|---|---|---|
| `src/cli/help.ts` | Generated help renderer | First-contact CLI/help inventory surface, including the `Find It Fast` lookup block for `screencast / browser replay`, `desktop observation`, and `computer use / browser-scoped computer use` |
| `src/cli/onboarding-metadata.json` | Onboarding metadata | Shared by help, prompting guide, skill nudges, and proof lanes |
| `src/public-surface/generated-manifest.ts` | Checked-in TypeScript public-surface snapshot | Consumed by runtime help, docs parity, and tests |
| `src/public-surface/generated-manifest.json` | Checked-in JSON public-surface snapshot | Consumed by scripts and private website sync inputs |

## Canonical icon and brand assets

| File | Dimensions | Notes |
|---|---:|---|
| `assets/favicon.svg` | vector | canonical scalable favicon source |
| `assets/favicon.ico` | ico | browser shortcut icon |
| `assets/favicon-16x16.png` | 16x16 | raster favicon |
| `assets/favicon-32x32.png` | 32x32 | raster favicon |
| `assets/icon-16.png` | 16x16 | app icon set |
| `assets/icon-32.png` | 32x32 | app icon set |
| `assets/icon-48.png` | 48x48 | app icon set |
| `assets/icon-128.png` | 128x128 | app icon set |
| `assets/icon-256.png` | 256x256 | app icon set |
| `assets/icon-512.png` | 512x512 | app icon set |
| `assets/icon-1024.png` | 1024x1024 | app icon set |
| `assets/logo-primary.png` | 512x136 | primary wordmark |
| `assets/logo-light.png` | 512x136 | light variant |
| `assets/logo-dark.png` | 512x136 | dark variant |
| `assets/social-og.png` | 1200x630 | Open Graph/Twitter large card |
| `assets/github-social.png` | 1280x640 | GitHub social preview |
| `assets/hero-image.png` | 1920x1080 | hero visual |

## Extension icon pack

| File | Dimensions |
|---|---:|
| `assets/extension-icons/icon16.png` | 16x16 |
| `assets/extension-icons/icon32.png` | 32x32 |
| `assets/extension-icons/icon48.png` | 48x48 |
| `assets/extension-icons/icon128.png` | 128x128 |

## README image candidates

Directory: `assets/readme-image-candidates/2026-02-08/`

| File | Dimensions |
|---|---:|
| `01-cinematic-workflow-hero.jpg` | 2752x1536 |
| `02-relay-architecture-isometric.jpg` | 2752x1536 |
| `03-snapshot-refs-actions-abstract.jpg` | 2752x1536 |
| `04-annotation-automation-scene.jpg` | 2752x1536 |
| `05-futuristic-control-surface.jpg` | 2752x1536 |

## Validation commands

```bash
find assets -type f | sort
file assets/icon-16.png assets/icon-32.png assets/icon-128.png \
  assets/logo-primary.png assets/social-og.png assets/hero-image.png \
  assets/extension-icons/icon16.png assets/extension-icons/icon128.png

shasum assets/extension-icons/icon16.png assets/extension-icons/icon32.png \
  assets/extension-icons/icon48.png assets/extension-icons/icon128.png \
  extension/icons/icon16.png extension/icons/icon32.png \
  extension/icons/icon48.png extension/icons/icon128.png

node scripts/chrome-store-compliance-check.mjs
ls src/cli/onboarding-metadata.json src/public-surface/generated-manifest.ts src/public-surface/generated-manifest.json
node scripts/docs-drift-check.mjs
```
