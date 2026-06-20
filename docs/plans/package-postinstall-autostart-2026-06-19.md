# Package Postinstall Autostart: Plan

## Goal
Extend opendevbrowser install-time daemon autostart reconciliation so raw global package installs such as `npm install -g opendevbrowser` can safely provision or repair the per-user macOS LaunchAgent or Windows scheduled task when the installed CLI entrypoint is stable.

Success means package postinstall reuses the existing autostart safety model, never persists transient `_npx`, `/tmp`, `/private/tmp`, or onboarding workspace paths, keeps package installation best effort, and leaves existing CLI plugin install plus `opendevbrowser daemon install|status|uninstall` behavior unchanged.

## Background
- The current npm package lifecycle publishes `dist`, `skills`, `scripts/postinstall-sync-skills.mjs`, native scripts, and extension assets. `package.json:8-20` defines the CLI binary and shipped files, and `package.json:65-66` runs only `node scripts/postinstall-sync-skills.mjs` during package `postinstall`.
- The package postinstall shim is intentionally best effort. `scripts/postinstall-sync-skills.mjs:8-33` skips `OPDEVBROWSER_SKIP_POSTINSTALL_SKILL_SYNC=1`, skips repo checkouts by checking `.git`, imports `dist/cli/installers/postinstall-skill-sync.js`, and warns instead of failing package installation when the built entry is missing or throws.
- The built postinstall implementation only syncs bundled skills. `src/cli/installers/postinstall-skill-sync.ts:10-68` defines `PostinstallSkipReason`, `PostinstallSkillSyncResult`, and `runPostinstallSkillSync()`, defaults to global skill sync, and supports `skipRepoCheckoutGuard` for tests.
- Package-root resolution is cached and not injectable today. `src/utils/package-assets.ts:8-47` finds the package root by walking upward from the built module path, caches the result, and exposes `getPackageRoot()`.
- CLI plugin install already reconciles autostart. `src/cli/index.ts:283-304` imports install modules, skill sync, autostart reconciliation, output helpers, extension extraction, and onboarding metadata. `src/cli/index.ts:322-352` runs `installGlobal()` or `installLocal()`, then calls `reconcileInstallAutostart(result)` after successful install and includes autostart payload in JSON output.
- The current reconciliation contract is reusable but plugin-install shaped. `src/cli/install-autostart-reconciliation.ts:4-105` defines `OPDEVBROWSER_SKIP_INSTALL_AUTOSTART_RECONCILIATION`, `AutostartAction`, and `reconcileInstallAutostart()`. It skips failed installs and env-disabled runs, reports unsupported and healthy states without attempting repair, installs missing entries, repairs `needs_repair` or `malformed`, and reports `repair_failed` with a reread status snapshot when install throws.
- Autostart implementation is platform-owned in `src/cli/daemon-autostart.ts`. `src/cli/daemon-autostart.ts:134-185` resolves the current CLI entrypoint and marks temp roots or `_npx` cache paths as transient. `src/cli/daemon-autostart.ts:510-554` refuses transient entrypoints before writing anything, creates macOS LaunchAgent/log/working directories, writes the plist, and runs `launchctl bootout/bootstrap/enable/kickstart`. `src/cli/daemon-autostart.ts:745-756` creates the Windows logon task with `schtasks`.
- macOS LaunchAgent shape is already hardened. `src/cli/daemon-autostart.ts:197-233` writes absolute `node + cli + serve` `ProgramArguments`, `RunAtLoad`, `KeepAlive`, `WorkingDirectory`, and stdout/stderr paths. `src/cli/daemon-autostart.ts:393-499` classifies missing, malformed, broken, transient, working-directory-mismatched, entrypoint-mismatched, and healthy LaunchAgents.
- Stable persisted autostart remains authoritative even from transient invocations. `tests/daemon-autostart.test.ts:498-520` covers stable persisted plist staying healthy when the current invocation is transient, and the docs state this in `docs/ARCHITECTURE.md:45-50`.
- Explicit manual repair remains `opendevbrowser daemon install`. `src/cli/commands/daemon.ts:143-172` calls `installAutostart()` directly, preserves transient-path errors, and returns unsupported-platform failures. `src/cli/commands/daemon.ts:203-226` uses `getAutostartStatus()` as canonical status and includes nested `autostart` only on supported platforms.
- Existing tests cover the seams this work should extend, not bypass. `tests/postinstall-skill-sync.test.ts:104-200` verifies the package hook, global skill sync, repo checkout skip, env skip, missing built entry warning, and shim import behavior. `tests/install-autostart-reconciliation.test.ts:28-463` covers skip, unsupported, healthy, missing, repair, malformed, transient, Windows, and failure cases. `tests/install-autostart-output.test.ts:28-101` covers JSON/text output. `tests/daemon-autostart.test.ts:160-746` covers entrypoint resolution, plist/task construction, repair classification, install calls, and transient refusal.
- Public docs currently describe successful CLI installs as reconciling autostart. `docs/CLI.md:223-229` says the CLI reconciles daemon auto-start on successful installs and warns on transient paths. `docs/CLI.md:360-411` documents the explicit daemon auto-start command, status payload, transient refusal, and manual fallback. `README.md:122-124` currently uses broad install wording while separately saying package installation best-effort syncs skills during package postinstall.
- Onboarding and release evidence treat temp-workspace autostart warnings as expected. `docs/FIRST_RUN_ONBOARDING.md:144-174` separates temp packaged install validation from stable auto-start follow-up. `docs/RELEASE_0.0.18_EVIDENCE.md:131-133` and `docs/RELEASE_0.0.22_EVIDENCE.md:106-111` record transient autostart warnings as expected package-onboarding behavior.
- Prior commits called out by repository history and agent exploration: `2869775` introduced daemon autostart commands, `53e3c7f` stabilized macOS LaunchAgent working directories, and `457a24c` established package postinstall skill sync.

