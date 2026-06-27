# Google OAuth Session Continuity: Plan

## Goal

Make OpenDevBrowser reliable for explicit user-owned Google OAuth and first-party Google access without treating copied cookies as portable Google auth state.

Success means Google-sensitive runs use the live extension `/ops` Chrome profile or fail closed with actionable diagnostics, managed/CDP cookie bootstrap can be disabled per run, Google-sensitive cookie bootstrap is skipped by default unless explicitly allowed for diagnostics, auth provenance is visible without secrets, OAuth popup recovery uses existing target controls, and non-Google workflows keep current behavior.

## Scope And Non-goals

- Scope includes launch/workflow routing, system Chrome cookie bootstrap controls, provider cookie provenance, privacy-safe diagnostics, target/popup guidance, public docs, generated public surface, skills, and regression tests.
- Do not implement a broad auth framework, profile picker, broad popup watcher, stealth layer, CAPTCHA bypass, user-agent spoofing, or Google protection bypass.
- Do not run live personal Google OAuth validation without explicit user approval and privacy guardrails.
- Do not globally block managed mode, CDP, provider cookies, extension legacy, `/ops` popup behavior, or explicit cookie import for non-Google workflows.
- Do not expose cookie values, account identifiers, private URLs, full user-data paths, or private profile paths in user-facing diagnostics.

## Background

The investigation and audit are sufficient for a first implementation. No source evidence shows OpenDevBrowser intentionally logs users out of Google or clears Google cookies. The supported local root-cause model is session incoherence: managed and `cdpConnect` can transplant observable cookies from a heuristically selected Chrome-family profile into a different automation context, then provider or explicit cookie imports can add more state. Google may still reject that session because Google auth can depend on live profile state, account consistency state, local storage, extension state, protected session material, device binding where deployed, and popup target state.

Managed launch creates an isolated Playwright persistent context and runs system Chrome cookie bootstrap before OpenDevBrowser navigates to `startUrl`: `src/browser/browser-manager.ts:1639`, `src/browser/browser-manager.ts:1719`, `src/browser/browser-manager.ts:1721`. CDP connect reuses that same bootstrap path after `connectOverCDP()`: `src/browser/browser-manager.ts:6109`, `src/browser/browser-manager.ts:6229`. Extension mode skips bootstrap through the central guard in `bootstrapSystemChromeCookies()`: `src/browser/browser-manager.ts:3683`, `src/browser/browser-manager.ts:3687`.

System bootstrap imports cookies only. The loader copies or reads cookie-related Chrome files, not full browser profile state: `src/browser/system-chrome-cookies.ts:26`, `src/browser/system-chrome-cookies.ts:299`. Source profile discovery is heuristic across Chrome, Chromium, and Brave, preferring `last_used`, then `Default`, then the first eligible profile: `src/cache/chrome-user-data.ts:19`, `src/cache/chrome-user-data.ts:117`, `src/cache/chrome-user-data.ts:139`. Provider cookie import is a separate lane and is skipped for extension fallback: `src/providers/runtime-policy.ts:48`, `src/providers/runtime-factory.ts:1216`.

Base managed/CDP target handling requires explicit `targets-list` and `target-use` after new pages appear, while extension `/ops` already records opener metadata and popup targets: `src/browser/browser-manager.ts:2034`, `src/browser/browser-manager.ts:2157`, `extension/src/ops/ops-runtime.ts:554`, `extension/src/ops/ops-runtime.ts:727`, `extension/src/ops/ops-runtime.ts:3574`.

External constraints reinforce the same product direction. Google OAuth policy restricts developer-controlled embedded user agents; Chrome 136 restricts remote debugging against the default profile because of cookie-theft risk; Chrome App-Bound Encryption and Device Bound Session Credentials reduce copied-cookie portability where deployed; Google Workspace announced DBSC general availability for Chrome on Windows on May 28, 2026; Playwright treats saved auth state as sensitive test state, not as a general Google session copier.

## Approach

Use the smallest explicit control plane that makes user-owned Google auth safe by default when requested. The plan chooses an explicit Google-sensitive intent over URL inference, a default Google-sensitive cookie skip over copied Google auth state, and a per-run bootstrap-disable control over a profile picker. That keeps non-Google bootstrap behavior compatible while giving callers a way to state: this run requires the user's live Google profile, not copied cookies.

