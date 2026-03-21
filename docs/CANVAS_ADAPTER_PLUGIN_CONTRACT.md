# Canvas Adapter Plugin Contract

Status: active  
Last updated: 2026-03-19

Repo-local canvas adapter plugins extend the `canvas.code.*` surface without core edits. They are local-only and participate in the same framework-adapter, library-adapter, preview, inventory, and validator contracts as built-in lanes.

## Discovery and precedence

OpenDevBrowser discovers adapter plugins from these sources, in this order:

1. `package.json#opendevbrowser.canvas.adapterPlugins`
2. `.opendevbrowser/canvas/adapters.json`
3. `~/.config/opencode/opendevbrowser.jsonc` at `canvas.adapterPlugins`

Higher-precedence declarations override lower ones by `ref`. `enabled: false` disables the same plugin declaration from lower-precedence sources.

Declaration shape:

- string: `"./plugins/acme"`
- object:

```json
{
  "ref": "./plugins/acme",
  "enabled": true,
  "trustedWorkspaceRoots": ["./design-system"],
  "capabilityOverrides": ["preview", "code_pull"]
}
```

Relative `ref` values resolve from the repo root for `package.json` and `.opendevbrowser/canvas/adapters.json`, and from the config file directory for `opendevbrowser.jsonc`.

`trustedWorkspaceRoots` is cooperative SDK metadata that is merged into the loaded manifest and exposed to the plugin; it is not a containment sandbox. `capabilityOverrides` is an allowlist that narrows manifest-declared and registered adapter capabilities.

## Packaging requirements

Every plugin package must ship:

- `canvas-adapter.plugin.json`
- a compiled ESM entrypoint referenced by `entry`
- a named export `createCanvasAdapterPlugin`
- a `fixtureDir` for validator-backed coverage
- runtime imports through the stable SDK path declared in `sdkImport`

Remote specifiers are rejected. `http:`, `https:`, `npm:`, `git+`, and `github:` plugin refs are not allowed.

## Manifest contract

Required manifest fields:

- `schemaVersion`
- `adapterApiVersion`
- `pluginId`
- `displayName`
- `version`
- `engine.opendevbrowser`
- `entry`
- `moduleFormat` = `esm`
- `frameworkAdapters`
- `libraryAdapters`
- `capabilities`
- `fixtureDir`
- `trustedWorkspaceRoots`
- `packageRoot`
- `sdkImport`

Framework descriptors declare:

- `id`
- `sourceFamily`
- `adapterKind`
- `adapterVersion`
- `moduleExport`
- `capabilities`
- optional `fileMatchers`

Library descriptors declare:

- `id`
- `frameworkId`
- `kind`
- `resolutionStrategy`
- `moduleExport`
- `capabilities`
- optional `packages`

Built-in adapter IDs use the `builtin:` namespace. Plugin-provided adapter IDs must be unique within the loaded plugin set. Duplicate `pluginId` or adapter IDs are fatal load errors.

## Trust model

Plugin packages may load only from:

- the worktree root
- the worktree `node_modules`
- explicit config-declared absolute paths

The loader canonicalizes package roots with `realpath` and rejects package declarations that escape those roots. `trustedWorkspaceRoots` does not widen package-root trust; it is metadata for cooperative plugin behavior. Capability gating limits what core invokes, but it does not sandbox in-process plugin code.

## Runtime hooks

`createCanvasAdapterPlugin` must return a definition with:

- `manifest`
- `initialize(runtimeContext)`
- `validateWorkspace(workspaceContext)`
- `registerFrameworkAdapters(registry)`
- `registerLibraryAdapters(registry)`
- `onBind(bindingContext)`
- `onUnbind(bindingContext)`
- `dispose(disposeContext)`

Lifecycle failures are typed:

- `initialize` or `validateWorkspace` failure blocks registration
- `onBind` failure leaves the binding detached or unsupported
- `onUnbind` and `dispose` failures are warnings, not session-fatal crashes

## Capabilities and status

Supported capability names:

- `preview`
- `inventory_extract`
- `code_pull`
- `code_push`
- `token_roundtrip`
- `figma_materialize`

`canvas.code.status` surfaces:

- `frameworkAdapterId`
- `frameworkId`
- `sourceFamily`
- `declaredCapabilities`
- `grantedCapabilities`
- `capabilityDenials`
- deterministic `reasonCode` values such as `framework_migrated`, `manifest_migrated`, `plugin_not_found`, and `plugin_load_failed`

## Validation

Use the canonical validator:

```bash
node scripts/canvas-competitive-validation.mjs --out artifacts/canvas-competitive-validation-report.json
```

The validator:

- runs shared adapter conformance checks
- executes plugin packaging and negative-case coverage
- records configured BYO plugin fixture status as `pass`, `fail`, or `skipped`
- records optional live Figma smoke as `pass` or `skipped_no_figma_token`
- writes per-group logs under `artifacts/canvas-competitive-validation-logs/`

If no configured plugin declarations are present, the configured-plugin-fixtures group is recorded as `skipped`, not silently omitted.

This repo now ships a checked-in repo declaration at `.opendevbrowser/canvas/adapters.json` pointing to `./tests/fixtures/canvas/adapter-plugins/validation-fixture`, so a normal repo checkout exercises the configured-plugin-fixtures group without requiring user-local config.