## Approach
Keep the published lifecycle script path stable, but broaden the built package postinstall entrypoint into a small package-postinstall orchestrator. Preserve the shipped import path `dist/cli/installers/postinstall-skill-sync.js`; the implementation may keep the orchestration in that file or introduce a focused sibling module that is re-exported from it if that keeps the current skill-sync module small.

Autostart reconciliation should run only for a stable global package install. The first guard is package-manager context that clearly indicates a global install; local project installs should keep current skill-sync behavior and skip autostart. The second guard is the existing stable-entrypoint safety in `daemon-autostart.ts`, which must still refuse `_npx`, `/tmp`, `/private/tmp`, and onboarding workspace paths before writing LaunchAgent or scheduled-task state.

The selected autostart skip knob is the existing `OPDEVBROWSER_SKIP_INSTALL_AUTOSTART_RECONCILIATION`. Do not add a package-specific autostart environment variable. Preserve the current top-level `OPDEVBROWSER_SKIP_POSTINSTALL_SKILL_SYNC=1` shim behavior as a legacy full package-postinstall no-op for compatibility; document that it suppresses the lifecycle shim before any built postinstall work runs, while the autostart-specific opt-out is `OPDEVBROWSER_SKIP_INSTALL_AUTOSTART_RECONCILIATION=1`.

Do not route CLI plugin install through the package postinstall orchestrator. `src/cli/index.ts` should continue to call `reconcileInstallAutostart(result)` and use `install-autostart-output.ts`; `opendevbrowser daemon install` should continue to call `installAutostart()` directly and hard-fail on transient current paths.

## Work Items

## Task 1 - Define Package Postinstall Boundary And Result Contracts
Reasoning: The current built postinstall module only models skill sync, but package installation now needs to coordinate skill sync, global-install detection, autostart reconciliation, and best-effort warnings without changing CLI install behavior.
What to do: Add package-level result and options contracts while preserving the existing skill-sync API and the shipped built import path.
How:
1. Keep `PostinstallSkillSyncResult` and `runPostinstallSkillSync()` available for current callers and tests.
2. Add `PostinstallAutostartResult` and `PackagePostinstallResult` shapes with `success`, `skipped`, operation-specific status, and printable `warnings`.
3. Add `RunPackagePostinstallOptions` with injectable env, package-root or CLI-entrypoint resolver, global-install detector, and autostart dependencies.
4. Preserve `dist/cli/installers/postinstall-skill-sync.js` as the built import path; create a small sibling module only if it avoids growing `postinstall-skill-sync.ts` beyond a focused boundary.
Files impacted: `src/cli/installers/postinstall-skill-sync.ts`; optional new `src/cli/installers/package-postinstall.ts`.
End goal: Package postinstall has one typed orchestration surface, and existing skill-sync callers remain stable.
Acceptance criteria:
- Existing callers of `runPostinstallSkillSync()` still compile.
- `src/cli/index.ts` does not import or call the package postinstall orchestrator.
- Warnings are structured so the shim can print them with the existing `[opendevbrowser]` prefix.
- Tests can inject env, package root or CLI path, global-install status, and autostart dependencies.
Dependencies: None.
Size: Small.