The first implementation should not try to prove Google login. It should route correctly, fail closed when the requested mode is unsafe, and explain exactly which state source was used. For Google-sensitive flows, extension `/ops` is the valid path. Managed/CDP remain valid for non-Google workflows and low-risk continuity, but their cookies must be labeled as copied cookies, not Google-auth proof.

Own the new auth intent in one tiny shared module, not separately in browser, provider, CLI, and tool code. The recommended seam is `src/core/auth-intent.ts`, exporting the `GoogleAuthIntent` type, constants, parser, serializer, and display label. Boundary surfaces may validate strings, but normalized values should flow through launch, connect, daemon, remote manager, and provider runtime policy from that shared module.

Keep auth provenance response-owned at first. `BrowserManager` should compute a minimal `AuthProvenanceDiagnostics` object for launch/connect responses and session lookup, and provider fallback should reference that object without creating a second diagnostic model. The first schema should be limited to intent, mode, live extension profile boolean, system bootstrap status, provider cookie import status, explicit cookie import attempted boolean, sanitized source label, counts, and warnings.

Popup handling should remain guided first. Existing `/ops` popup ownership and target switching are substantial and tested. The first fix should document and, where needed, improve diagnostics around `targets-list --include-urls` and `target-use`. Defer a broad popup watcher until diagnostics and a focused reproducer prove explicit target switching is insufficient.

## Work Items

## Task 1 - Add Explicit Google-Sensitive Intent

Reasoning: The runtime needs a narrow, testable signal that the caller requires user-owned Google OAuth or first-party Google account access. Inferring this from URLs would be brittle and could accidentally change unrelated workflows.

What to do: Add a closed intent that preserves non-Google behavior and only activates user-owned Google routing when explicitly requested.

How:
1. Create `src/core/auth-intent.ts` with `GoogleAuthIntent = "none" | "user_owned_google"`, allowed public CLI values, a parser, a serializer, and a display label helper.
2. Import that type from the shared module into `ProviderRuntimePolicyInput` and the browser launch/connect option types that carry per-run routing choices.
3. Make CLI and tool boundaries call the shared parser and forward the normalized value. Do not reimplement string parsing in browser, provider, daemon, or remote manager code.
4. Update `resolveProviderRuntimePolicy()` so `user_owned_google` resolves to extension-only fallback and force-transport behavior.
5. Keep provider cookie policy unchanged. Provider cookie import already stays skipped for extension fallback.
6. Do not infer the intent from hostnames, provider names, or OAuth URLs in this first implementation.

Files impacted:
- New file: `src/core/auth-intent.ts`
- `src/providers/types.ts`
- `src/providers/runtime-policy.ts`
- `src/browser/manager-types.ts`
- `src/browser/browser-manager.ts`
- `src/browser/ops-browser-manager.ts`
- `src/cli/remote-manager.ts` if it forwards launch/connect payloads
- Tests in `tests/`

Acceptance criteria:
- [ ] Omitted `googleAuthIntent` preserves non-Google provider and browser fallback behavior.
- [ ] Explicit `user_owned_google` produces extension-only fallback and force-transport behavior.
- [ ] CLI and tool inputs normalize through `src/core/auth-intent.ts`.
- [ ] Daemon and remote manager payloads carry normalized values without local re-parsing.
- [ ] No URL inference is added.
- [ ] Existing provider and browser fallback routing remains unchanged for `none`.

Dependencies: None.

## Task 2 - Enforce Extension `/ops` Fail-Closed Routing

Reasoning: User-owned Google OAuth must use live Chrome profile state. Managed/CDP cookie bootstrap can create partial or incoherent Google state and should not be an automatic fallback for this explicit intent.

What to do: Reject unsafe modes for `googleAuthIntent === "user_owned_google"` and reuse existing extension readiness diagnostics.

How:
1. Add a launch tool arg for `googleAuthIntent` in `src/tools/launch.ts`.
2. Add a CLI flag such as `--google-auth-intent user-owned` in `src/cli/commands/session/launch.ts`.
3. Forward the intent through daemon launch/connect payloads where launch/connect options are parsed.
4. When the intent is `user_owned_google`, reject `headless`, `noExtension`, and `extensionLegacy` before launching or connecting.
5. When the extension is unavailable or the handshake is incomplete, return the existing extension readiness failure category with Google-specific guidance in the message.
6. In the interactive CLI launch path, do not ask whether to proceed with managed or CDP when Google-sensitive intent is set.
7. In provider fallback, do not continue to managed after extension failure when this intent is set.

