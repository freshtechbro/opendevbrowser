# Contributing to OpenDevBrowser

Thank you for your interest in contributing to OpenDevBrowser! This document provides guidelines and instructions for contributing to the project.

## Table of Contents

- [Development Setup](#development-setup)
- [Coding Standards](#coding-standards)
- [Testing Requirements](#testing-requirements)
- [Commit Guidelines](#commit-guidelines)
- [Pull Request Process](#pull-request-process)
- [Extension Development](#extension-development)
- [Documentation](#documentation)
- [Getting Help](#getting-help)

## Development Setup

### Prerequisites

- **Node.js**: 18.x or higher
- **npm**: 9.x or higher
- **Chrome**: 125+ (for extension mode)
- **Git**: Latest stable version

### Installation

1. Fork and clone the repository:
   ```bash
   git clone https://github.com/YOUR_USERNAME/opendevbrowser.git
   cd opendevbrowser
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the project:
   ```bash
   npm run build
   ```

4. Run tests:
   ```bash
   npm test
   ```

### Development Workflow

```bash
# Start development mode (watch mode)
npm run dev

# Run linting
npm run lint

# Run tests with coverage
npm run test

# Build extension
npm run extension:build
```

## Coding Standards

### TypeScript

- **Strict mode enabled**: All code must pass strict TypeScript checks
- **No `any` types**: Use `unknown` with proper type narrowing
- **Import types**: Use `import type` for type-only imports
- **Zod validation**: Validate all external inputs at boundaries

### Naming Conventions

- **Files/Folders**: `kebab-case` (e.g., `browser-manager.ts`)
- **Variables/Functions**: `camelCase` (e.g., `launchBrowser`)
- **Classes/Types**: `PascalCase` (e.g., `BrowserManager`)
- **Tools**: `opendevbrowser_*` prefix required

### Code Organization

- **Tools**: Thin wrappers (validation + response shaping)
- **Managers**: Own lifecycle and state
- **Keep boundaries clear**: No business logic in tools

### Security

- **Timing-safe comparison**: Use `crypto.timingSafeEqual()` for tokens
- **No hardcoded endpoints**: Use config `relayPort`/`relayToken`
- **Redact secrets**: Never log tokens or sensitive data
- **Localhost only**: CDP endpoints restricted to 127.0.0.1, ::1, localhost

See [src/AGENTS.md](src/AGENTS.md) and [src/tools/AGENTS.md](src/tools/AGENTS.md) for detailed conventions.

## Testing Requirements

### Coverage Threshold

**Minimum 97% coverage** required for all metrics:
- Lines
- Functions
- Branches
- Statements

### Running Tests

```bash
# Run all tests
npm run test

# Run specific test file
npm run test -- tests/browser-manager.test.ts

# Run with coverage report
npm run test -- --coverage

# Run in watch mode
npm run test -- --watch
```

### Test Guidelines

- **Never weaken tests**: Fix the code, not the test
- **Add regression tests**: Every bug fix should include a test
- **Hermetic mocks**: Tests must be isolated and reproducible
- **Focus areas**: Hub daemon, extension relay, CLI smoke tests

See [tests/AGENTS.md](tests/AGENTS.md) for detailed testing conventions.

## Commit Guidelines

We follow [Conventional Commits](https://www.conventionalcommits.org/):

### Format

```
<type>: <short summary>

- Bullet point details
- What was added/changed/fixed
- Why (if not obvious)
```

### Types

| Type | Description |
|------|-------------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation changes |
| `test` | Test additions or fixes |
| `chore` | Maintenance, refactoring |
| `security` | Security-related changes |

### Examples

```
feat: add CLI installer with jarvis-mcp pattern

- Implement native host installer
- Add auto-detection for Chrome
- Include error handling for missing permissions

fix: resolve race condition in target manager

- Add mutex for target acquisition
- Prevent duplicate target IDs
- Add regression test
```

## Pull Request Process

1. **Pre-commit Checklist**:
   ```bash
   npm run lint      # Must pass with no errors
   npm run build     # Must compile successfully
   npm run test      # All tests must pass (97% coverage)
   ```

2. **Branch naming**: `feature/description`, `fix/description`, `docs/description`

3. **PR Description**:
   - Summary of changes
   - Test notes
   - Extension screenshots (if applicable)
   - Breaking changes (if any)

4. **Review Requirements**:
   - All CI checks must pass
   - Code review approval required
   - Documentation updated if needed

## Extension Development

### Building the Extension

```bash
# Build extension TypeScript
npm run extension:build

# Sync version from package.json
npm run extension:sync

# Verify version alignment
npm run version:check
```

### Extension Structure

```
extension/
├── src/
│   ├── background.ts          # Service worker
│   ├── annotate-content.ts    # Content script
│   ├── popup.tsx             # Settings UI
│   ├── ops/                  # Operations handlers
│   └── services/             # Core services
│       ├── ConnectionManager.ts
│       ├── RelayClient.ts
│       ├── CDPRouter.ts
│       └── TargetSessionMap.ts
```

See [extension/AGENTS.md](extension/AGENTS.md) for detailed extension conventions.

### Testing Extension Changes

1. Build extension: `npm run extension:build`
2. Load in Chrome (developer mode)
3. Test with CLI: `opendevbrowser launch --extension-only`
4. Verify in popup: Check connection status

## Documentation

### Updating Documentation

When making changes, update relevant documentation:

- **README.md**: User-facing features, installation, quick start
- **docs/CLI.md**: CLI commands and options
- **docs/ARCHITECTURE.md**: System design changes
- **docs/TROUBLESHOOTING.md**: Common issues and solutions
- **AGENTS.md**: Development conventions (nearest to changed code)

### Documentation Standards

- Keep it concise (50-150 lines for AGENTS.md)
- Use telegraphic style
- No generic advice
- Cross-reference related docs
- Include code examples where helpful

## Getting Help

- **Discord**: [OpenCode Community](https://discord.gg/opencode)
- **Issues**: [GitHub Issues](https://github.com/opencode-ai/opendevbrowser/issues)
- **Discussions**: [GitHub Discussions](https://github.com/opencode-ai/opendevbrowser/discussions)

### Before Asking

1. Check [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)
2. Search existing issues
3. Review relevant AGENTS.md files
4. Check [README.md](README.md) for common questions

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).

---

**Thank you for contributing to OpenDevBrowser!**