## Task 2 - Resolve Stable Global Package Context And CLI Entrypoint
Reasoning: During npm lifecycle execution, `process.argv[1]` points at `scripts/postinstall-sync-skills.mjs`; autostart must target the packaged CLI binary, and local project installs should not create a user login item.
What to do: Add helpers that decide whether the package postinstall is eligible for autostart and resolve the exact packaged CLI entrypoint.
How:
1. Detect a global package install only from reliable package-manager context available in the lifecycle environment.
2. If the context is local, missing, or ambiguous, skip autostart non-fatally and leave skill sync behavior unchanged.
3. Resolve the package root through existing package asset helpers or injected test options.
4. Build and validate `<packageRoot>/dist/cli/index.js`.
5. Return a warning or skipped autostart result when the CLI entrypoint is missing.
Files impacted: `src/cli/installers/postinstall-skill-sync.ts`; optional new `src/cli/installers/package-postinstall.ts`; `src/utils/package-assets.ts` only if a shared helper is clearly cleaner.
End goal: Package postinstall autostart runs only from a clear global install and always targets the CLI binary, never the lifecycle shim or a local dependency path.
Acceptance criteria:
- Tests can force global, local, and ambiguous lifecycle contexts without relying on process-global state.
- Captured autostart status/install closures receive `argv1` ending in `dist/cli/index.js`.
- Missing CLI entrypoint produces a warning result and never calls `installAutostart()`.
- No platform autostart classification logic is copied into the postinstall module.
Dependencies: Task 1.
Size: Medium.

## Task 3 - Add Package Autostart Reconciliation
Reasoning: Raw global package installs should reuse existing reconciliation and daemon-autostart safety instead of introducing a new platform install path.
What to do: Add a package-postinstall autostart helper that injects the packaged CLI path into `getAutostartStatus()` and `installAutostart()`.
How:
1. Reuse `reconcileInstallAutostart()` from `src/cli/install-autostart-reconciliation.ts`.
2. Reuse `getAutostartStatus()` and `installAutostart()` from `src/cli/daemon-autostart.ts`.
3. Resolve eligibility and CLI path through Task 2 helpers.
4. Call reconciliation with an install-result object that represents a successful existing package install, so missing and repair states are eligible.
5. Pass dependency closures that call `getAutostartStatus({ argv1: cliPath })` and `installAutostart({ argv1: cliPath })`.
6. Pass env through reconciliation options so `OPDEVBROWSER_SKIP_INSTALL_AUTOSTART_RECONCILIATION` remains authoritative.
7. Convert `repair_failed`, unsupported platform, local or ambiguous install context, and missing-entrypoint outcomes into skipped results or warnings without throwing.
Files impacted: `src/cli/installers/postinstall-skill-sync.ts`; optional new `src/cli/installers/package-postinstall.ts`.
End goal: `npm install -g opendevbrowser` can install or repair autostart when the packaged CLI path is stable, while unsafe and unsupported cases stay non-fatal.
Acceptance criteria:
- Missing autostart leads to an `installed` action when injected dependencies report an eligible stable global package path.
- `needs_repair` and `malformed` lead to `repaired` actions through existing reconciliation.
- Transient package paths produce `repair_failed` or an equivalent warning without writing state.
- Unsupported platforms and local package installs never call `installAutostart()`.
- `OPDEVBROWSER_SKIP_INSTALL_AUTOSTART_RECONCILIATION=1` suppresses only package autostart when the shim has not already exited.
Dependencies: Tasks 1 and 2.
Size: Medium.

## Task 4 - Update The Lifecycle Orchestrator And Shim
Reasoning: The npm lifecycle script must invoke the broader postinstall operation while preserving the current best-effort exit status and compatibility skips.
What to do: Add `runPackagePostinstall()` in the built postinstall surface and make `scripts/postinstall-sync-skills.mjs` call it.
How:
1. Keep `OPDEVBROWSER_SKIP_POSTINSTALL_SKILL_SYNC=1` as a top-level shim exit before importing built code.
2. Keep `.git` repo checkout skip before importing built package code.
3. Call `runPostinstallSkillSync()` first inside the orchestrator to preserve existing skill-sync behavior when the shim does not skip.
4. Call package autostart reconciliation after skill sync only when Task 2 eligibility passes.
5. Preserve exit status `0` for missing built entry, import failure, thrown orchestrator errors, unsupported platforms, local install context, transient autostart refusal, and repair failures.
6. Print returned warnings with the `[opendevbrowser]` prefix and keep full-success output quiet.
7. Update missing built-entry and catch-all warnings to describe package postinstall rather than only skill sync.
Files impacted: `scripts/postinstall-sync-skills.mjs`; `src/cli/installers/postinstall-skill-sync.ts`; optional new `src/cli/installers/package-postinstall.ts`.
End goal: Raw global package installs execute the orchestrator without making package installation fail because autostart could not be installed.
Acceptance criteria:
- Missing built entry still exits `0`.
- Thrown built entry still exits `0`.
- `OPDEVBROWSER_SKIP_POSTINSTALL_SKILL_SYNC=1` and repo checkout skips still exit `0` without importing built code.
- Package warning text is actionable and does not claim plugin install success.
- CLI plugin install and manual daemon command flows remain functionally unchanged.
Dependencies: Task 3.
Size: Medium.

