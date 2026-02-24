# OpenDevBrowser Dependency Inventory

Status: active  
Last updated: 2026-02-24

This document tracks runtime and build dependencies across the repository.

## Root package (`/package.json`)

### Runtime dependencies

| Package | Version | Purpose |
|---|---|---|
| `@opencode-ai/plugin` | `^1.0.203` | OpenCode plugin runtime integration |
| `@puppeteer/browsers` | `^2.2.0` | Chrome for Testing resolution/download |
| `async-mutex` | `^0.5.0` | Session/relay concurrency controls |
| `jsonc-parser` | `^3.2.0` | JSONC config parsing |
| `playwright-core` | `^1.49.1` | Browser control + CDP sessions |
| `ws` | `^8.17.1` | Relay and daemon websocket transport |
| `zod` | `^3.23.8` | Runtime input/config validation |

### Dev dependencies

| Package | Version | Purpose |
|---|---|---|
| `typescript` | `^5.9.3` | TypeScript compiler |
| `tsup` | `^8.5.1` | ESM bundling |
| `eslint` + `@typescript-eslint/*` | `^9.12.0`, `^8.9.0` | Linting |
| `vitest` + `@vitest/coverage-v8` | `^4.0.16` | Test runner + coverage |
| `happy-dom` | `^20.0.11` | DOM test environment |
| `@types/*` | see `package.json` | Type definitions |

## Frontend package (`/frontend/package.json`)

### Runtime dependencies

| Package | Version | Purpose |
|---|---|---|
| `next` | `^15.0.0` | App framework and routing |
| `react` | `^19.0.0` | UI runtime |
| `react-dom` | `^19.0.0` | DOM renderer |
| `three` | `^0.170.0` | 3D rendering primitives |
| `@react-three/fiber` | `^9.5.0` | React renderer for Three.js |
| `@react-three/drei` | `^10.7.7` | R3F helpers/components |

### Dev dependencies

| Package | Version | Purpose |
|---|---|---|
| `typescript` | `^5.9.3` | Type checking |
| `eslint` + `eslint-config-next` | `^9.12.0`, `^15.0.0` | Frontend linting |
| `@types/node`, `@types/react`, `@types/react-dom` | see `frontend/package.json` | Type definitions |

## Extension package (`/extension`)

The extension is built with the root toolchain (`npm run extension:build`) and does not maintain an independent runtime dependency graph.
Version synchronization is handled by `npm run extension:sync`.

## Dependency update workflow

1. Update package manifests.
2. Re-run lockfile updates (`npm install` and/or `cd frontend && npm install`).
3. Run validation gates:
   - Root: `npm run lint`, `npx tsc --noEmit`, `npm run build`, `npm run extension:build`, `npm run test`
   - Frontend: `cd frontend && npm run lint && npm run typecheck && npm run build`
4. Update this document when dependency purpose or versions change.

Related operational references:
- Install/onboarding: `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/docs/FIRST_RUN_ONBOARDING.md`
- Runtime/flags/help: `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/docs/CLI.md`
- Config schema behavior: `/Users/bishopdotun/Documents/DevProjects/opendevbrowser/src/config.ts`
