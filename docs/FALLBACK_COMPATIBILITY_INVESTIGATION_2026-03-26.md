# Investigation: Fallback and Compatibility Seams

## Summary

OpenDevBrowser does have too many old-path branches, but they are not all the same kind of problem.

The highest-yield debt is not provider fallback policy. The highest-yield debt is legacy compatibility leaking past the edge and into shared execution code. The clearest offenders are relay `/cdp` routing, `BrowserManager`'s `extensionLegacy` behavior, synthetic CDP bootstrap/session emulation, and continued write-side emission of the legacy canvas adapter id `tsx-react-v1`.

## Symptoms

- Relay and connection routing still duplicate `/ops` versus `/cdp` decisions in multiple callers.
- `BrowserManager` still carries legacy extension-session recovery, timeout, telemetry, and title-probe behavior in its core execution path.
- The extension CDP router still emulates synthetic root/browser sessions for `pw-tab-*` legacy clients.
- Canvas code-sync already canonicalizes `tsx-react-v1` to `builtin:react-tsx-v2`, but new write paths and tests still preserve the old id.
- Provider fallback logic is complex, but the control surface is already relatively centralized.
- Skill loading contains explicit multi-home compatibility search paths and alias support, but that is a separate product-compatibility concern rather than the main architectural debt.

## Investigation Log

### Relay Edge Routing
**Hypothesis:** `/cdp` compatibility is still active and duplicated across too many entry points.

**Findings:** Confirmed. The relay server exposes both `/cdp` and `/ops`, and routing logic is reimplemented across CLI, tool, and remote-manager layers.

**Evidence:**
- `src/relay/relay-server.ts:354` handles `/cdp`; `src/relay/relay-server.ts:420` handles `/ops`.
- `src/relay/relay-server.ts:598` exposes `getCdpUrl()`; `src/relay/relay-server.ts:649` exposes `getOpsUrl()`.
- `src/cli/daemon-commands.ts:744-817` branches launch routing on `extensionLegacy`.
- `src/cli/daemon-commands.ts:840-880` duplicates relay endpoint normalization and explicit `/cdp` gating.
- `src/tools/connect.ts:8-23` duplicates relay endpoint normalization; `src/tools/connect.ts:47-55` branches on `/cdp` versus `/ops`.
- `src/tools/launch.ts:43-66` and `src/tools/launch.ts:127` duplicate relay selection and `/cdp` labeling.
- `src/cli/remote-manager.ts:21-50` auto-detects `/cdp` and silently injects `extensionLegacy: true`.

**Conclusion:** Confirmed architectural debt. `/cdp` is still an active compatibility surface, but the real problem is that edge routing and legacy detection are duplicated instead of quarantined.

### BrowserManager Legacy Leakage
**Hypothesis:** old relay compatibility has leaked into the main browser execution core.

**Findings:** Confirmed. `ManagedSession` still carries `extensionLegacy`, and shared browser operations branch on it for recovery, timeout wrappers, telemetry, and page metadata.

**Evidence:**
- `src/browser/browser-manager.ts:89` stores `extensionLegacy` on `ManagedSession`.
- `src/browser/browser-manager.ts:727`, `src/browser/browser-manager.ts:3383-3425` recover closed or detached legacy pages through `recoverLegacyExtensionPage()` and `reconnectLegacyExtensionSession()`.
- `src/browser/browser-manager.ts:1656-1718` wraps perf and screenshot operations with `withLegacyExtensionOperationTimeout()`.
- `src/browser/browser-manager.ts:2976` emits separate mode variants for `extensionLegacyCdpHeaded` and `extensionOpsHeaded`.
- `src/browser/browser-manager.ts:3332-3370` skips page-title probing for legacy sessions.
- `tests/browser-manager.test.ts:784-949` locks `/cdp` connect, retry, and reconnect behavior.
- `tests/browser-manager.test.ts:1913-2048` locks legacy page reuse and reconnect-on-close behavior.
- `tests/browser-manager.test.ts:4407-4521` locks legacy screenshot/perf fallback behavior.

**Conclusion:** Confirmed architectural debt and the biggest inward leak. This code should not be deleted immediately, but it should be extracted behind a dedicated compatibility boundary.

### Synthetic CDP Root and Session Compatibility
**Hypothesis:** the extension router still emulates old CDP expectations for legacy clients.

**Findings:** Confirmed. The router synthesizes root/browser behavior for `pw-tab-*` session ids and intercepts bootstrap methods locally.