## Task 5 - Expand Package Postinstall Tests
Reasoning: The package lifecycle seam is the primary behavior change and must be covered without touching real OS autostart state.
What to do: Extend `tests/postinstall-skill-sync.test.ts` for the orchestrator, package context detection, autostart helper, shim behavior, and warning behavior.
How:
1. Add a test that `runPackagePostinstall()` runs skill sync and successful autostart reconciliation for an eligible global package install.
2. Add tests for missing autostart producing `installed`, `needs_repair` producing `repaired`, and malformed status producing `repaired`.
3. Add a transient-path repair failure test that returns a warning and stays non-fatal.
4. Add an autostart skip-env test that suppresses autostart while preserving skill sync.
5. Add local and ambiguous package-context tests that skip autostart and never call install.
6. Add an unsupported-platform test that never calls install.
7. Add entrypoint safety assertions that capture the `argv1` value passed to status and install closures and prove it ends in `dist/cli/index.js`.
8. Add a missing `dist/cli/index.js` test that produces a warning and never calls install.
9. Update packaged fixture tests so the built fixture exports `runPackagePostinstall()` and the shim imports it.
10. Keep missing built entry and thrown built entry tests asserting exit status `0`.
Files impacted: `tests/postinstall-skill-sync.test.ts`; `tests/package-assets.test.ts` only if a shared package path helper is extracted.
End goal: Package postinstall autostart behavior is covered at the lifecycle seam where package installation behavior is already tested.
Acceptance criteria:
- All new tests use injected dependencies or fixture code and never write real LaunchAgent or scheduled-task state.
- Fixture subprocess tests still execute `scripts/postinstall-sync-skills.mjs`.
- Exit status remains `0` for best-effort failure cases.
- Warning text does not duplicate CLI plugin install wording.
Dependencies: Tasks 1 to 4.
Size: Medium.

## Task 6 - Preserve Shared Autostart And CLI Contracts
Reasoning: The change should be limited to raw global package postinstall and must not regress existing user-visible CLI flows.
What to do: Keep existing CLI install, daemon command, output helper, and shared platform safety contracts intact.
How:
1. Do not route `src/cli/index.ts` install through `runPackagePostinstall()`.
2. Keep `reconcileInstallAutostart(result)` in the CLI install command.
3. Keep `opendevbrowser daemon install` calling `installAutostart()` directly.
4. Keep manual daemon install hard-failing on transient current paths.
5. Keep `install-autostart-output.ts` focused on CLI plugin install output.
6. Add package-shaped shared reconciliation coverage only if it clarifies the install-result object used by Task 3.
Files impacted: `src/cli/index.ts`, `src/cli/install-autostart-output.ts`, `src/cli/commands/daemon.ts`, `tests/install-autostart-reconciliation.test.ts`, `tests/install-autostart-output.test.ts`, `tests/daemon-autostart.test.ts` only if tests expose a needed narrow update.
End goal: Only package postinstall behavior changes.
Acceptance criteria:
- Existing CLI install autostart output tests remain green.
- Existing daemon command and daemon-autostart tests remain green.
- Manual daemon install still fails on transient paths.
- CLI plugin install still reports `autostartAction` and `autostartError` as before.
Dependencies: Tasks 3 to 5.
Size: Small.