Files impacted:
- `src/tools/launch.ts`
- `src/tools/connect.ts`
- `src/cli/commands/session/launch.ts`
- `src/cli/commands/session/connect.ts`
- `src/cli/daemon-commands.ts`
- `src/providers/runtime-factory.ts`
- `src/providers/runtime-policy.ts`
- `src/public-surface/source.ts`
- `tests/tools.test.ts`
- `tests/cli-launch.test.ts`
- Provider runtime tests nearest to fallback policy coverage

Acceptance criteria:
- [ ] `opendevbrowser launch --google-auth-intent user-owned --no-extension` fails before calling managed launch.
- [ ] `opendevbrowser launch --google-auth-intent user-owned --headless` fails before attempting extension or managed launch.
- [ ] `opendevbrowser launch --google-auth-intent user-owned --extension-legacy` fails before relay connect.
- [ ] `opendevbrowser connect --google-auth-intent user-owned --cdp-port 9222` fails before explicit CDP connect.
- [ ] Extension unavailable returns actionable guidance to connect the extension and retry.
- [ ] Interactive CLI does not offer managed/CDP fallback for Google-sensitive intent.
- [ ] Non-Google launch and provider fallback behavior stays compatible.

Dependencies: Task 1.

## Task 3 - Add Per-run System Cookie Bootstrap Disable

Reasoning: Managed/CDP cookie transplant should be controllable without removing existing continuity workflows. This is the smallest safe mitigation before considering profile selection.

What to do: Add a per-run option that disables automatic system Chrome cookie bootstrap for managed and CDP sessions, skip Google-sensitive cookies by default in that bootstrap path, and expose an explicit diagnostic override to include them. CDP parity is required in the first implementation because CDP cookie overlay is part of the investigated failure path.

How:
1. Add `disableSystemCookieBootstrap?: boolean` to `LaunchOptions` and `ConnectOptions`.
2. Thread the option into the managed session setup or pass it directly to `bootstrapSystemChromeCookies()`.
3. Make `bootstrapSystemChromeCookies()` return before calling `loadSystemChromeCookies()` when disabled.
4. Return a clear warning for managed/CDP only: `System Chrome cookie bootstrap disabled for this run.`
5. Preserve the existing extension-mode skip without adding a redundant warning.
6. Add CLI flag `--disable-system-cookie-bootstrap` and launch/connect tool args with the same meaning.
7. Add CLI flag `--allow-google-cookie-bootstrap` and launch/connect tool args as a diagnostic override that explicitly includes Google-sensitive cookies.
8. Forward both options through daemon and remote manager code for both launch and connect.
9. Do not add a global config default or profile picker in this first task.

Files impacted:
- `src/browser/browser-manager.ts`
- `src/browser/manager-types.ts`
- `src/cli/commands/session/launch.ts`
- `src/cli/commands/session/connect.ts`
- `src/cli/daemon-commands.ts`
- `src/tools/launch.ts`
- `src/tools/connect.ts`
- `src/cli/remote-manager.ts`
- `tests/browser-manager.test.ts`
- `tests/cli-launch.test.ts`
- `tests/tools.test.ts`

Acceptance criteria:
- [ ] Managed launch with the disable option does not call `loadSystemChromeCookies()`.
- [ ] CDP connect with the disable option does not call `loadSystemChromeCookies()`.
- [ ] Managed/CDP launch without the disable option keeps non-Google bootstrap behavior.
- [ ] Managed/CDP bootstrap skips Google-sensitive cookies by default and reports sanitized counts.
- [ ] Managed/CDP bootstrap includes Google-sensitive cookies only when the explicit diagnostic override is set.
- [ ] Extension sessions remain unaffected.
- [ ] Existing managed and CDP bootstrap tests still pass.

Dependencies: None, but coordinate error messages with Task 2.

## Task 4 - Add Sanitized Auth Provenance Diagnostics

Reasoning: Users need to know whether a session used live extension profile state, system cookie bootstrap, provider cookie import, or explicit cookie import. Diagnostics must not leak secrets or private browsing context.