**Evidence:**
- `extension/src/services/cdp-router-commands.ts:280-282` routes through `resolveSyntheticCompatSession()` and `buildSyntheticRootCompatResult()`.
- `extension/src/services/cdp-router-commands.ts:321-373` defines `SYNTHETIC_ROOT_NOOP_METHODS` and synthetic root handling.
- `extension/src/services/cdp-router-commands.ts:427` recognizes synthetic `pw-tab-*` session ids.
- `tests/extension-cdp-router.test.ts:293-366` requires synthetic bootstrap commands to stay local.
- `tests/extension-cdp-router.test.ts:368-462` requires session-scoped auto-attach to keep working through the synthetic session layer.

**Conclusion:** Active compatibility contract. The debt is not that this exists, but that it lives inline inside the router instead of behind one isolated legacy module.

### Provider Fallback Policy
**Hypothesis:** provider fallback logic is the main old-system debt.

**Findings:** Rejected as a first-wave target. The provider path is complex, but the control flow is already relatively centralized and appears to express current product policy rather than dead compatibility.

**Evidence:**
- `src/providers/browser-fallback.ts:17-21` defines default fallback modes in one place.
- `src/providers/browser-fallback.ts:211-260` centralizes `resolveProviderBrowserFallback()`.
- `src/providers/index.ts:539-575` escalates only specific runtime failures into browser fallback.
- `src/providers/workflows.ts:494-518` applies workflow-level browser mode overrides in one seam.
- `src/providers/workflows.ts:2046-2177` passes the override into shopping runtime calls and reports observed fallback modes.
- `src/providers/runtime-factory.ts:625-809` runs the current browser/cookie/challenge fallback loop, including explicit extension reuse and challenge preservation.
- `tests/providers-browser-fallback.test.ts:1-260` locks fallback normalization semantics.
- `tests/providers-runtime-factory.test.ts:1-260` and later `challenge_preserved` expectations show this is still current product behavior, not abandoned legacy wiring.

**Conclusion:** Active policy seam, not the best first removal target. Future cleanup here should simplify policy ownership, not delete fallback behavior blindly.

### Canvas Code-Sync Migration
**Hypothesis:** canvas still preserves a half-removed legacy adapter contract.

**Findings:** Confirmed. Internal normalization already points to `builtin:react-tsx-v2`, but new writes and tests still preserve `tsx-react-v1`.

**Evidence:**
- `src/canvas/code-sync/types.ts:1-10` still declares `LEGACY_CODE_SYNC_ADAPTERS = ["tsx-react-v1"]`.
- `src/canvas/code-sync/types.ts:360-368` maps `tsx-react-v1` to `builtin:react-tsx-v2` through `LEGACY_ADAPTER_MAP`.
- `src/canvas/code-sync/types.ts:546-571` applies migration inside `normalizeFrameworkAdapterIdentity()`.
- `src/canvas/code-sync/manifest.ts:90-135` and `src/canvas/code-sync/manifest.ts:153-199` still emit `manifest_migrated` behavior.
- `tests/canvas-code-sync-primitives.test.ts:225-283` expects legacy adapter normalization with `framework_migrated`.
- `tests/canvas-code-sync-primitives.test.ts:397-421` expects `manifest_migrated` for legacy manifests.
- `tests/canvas-manager.test.ts:779-808` preserves `tsx-react-v1` in import provenance.
- `tests/canvas-manager.test.ts:7126-7262` preserves `tsx-react-v1` in starter results and framework metadata.

**Conclusion:** Real migration debt. Read compatibility should stay for now, but new write-side emission should eventually move to the canonical adapter id.

### Skill Loader Compatibility
**Hypothesis:** skill loading also preserves old compatibility behavior, but it may be a lower-priority product concern.

**Findings:** Confirmed. The loader intentionally supports `.codex`, `.claude`, `.amp`, bundled fallback, and compatibility alias directories.

**Evidence:**
- `src/skills/skill-loader.ts:21-31` resolves Codex, ClaudeCode/Claude, and Amp homes.
- `src/skills/skill-loader.ts:83-95` searches project, global, compatibility, custom, and bundled skill paths.
- `tests/skill-loader.test.ts:391-425` requires Codex and Amp compatibility directories.
- `tests/skill-loader.test.ts:478-500` requires `CLAUDE_HOME` fallback.
- `tests/skill-loader.test.ts:559-581` requires `~/.codex/skills` fallback.
- `tests/skill-loader.test.ts:633-657` requires `~/.amp/skills` fallback.
- `skills/AGENTS.md:3-18` and `skills/AGENTS.md:35-48` document the same compatibility model and alias directories.

**Conclusion:** Intentional product/distribution compatibility, not first-wave architectural debt. Any removal here needs an explicit product decision.

## Eliminated Hypotheses

- `src/providers/browser-fallback.ts` is not the best first simplification seam. It is already the cleanest centralized abstraction in the provider stack.
- The data-URL HTML fallback in `src/browser/browser-manager.ts:3511-3569` is not old relay debt. It protects current preview/render behavior.
- Ops synthetic URL/title reporting is not just stale compatibility residue. It supports current preview and canvas reporting semantics.
- Skill-loader compatibility is real, but it is not the source of the transport/runtime complexity the user is feeling.