## Task 7 - Update Public And Operator Documentation
Reasoning: The install story will change. Docs must distinguish CLI plugin install, global package postinstall, local package installs, stable install locations, and temp onboarding paths.
What to do: Update README and operator docs where behavior wording changes.
How:
1. Update `README.md` installation wording to state that CLI plugin install reconciles autostart after successful plugin install and raw global package postinstall best-effort reconciles autostart when the packaged CLI path is stable.
2. Keep skill sync wording separate from autostart reconciliation.
3. Document `OPDEVBROWSER_SKIP_INSTALL_AUTOSTART_RECONCILIATION=1` as the autostart-specific opt-out.
4. Clarify that `OPDEVBROWSER_SKIP_POSTINSTALL_SKILL_SYNC=1` remains a legacy full package lifecycle shim skip because the current shim exits before importing built code.
5. Update `docs/CLI.md` package install and daemon auto-start sections with the new raw global package postinstall behavior and non-fatal warning semantics.
6. Update `docs/FIRST_RUN_ONBOARDING.md` so temp package validation expects autostart warnings or skips and keeps stable auto-start follow-up separate.
7. Update `docs/ARCHITECTURE.md` to list global package postinstall as a second install-time reconciliation path while keeping `daemon-autostart.ts` as the platform safety owner.
Files impacted: `README.md`, `docs/CLI.md`, `docs/FIRST_RUN_ONBOARDING.md`, `docs/ARCHITECTURE.md`.
End goal: Users and operators understand that stable global package installs get automatic best-effort autostart, while local installs and temp paths are skipped or refused and manual repair remains available.
Acceptance criteria:
- Docs do not imply package install fails when autostart fails.
- Docs do not imply local project installs or temp onboarding workdirs persist autostart.
- Docs identify both the autostart-specific skip env and the legacy full shim skip.
- Docs preserve manual fallback commands.
Dependencies: Tasks 4 to 6.
Size: Medium.

## Task 8 - Validate Focused Behavior And Full Gates
Reasoning: The change spans package lifecycle, autostart reconciliation, daemon safety, output contracts, docs, and package path helpers.
What to do: Run focused tests first, then full repo gates and a package-shaped smoke.
How:
1. Run `npm run test -- tests/postinstall-skill-sync.test.ts`.
2. Run `npm run test -- tests/install-autostart-reconciliation.test.ts`.
3. Run `npm run test -- tests/install-autostart-output.test.ts`.
4. Run `npm run test -- tests/daemon-autostart.test.ts`.
5. Run `npm run test -- tests/package-assets.test.ts` if package path helper code changes.
6. Run targeted lint for changed TypeScript and JavaScript files through the repo tool wrapper.
7. Run `npm run lint`.
8. Run `npm run typecheck`.
9. Run `npm run build`.
10. Run `npm run test`.
11. Run `npm run extension:build`.
12. Run `npm run version:check`.
13. Run a package-shaped smoke with isolated `HOME`, `OPENCODE_CONFIG_DIR`, and `OPENCODE_CACHE_DIR`. Use skip envs when needed to avoid changing the operator machine's real autostart during validation, and rely on injected/unit tests for write assertions.
14. If a live autostart proof is required, run it only from a stable disposable global install location and clean up with `opendevbrowser daemon uninstall` for that isolated lane.
Files impacted: generated temp/package artifacts only; no source files.
End goal: Confirm the implementation is release-ready and does not damage local machine state during validation.
Acceptance criteria:
- All targeted suites pass.
- No test writes real OS autostart state.
- Full gates pass with zero errors and zero warnings.
- Coverage remains at or above the repository threshold.
- Package smoke exits successfully and preserves expected warning, skip, or success semantics.
- Any live autostart validation is explicitly bounded and cleaned up.
Dependencies: Tasks 5 to 7.
Size: Medium.

## Open Questions
No implementation-blocking open questions remain for the plan. The plan chooses global package installs only, preserves local package installs as autostart skips, keeps `OPDEVBROWSER_SKIP_INSTALL_AUTOSTART_RECONCILIATION` as the canonical autostart opt-out, and preserves `OPDEVBROWSER_SKIP_POSTINSTALL_SKILL_SYNC=1` as the legacy top-level lifecycle shim skip.

## References
- `package.json:8-20`, `package.json:65-66`
- `scripts/postinstall-sync-skills.mjs:8-33`
- `src/cli/installers/postinstall-skill-sync.ts:10-68`
- `src/utils/package-assets.ts:8-47`
- `src/cli/index.ts:283-352`
- `src/cli/install-autostart-reconciliation.ts:4-105`
- `src/cli/install-autostart-output.ts:7-49`
- `src/cli/daemon-autostart.ts:134-185`, `src/cli/daemon-autostart.ts:197-233`, `src/cli/daemon-autostart.ts:393-554`, `src/cli/daemon-autostart.ts:745-756`
- `src/cli/commands/daemon.ts:143-226`
- `tests/postinstall-skill-sync.test.ts:104-200`
- `tests/install-autostart-reconciliation.test.ts:28-463`
- `tests/install-autostart-output.test.ts:28-101`
- `tests/daemon-autostart.test.ts:160-746`
- `docs/CLI.md:223-229`, `docs/CLI.md:360-411`
- `README.md:122-124`
- `docs/FIRST_RUN_ONBOARDING.md:144-174`