What to do: Add a small user-facing provenance object and keep it separate from raw cookies and raw profile paths.

How:
1. Define `AuthProvenanceDiagnostics` in `src/browser/manager-types.ts`.
2. Make `BrowserManager` the owner that computes the browser-level diagnostic for launch/connect and stores the current session value.
3. Keep the first schema minimal: `googleAuthIntent`, `mode`, `liveExtensionProfile`, `systemCookieBootstrap`, `providerCookieImport`, `explicitCookieImportAttempted`, `sanitizedSource`, `counts`, and `warnings`.
4. Sanitize `ChromeUserDataSource` before it reaches CLI/tool responses. Include browser family and a non-secret profile label only. Do not include full `userDataDir` or `profilePath`.
5. Mark explicit cookie import as attempted inside `cookieImport()` without storing cookie values.
6. Return diagnostics from launch/connect results under `diagnostics.authProvenance`.
7. Let provider fallback attach or reference the browser-owned `authProvenance` object instead of defining a separate provider diagnostic schema.
8. If active target context is shown for Google-sensitive errors, show hostname or target classification only. Do not print private URLs or page titles by default.
9. Add tests that fail if diagnostics include cookie values, full profile paths, or obvious account identifiers.

Files impacted:
- `src/browser/browser-manager.ts`
- `src/browser/manager-types.ts`
- `src/browser/session-store.ts` if session state belongs there
- `src/providers/runtime-factory.ts`
- `src/providers/types.ts`
- `src/tools/launch.ts`
- `src/cli/remote-manager.ts`
- `tests/browser-manager.test.ts`
- `tests/tools.test.ts`
- Provider fallback tests nearest to cookie diagnostics coverage

Acceptance criteria:
- [ ] Managed bootstrap diagnostics distinguish enabled, attempted, imported, rejected, and sanitized source.
- [ ] Disabled bootstrap diagnostics show disabled without calling the loader.
- [ ] Extension diagnostics report live extension profile usage.
- [ ] Provider fallback references browser-owned `authProvenance` and does not create a second schema.
- [ ] Provider fallback diagnostics do not collapse provider cookie import and system bootstrap into one bucket.
- [ ] Cookie values, private URLs, account identifiers, full user-data paths, and full profile paths are absent from user-facing diagnostics.
- [ ] Cookie observability is not described as Google auth verification.

Dependencies: Tasks 1 and 3.

## Task 5 - Preserve Guided OAuth Popup Recovery

Reasoning: Existing target controls and `/ops` popup ownership already cover most of the needed control plane. A watcher would add complexity before the project has enough diagnostics to prove it is necessary.

What to do: Keep runtime popup behavior stable and document the recovery loop for OAuth popups.

How:
1. Do not rewrite `/ops` popup ownership or promotion logic in `extension/src/ops/ops-runtime.ts`.
2. Add docs that say Google OAuth popups may create new targets and that agents should run `targets-list --include-urls` after clicking a Google sign-in or account chooser action.
3. Document explicit switching with `target-use --target-id <target-id>`.
4. Scope managed/CDP popup recovery as best-effort only. It does not make copied cookies equivalent to Google login.
5. If implementation adds any target hint, keep it derived from already available target URLs/titles and make it opt-in or host-only. Do not add a broad watcher.

Files impacted:
- `docs/CLI.md`
- `docs/TROUBLESHOOTING.md`
- `docs/ARCHITECTURE.md`
- `docs/FIRST_RUN_ONBOARDING.md`
- `src/public-surface/source.ts` if examples or command notes change
- Generated public-surface manifests if source changes
- No production runtime files expected for the first pass

Acceptance criteria:
- [ ] Docs include exact target recovery commands.
- [ ] Docs recommend extension `/ops` for Google-sensitive auth before target recovery.
- [ ] Docs state managed/CDP target recovery is best-effort and does not verify Google auth.
- [ ] Docs state profile picker and broad popup watcher are deferred.
- [ ] No stealth or bypass guidance is introduced.

Dependencies: Task 2 for final flag names.

## Task 6 - Sync Public Surface, Docs, And Skills

Reasoning: New command/tool options and auth guidance must stay consistent across the repo’s public surfaces. The docs guide requires source-owned public-surface updates and generated manifests when command/tool wording changes.

