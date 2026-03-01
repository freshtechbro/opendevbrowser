# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.0.16] - 2026-02-28

### Added
- Release hardening automation scripts for preflight and compliance:
  - `scripts/audit-zombie-files.mjs`
  - `scripts/docs-drift-check.mjs`
  - `scripts/chrome-store-compliance-check.mjs`
  - `scripts/provider-live-scenarios.mjs`
  - `scripts/release-gate-test-groups.mjs`
- PR and release workflow gates for zombie-file audit, docs drift, extension-store compliance, and optional strict live release lanes.
- Grouped release-gate npm scripts (`test:release-gate`, `test:release-gate:g1..g5`) for deterministic reruns.

### Changed
- Compared to `v0.0.15`, this release consolidates automation platform/runtime work (provider workflows, macro execute, blocker envelopes, debug-trace surfaces), multitab governance hardening, and release governance/documentation upgrades.
- `live-regression-matrix` now supports strict `--release-gate` mode, extension readiness recovery, stale worker cleanup, declared-divergence handling, and stronger scenario summarization semantics.
- `provider-live-matrix` now supports strict release-gate mode with provider coverage assertions, nested live-matrix orchestration controls, extension-launch recovery, and deterministic high-friction/auth-gated handling.
- CLI launch behavior now derives daemon RPC timeout from `--wait-timeout-ms` hints to prevent premature timeout failures during extension waits.
- Macro execute daemon path now accepts bounded runtime timeout overrides and maps them into provider operation budgets.
- CLI `--version` output is sourced from `package.json` (removed stale hardcoded version path).
- Version verification now enforces parity across `package.json`, `extension/manifest.json`, and `extension/package.json`.

### Fixed
- Relay extension-mode CDP connect now retries known stale-tab `Target.setAutoAttach` failure paths before failing.
- Extension TypeScript event typing drift (`TabChangeInfo` -> `OnUpdatedInfo`) and CDP command param typing were tightened to avoid compile/runtime mismatch edges.
- Provider runtime circuit-breaker timing assertions were stabilized in tests to reduce flaky cooldown-window checks.

### Removed
- Stale planning/design artifacts and prototypes that are no longer release sources of truth.
- Legacy/unneeded local artifacts and stale helper scripts superseded by explicit release-gate automation.

### Documentation
- Swept and refreshed release-facing docs and runbooks across architecture, CLI, troubleshooting, onboarding, extension release, distribution, asset inventory, and dependency inventory surfaces.
- Updated release evidence ledger and strict gate references for v0.0.16 operations.

### Tests
- Added regression coverage for:
  - launch timeout derivation and daemon call timeout forwarding
  - relay stale-tab attach retry behavior
  - release audit scripts and grouped release-gate orchestration
- Preserved full-repo coverage threshold expectations (`>=97%`) while expanding release-governance checks.

## [0.0.15] - 2026-02-08

### Added
- Release distribution plan for npm, GitHub branch/PR flow, and GitHub Releases (`docs/DISTRIBUTION_PLAN.md`).

### Changed
- Updated README/CLI/extension guidance and project metadata.
- Bumped package and extension versions to `0.0.15`.

### Fixed
- Completed extension-mode remediation and native host automation flow.
- Hardened extension Ops/CDP handling and cleaned up Ops sessions on disconnect.
- Resolved typecheck/lint edge cases in Ops-related paths.

### Tests
- Expanded browser and target coverage.
- Stabilized CLI native status assertions.

## [0.0.14] - 2026-02-02

### Added
- Ops parity and end-to-end coverage across daemon and relay.
- Multi-client session tracking in core runtime.
- Expanded DOM query and interaction tools/CLI commands.
- Multi-client extension CDP router improvements.

### Changed
- Strengthened relay, extension, and daemon reliability paths.
- Refreshed CLI/extension/docs guidance for new workflows.
- Updated extension assets packaging flow during `extension:build`.

### Fixed
- Relay binding contention and extension instance mismatch cases.
- Native host and extension-mode workflow edge cases.

### Security
- Hardened relay authentication, token handling, and connection checks.

## [0.0.13] - 2026-01-19

### Added
- Hub daemon mode for centralized browser management
- Remote relay support for distributed setups
- Extension relay with flat session support (Chrome 125+)
- Multi-client CDP broker capability
- FIFO lease management for shared resources
- Annotation system for visual debugging
- Skill pack discovery and loading system

### Changed
- Refactored browser manager for hub compatibility
- Improved session lifecycle management
- Enhanced CDP connection handling

### Fixed
- Session cleanup on abrupt disconnections
- Target manager race conditions
- Snapshot pipeline edge cases

## [0.0.12] - 2026-01-11

### Added
- 41 browser automation tools
- Chrome extension for relay mode
- Snapshot-based interaction system
- DevTools integration (console, network, performance)
- Page export capabilities (React component cloning)
- Script runner for custom automation
- Configuration system with JSONC support

### Changed
- Migrated to Playwright for browser control
- Improved AX-tree snapshot accuracy
- Enhanced ref management system

## [0.0.11] - 2026-01-02

### Added
- Initial OpenCode plugin implementation
- CDP-based browser automation
- Basic tool set (launch, snapshot, click, type)
- CLI interface for automation scripts
- TypeScript support with strict mode

## [0.0.10] - 2026-01-02

### Added
- Project bootstrap
- Initial architecture design
- Core browser management
- Basic snapshot pipeline

[Unreleased]: https://github.com/freshtechbro/opendevbrowser/compare/v0.0.16...HEAD
[0.0.16]: https://github.com/freshtechbro/opendevbrowser/compare/v0.0.15...v0.0.16
[0.0.15]: https://github.com/freshtechbro/opendevbrowser/compare/ebb109e...eaced1e
[0.0.14]: https://github.com/freshtechbro/opendevbrowser/compare/v0.0.13...ebb109e
[0.0.13]: https://github.com/freshtechbro/opendevbrowser/compare/v0.0.12...v0.0.13
[0.0.12]: https://github.com/freshtechbro/opendevbrowser/compare/v0.0.11...v0.0.12
[0.0.11]: https://github.com/freshtechbro/opendevbrowser/compare/v0.0.10...v0.0.11
[0.0.10]: https://github.com/freshtechbro/opendevbrowser/releases/tag/v0.0.10
