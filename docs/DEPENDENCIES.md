# OpenDevBrowser Dependency Inventory

Status: active  
Last updated: 2026-05-19

This document tracks runtime and build dependencies across the repository.

## Source metadata audit (2026-05-19)

Verified source files:
- `package.json` version: `0.0.32`
- `package-lock.json` top-level version and `packages[""]` version: `0.0.32`
- `extension/manifest.json` version: `0.0.32`
- `extension/package.json` version: `0.0.32`
- `eslint.config.js`: flat config for `src/**/*.ts` and `tests/**/*.ts`, using `@typescript-eslint/parser`, `ecmaVersion: "latest"`, module source type, and no custom rules
- public repo config files found for this audit: `eslint.config.js`, `tsconfig.json`, `vitest.config.ts`, and `extension/tsconfig.json`
- no public Vite config and no public `frontend/` application directory are present in this repo

`npm run version:check` is the source-backed version parity gate for root package, lockfile, extension manifest, and extension package metadata.

## Root package (`/package.json`)

### Runtime and packaged dependencies

| Package | Version | Purpose |
|---|---|---|
| `@opencode-ai/plugin` | `^1.2.25` | OpenCode plugin runtime integration |
| `@puppeteer/browsers` | `^2.13.0` | Chrome for Testing resolution/download |
| `async-mutex` | `^0.5.0` | Session/relay concurrency controls |
| `jsonc-parser` | `^3.2.0` | JSONC config parsing |
| `parse5` | `^8.0.0` | HTML parsing for export and DOM normalization paths |
| `playwright-core` | `^1.58.2` | Browser control + CDP sessions |
| `typescript` | `^5.9.3` | Runtime TSX parsing/printing for canvas code sync plus repository TypeScript builds |
| `ws` | `^8.19.0` | Relay and daemon websocket transport |
| `yjs` | `^13.6.29` | CRDT-backed canvas document state and convergence |
| `zod` | `^3.25.76` | Runtime input/config validation |

### Dev dependencies

| Package | Version | Purpose |
|---|---|---|
| `tsup` | `^8.5.1` | ESM bundling |
| `eslint` + `@typescript-eslint/*` | `^9.39.3`, `^8.56.1` | Linting |
| `vitest` + `@vitest/coverage-v8` | `^4.0.18` | Test runner + coverage |
| `happy-dom` | `^20.7.0` | DOM test environment |
| `@types/node` | `^20.19.35` | Node.js type definitions |
| `@types/chrome` | `^0.1.37` | Chrome extension API types |
| `@types/ws` | `^8.18.1` | WebSocket type definitions |

## Private website package (separate repository)

The website dependency graph is maintained in the private repository:
- repo: `opendevbrowser-website-deploy`
- manifest: `frontend/package.json`
- lockfile: `frontend/package-lock.json`

This public repository no longer tracks website package manifests or lockfiles. Any public docs that mention `frontend/` commands are private-repo validation steps, not public-repo manifests.

## Extension package (`/extension`)

The extension is built with the root toolchain (`npm run extension:build`) and does not maintain an independent runtime dependency graph. The extension package is private and only declares `type: "module"` plus a local `build` script.
Version synchronization is handled by `npm run extension:sync`, which keeps `extension/manifest.json` and `extension/package.json` aligned with the root package version. `npm run extension:pack` zips the built manifest, popup, canvas page, `dist/`, and icons into `opendevbrowser-extension.zip`.

## Challenge override rollout audit

- No new package dependencies were required for `challengeAutomationMode`.
- No package.json, tsconfig.json, eslint.config.js, or vitest.config.ts changes were required for this rollout.
- No Vite config exists in the public repo, so no Vite update was required.

## Documentation sweep config audit (2026-05-19)

- Reviewed `package.json`, `package-lock.json`, `eslint.config.js`, `tsconfig.json`, `vitest.config.ts`, `extension/manifest.json`, and `extension/package.json` as part of this release documentation lane.
- No dependency version, lockfile, or toolchain config changes were required after the source-backed audit.
- The live root config filenames in this repo are `eslint.config.js`, `tsconfig.json`, and `vitest.config.ts`; extension TypeScript config lives at `extension/tsconfig.json`. There is no `eslintconfig.js`, `tsconfig.js`, public Vite config, or public `frontend/` app directory in the public repo.

## Dependency update workflow

1. Update package manifests.
2. Re-run lockfile updates:
   - public repo: `npm install`
   - private website repo: `npm install --prefix frontend`
3. Run validation gates:
   - Root: `npm run version:check`, `npm run lint`, `npm run typecheck`, `npm run build`, `npm run extension:build`, `npm run test`
   - Private website repo: `npm run lint --prefix frontend && npm run typecheck --prefix frontend && npm run build --prefix frontend`
4. Update this document when dependency purpose or versions change.

Related operational references:
- Install/onboarding: `<public-repo-root>/docs/FIRST_RUN_ONBOARDING.md`
- Runtime/flags/help: `<public-repo-root>/docs/CLI.md`
- Config schema behavior: `<public-repo-root>/src/config.ts`