What to do: Update all user-facing surfaces that describe launch, cookie bootstrap, extension mode, and target recovery.

How:
1. Update `docs/CLI.md` with `--google-auth-intent user-owned`, `--disable-system-cookie-bootstrap`, extension `/ops` requirement, and copied-cookie limitations.
2. Update `docs/TROUBLESHOOTING.md` with a section for Google OAuth or first-party Google appearing logged out.
3. Update `docs/ARCHITECTURE.md` and `docs/FIRST_RUN_ONBOARDING.md` for mode boundaries and safe first-run guidance.
4. Update `src/public-surface/source.ts` for new CLI flags/tool args and examples, then regenerate `src/public-surface/generated-manifest.ts` and `src/public-surface/generated-manifest.json`.
5. Update `docs/SURFACE_REFERENCE.md` where generated or source-owned command/tool surface policy requires it.
6. Update `skills/opendevbrowser-best-practices/SKILL.md` so agents use extension `/ops` for Google-sensitive auth and avoid cookie transplant claims.
7. Treat `docs/ASSET_INVENTORY.md`, `docs/README.md`, `README.md`, and nested `AGENTS.md` files as conditional. Update them only if they already describe the changed command/tool surfaces or auth-mode policy.
8. Keep wording aligned with the audit: say perceived logout or auth invalidation, not proven Google-wide logout.

Files impacted:
- `docs/CLI.md`
- `docs/TROUBLESHOOTING.md`
- `docs/ARCHITECTURE.md`
- `docs/FIRST_RUN_ONBOARDING.md`
- `docs/SURFACE_REFERENCE.md`
- `docs/ASSET_INVENTORY.md` only if existing entries need auth-surface updates
- `docs/README.md` only if existing entries need auth-surface updates
- `README.md` only if existing entries need auth-surface updates
- `src/public-surface/source.ts`
- `src/public-surface/generated-manifest.ts`
- `src/public-surface/generated-manifest.json`
- `skills/opendevbrowser-best-practices/SKILL.md`
- Relevant nested `AGENTS.md` files only if surface rules change

Acceptance criteria:
- [ ] All new public flags and tool args are documented from source.
- [ ] Generated public-surface manifests are regenerated, not hand-edited.
- [ ] Docs separate live extension profile, system bootstrap, provider cookie import, and explicit cookie import.
- [ ] Docs do not claim DBSC or App-Bound Encryption caused this exact user issue.
- [ ] Docs do not recommend private Google login automation for repeat loops.

Dependencies: Tasks 1 through 5 for final option names, payload shapes, and popup recovery wording.

## Task 7 - Add Focused Regression Tests

Reasoning: The change adds new branch outcomes across launch routing, provider fallback, bootstrap skipping, and diagnostics. Tests should prove the new behavior without live Google accounts.

What to do: Add tests for each new branch and preserve current behavior for omitted intent.

How:
1. In `tests/cli-launch.test.ts`, cover parsing and forwarding of `--google-auth-intent user-owned` and `--disable-system-cookie-bootstrap`.
2. In `tests/cli-launch.test.ts`, cover that Google-sensitive intent does not prompt managed/CDP fallback after extension failure.
3. In `tests/tools.test.ts`, cover rejection of `noExtension`, `headless`, and `extensionLegacy` for Google-sensitive intent.
4. In `tests/tools.test.ts`, cover extension-unavailable failure and extension-ready success for Google-sensitive intent.
5. In `tests/browser-manager.test.ts`, cover managed and CDP bootstrap skip when disabled and existing default bootstrap when not disabled.
6. In `tests/browser-manager.test.ts`, cover sanitized diagnostics and explicit cookie import attempted state.
7. In provider runtime tests, cover extension-only fallback and no managed fallback for Google-sensitive intent.
8. Keep existing `/ops` popup tests unchanged unless type changes require updates.
9. Do not add live Google auth tests, cookie-value tests, or tests that depend on the user’s real Chrome profile.

Files impacted:
- `tests/cli-launch.test.ts`
- `tests/tools.test.ts`
- `tests/browser-manager.test.ts`
- Existing provider runtime policy/factory test files, or a new focused provider test if needed
- `tests/extension-ops-runtime.test.ts` only for type fallout
- Docs/public-surface tests if source-generated help changes require assertions

