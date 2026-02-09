# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.0.14] - 2025-02-08

### Added
- Extension mode remediation with native host automation
- Daemon auto-install on first use
- Ops parity and E2E coverage for daemon and relay
- CLI native status improvements
- Enhanced relay security hardening
- Improved extension ops/cdp handling
- Clean up ops sessions on disconnect
- Comprehensive test coverage expansion for browser and target modules

### Changed
- Updated CLI and extension documentation
- Improved error handling for extension-only workflows
- Enhanced daemon stability and reliability

### Fixed
- Extension instance mismatch issues
- Relay binding busy scenarios
- Command3.agent error in certain workflows
- Native host integration edge cases

### Security
- Hardened relay authentication
- Improved token validation
- Enhanced rate limiting for relay connections

## [0.0.13] - 2025-01-25

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

## [0.0.12] - 2025-01-10

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

## [0.0.11] - 2024-12-20

### Added
- Initial OpenCode plugin implementation
- CDP-based browser automation
- Basic tool set (launch, snapshot, click, type)
- CLI interface for automation scripts
- TypeScript support with strict mode

## [0.0.10] - 2024-12-10

### Added
- Project bootstrap
- Initial architecture design
- Core browser management
- Basic snapshot pipeline

[Unreleased]: https://github.com/opencode-ai/opendevbrowser/compare/v0.0.14...HEAD
[0.0.14]: https://github.com/opencode-ai/opendevbrowser/compare/v0.0.13...v0.0.14
[0.0.13]: https://github.com/opencode-ai/opendevbrowser/compare/v0.0.12...v0.0.13
[0.0.12]: https://github.com/opencode-ai/opendevbrowser/compare/v0.0.11...v0.0.12
[0.0.11]: https://github.com/opencode-ai/opendevbrowser/compare/v0.0.10...v0.0.11
[0.0.10]: https://github.com/opencode-ai/opendevbrowser/releases/tag/v0.0.10