## Root Cause

The repo's real problem is not the existence of fallbacks. The problem is that legacy compatibility is not quarantined at the edges.

There are two broad classes:

1. **Current-policy fallbacks**
   - Provider browser fallback
   - challenge preservation
   - cookie policy
   - HTML preview fallback

2. **Old-system compatibility**
   - `/cdp` relay routing
   - `extensionLegacy` session behavior inside `BrowserManager`
   - synthetic root/session CDP emulation
   - `tsx-react-v1` write-side metadata

Current-policy fallbacks mostly live in explicit seams already. Old-system compatibility still leaks across several owners, which makes the codebase feel more conditional than it needs to be and makes each new function inherit historical transport rules.

## Recommendations

1. **Wave 1: centralize relay routing and legacy endpoint classification**
   - Create one shared helper for local relay endpoint normalization, `/cdp` detection, and explicit legacy gating.
   - Primary targets: `src/cli/daemon-commands.ts`, `src/tools/connect.ts`, `src/tools/launch.ts`, `src/cli/remote-manager.ts`.
   - Preferred home: `src/relay/relay-endpoints.ts` or a nearby relay helper module.
   - Expected result: `/ops` becomes the canonical route-selection path in one place, while `/cdp` remains supported as a quarantined legacy edge.

2. **Wave 2: extract BrowserManager legacy behavior into a dedicated compat module**
   - Move `extensionLegacy` recovery, timeout wrappers, title-probe skips, and reconnect logic behind one strategy/helper layer.
   - Primary targets: `src/browser/browser-manager.ts` and `tests/browser-manager.test.ts`.
   - Expected result: core browser execution paths stop carrying transport-specific legacy branches inline.

3. **Wave 3: isolate synthetic CDP bootstrap/session emulation**
   - Pull `resolveSyntheticCompatSession()`, `buildSyntheticRootCompatResult()`, and related `pw-tab-*` behavior out of the main router command flow.
   - Primary targets: `extension/src/services/cdp-router-commands.ts`, `extension/src/services/CDPRouter.ts`, `tests/extension-cdp-router.test.ts`.
   - Expected result: real routing and legacy emulation become separate concerns, making later `/cdp` retirement tractable.

4. **Wave 4: keep canvas read compatibility, stop new legacy writes**
   - Continue accepting and migrating `tsx-react-v1` on input and manifest load.
   - Stop emitting `tsx-react-v1` for newly created canonical metadata; preserve it only as provenance if needed.
   - Primary targets: `src/canvas/code-sync/types.ts`, `src/canvas/code-sync/manifest.ts`, `src/browser/canvas-manager.ts`, `tests/canvas-code-sync-primitives.test.ts`, `tests/canvas-manager.test.ts`.
   - Expected result: canonical write path becomes `builtin:react-tsx-v2` without breaking old persisted bindings.

5. **Do not start by deleting provider fallback behavior**
   - Leave `src/providers/browser-fallback.ts`, `src/providers/index.ts`, `src/providers/workflows.ts`, and most of `src/providers/runtime-factory.ts` intact in the first cleanup wave.
   - If provider cleanup is needed later, simplify policy ownership rather than removing fallback semantics.

6. **Keep skill-loader compatibility out of scope for the first cleanup wave**
   - Revisit only if product scope explicitly drops Codex, ClaudeCode/Claude, and Amp compatibility.
   - Any removal here should be treated as a distribution/product decision, not an internal architecture cleanup.

## Preventive Measures

- Keep compatibility at the boundary. New callers should depend on a single canonical helper instead of reimplementing legacy detection.
- Separate policy fallbacks from historical compatibility. Policy is allowed to stay centralized; historical transport or alias compatibility should live in a dedicated adapter layer.
- For migrations, use one rule consistently: read old contracts, write only the canonical new contract.
- Add tests that distinguish canonical behavior from legacy compatibility behavior, so future cleanup can shrink the legacy module without destabilizing the default path.
- When adding a new function, ask one explicit question first: is this current product policy, or are we teaching new code about an old transport?

## Recommended First Implementation Slice

If the next step is implementation, start here:

1. Add a shared relay route resolver.
2. Replace duplicated `/ops` versus `/cdp` logic in:
   - `src/cli/daemon-commands.ts`
   - `src/tools/connect.ts`
   - `src/tools/launch.ts`
   - `src/cli/remote-manager.ts`
3. Keep behavior and tests unchanged.
4. Only after that, extract `BrowserManager` legacy behavior.

That is the smallest safe simplification with the highest immediate return.