Acceptance criteria:
- [ ] New branch outcomes are covered.
- [ ] Existing managed/CDP/provider-cookie behavior remains covered.
- [ ] Tests do not inspect private Google state.
- [ ] Tests prove diagnostics are sanitized.
- [ ] No test suppressions or broad snapshots are added.

Dependencies: Tasks 1 through 4 for diagnostics and Task 2 for fail-closed fallback behavior.

## Task 8 - Run Quality Gates And Safe Validation

Reasoning: This touches browser session routing, provider runtime policy, CLI/tool surfaces, docs, generated manifests, and skills. It needs focused tests plus repo-standard gates before implementation can be considered complete.

What to do: Run focused validation first, then full quality gates.

How:
1. Regenerate public surface after source updates with `node scripts/generate-public-surface-manifest.mjs`.
2. Run focused tests for launch, browser manager cookie behavior, provider runtime policy, and `/ops` popup regressions.
3. Run docs drift and skill validation where changed.
4. Run the repo’s standard lint, typecheck, build, extension build, version check, and full test suite.
5. Run safe runtime smoke only on non-private URLs, such as extension readiness status and a managed `https://example.com` launch with bootstrap disabled. Do not inspect Google account pages or print cookies.
6. If live Google OAuth reproduction is requested later, require explicit user approval and use a dedicated test profile/account where possible.

Files impacted:
- No new source files beyond prior tasks.
- Generated public-surface files from Task 6.
- Local-only validation artifacts under ignored output roots if smoke tests produce them.

Acceptance criteria:
- [ ] `node scripts/generate-public-surface-manifest.mjs` passes.
- [ ] Focused tests pass.
- [ ] Docs drift and relevant skill validation pass.
- [ ] `npm run lint` passes.
- [ ] `npm run typecheck` passes.
- [ ] `npm run build` passes.
- [ ] `npm run extension:build` passes.
- [ ] `npm run version:check` passes.
- [ ] `npm run test` passes with coverage thresholds intact.
- [ ] Safe smoke does not print private cookies, account identifiers, or private URLs.

Dependencies: Tasks 1 through 7.

## Deferred Work

- Chrome-family profile picker. Add only after sanitized diagnostics show unintended profile selection is frequent.
- Broad OAuth popup watcher. Add only after a focused reproducer proves guided `targets-list` and `target-use` are insufficient.
- URL-based automatic Google intent detection. Defer to avoid accidental behavior changes.
- Full browser profile copying. Avoid as a default because it is brittle, privacy-sensitive, and conflicts with browser hardening direction.
- Any stealth, CAPTCHA, user-agent, or Google protection bypass behavior. Keep out of scope.

## Open Questions

No implementation-blocking questions remain for the first branch. The plan chooses an explicit Google-sensitive intent, extension `/ops` fail-closed routing, default Google-sensitive cookie skip with explicit diagnostic allow override, required CDP parity for bootstrap disable and unsafe-mode rejection, response-owned provenance diagnostics, and guided popup recovery.

UNCONFIRMED: whether the user’s observed symptom is confined to OpenDevBrowser’s automation context or triggers Google-side reauth across other live sessions. Do not claim Google-wide revocation without a user-approved live validation plan.

## References

- Investigation: `docs/investigations/google-oauth-session-invalidation-2026-06-22.md`
- Audit: `docs/investigations/google-oauth-session-invalidation-audit-2026-06-22.md`
- Audit recommendations: `.omo/ulw-loop/evidence/google-oauth-report-audit-recommendations.md`
- Google OAuth policy: https://developers.google.com/identity/protocols/oauth2/policies
- Google Account supported-browser help: https://support.google.com/accounts/answer/7675428
- Chrome remote-debugging profile restriction: https://developer.chrome.com/blog/remote-debugging-port
- Chrome Device Bound Session Credentials: https://developer.chrome.com/docs/web-platform/device-bound-session-credentials
- Google Workspace DBSC general availability: https://workspaceupdates.googleblog.com/2026/05/prevent-account-takeovers-with-DBSC-now-generally-available-in-the-Chrome-browser-for-Windows.html
- Chrome App-Bound Encryption: https://security.googleblog.com/2024/07/improving-security-of-chrome-cookies-on.html
- Playwright authentication state: https://playwright.dev/docs/auth
- Playwright popup handling: https://playwright.dev/docs/pages
