# COMPREHENSIVE IMPLEMENTATION PLAN
## OpenDevBrowser Skill System Extension + CLI Installer + Multi-Platform Release

**Version:** 2.0 (Validated)  
**Date:** December 28, 2025  
**Scope:** Skill system extension, CLI installer (jarvis-mcp pattern), NPM registry, Chrome Web Store, OpenCode plugin alignment

---

## Overview

### Distribution Channels
| Channel | Current State | Action Required |
|---------|--------------|-----------------|
| **NPM Registry** | Ready (v0.1.0) | Add CLI, skill system, publish |
| **Chrome Web Store** | Not published | Full submission workflow |
| **OpenCode Plugin** | Working | Validated alignment |

### Key Deliverables
1. **CLI Installer** following jarvis-mcp pattern (`--local`/`--global` flags)
2. Extended skill system with multi-skill support
3. New skill tools (`skill_list`, `skill_load`)
4. Task-specific skill packs
5. Chrome Web Store listing assets
6. Updated documentation for all channels

### Validation Status
| Requirement | Validated Against | Status |
|-------------|------------------|--------|
| CLI pattern | jarvis-mcp, oh-my-opencode | Aligned |
| OpenCode config | Official docs, real plugins | Aligned |
| Chrome Web Store | Developer policies 2024-2025 | No conflicts |
| NPM best practices | npm documentation | Aligned |

---

## PART A: CLI INSTALLER (jarvis-mcp Pattern)

### CLI Command Reference

```bash
# Interactive (prompts for location)
npx opendevbrowser

# Non-interactive with flags
npx opendevbrowser --global          # Install to ~/.config/opencode/opencode.json
npx opendevbrowser --local           # Install to ./opencode.json

# Maintenance commands
npx opendevbrowser --update          # Clear cache, trigger reinstall
npx opendevbrowser --uninstall       # Remove from config

# Info commands
npx opendevbrowser --help            # Show usage
npx opendevbrowser --version         # Show version

# Optional flags
npx opendevbrowser --with-config     # Also create opendevbrowser.jsonc
npx opendevbrowser --no-prompt       # Skip prompts, use defaults (global)
```

### Config Output Format

```jsonc
// ~/.config/opencode/opencode.json (global)
// OR ./opencode.json (local)
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opendevbrowser"]
}
```

---

### Task 1 — Create CLI Entry Point and Package Configuration

#### Reasoning
Users need a simple `npx opendevbrowser` command following the jarvis-mcp pattern. OpenCode auto-installs npm plugins via Bun, so the CLI only needs to modify config files.

#### What to do
Create CLI entry point with proper package.json bin configuration.

#### How
1. Create `src/cli/index.ts` with shebang `#!/usr/bin/env node`
2. Add to package.json:
   ```json
   {
     "bin": {
       "opendevbrowser": "./dist/cli/index.js"
     }
   }
   ```
3. Add dependency: `@inquirer/prompts` for interactive mode
4. Parse flags: `--global`, `--local`, `--update`, `--uninstall`, `--help`, `--version`, `--with-config`, `--no-prompt`

#### Files impacted
- `src/cli/index.ts` (new file)
- `package.json` (add bin, add @inquirer/prompts)
- `tsconfig.json` (ensure cli included in build)

#### End goal
`npx opendevbrowser --help` works and shows usage.

#### Acceptance criteria
- [ ] `npx opendevbrowser` launches CLI
- [ ] `--help` shows all commands and flags
- [ ] `--version` shows package version
- [ ] Shebang present: `#!/usr/bin/env node`
- [ ] Exit codes correct (0 success, 1 error)

---

### Task 2 — Implement Flag Parsing and Mode Selection

#### Reasoning
Following jarvis-mcp pattern: `--local` for project, `--global` for user-wide installation. Interactive prompt only when no flag provided.

#### What to do
Parse command-line flags and determine installation mode.

#### How
1. Create `src/cli/args.ts` for argument parsing
2. Support flags:
   - `--global` / `-g`: Install to `~/.config/opencode/opencode.json`
   - `--local` / `-l`: Install to `./opencode.json`
   - `--update` / `-u`: Update plugin
   - `--uninstall`: Remove plugin
   - `--with-config`: Also create `opendevbrowser.jsonc`
   - `--no-prompt`: Skip interactive prompts
3. If no mode flag: prompt user with single question
4. Use `@inquirer/prompts` select() for interactive mode

#### Files impacted
- `src/cli/args.ts` (new file)
- `src/cli/index.ts`

#### End goal
CLI correctly routes to global/local installation based on flag or prompt.

#### Acceptance criteria
- [ ] `--global` skips prompt, installs globally
- [ ] `--local` skips prompt, installs locally
- [ ] No flag prompts: "Install globally or in this project?"
- [ ] `--no-prompt` defaults to global without asking
- [ ] Invalid flags show error + help

---

### Task 3 — Implement Global Installation Logic

#### Reasoning
Global installation modifies `~/.config/opencode/opencode.json` to add plugin to array. Must preserve existing config and include schema.

#### What to do
Create function to handle global installation.

#### How
1. Create `src/cli/installers/global.ts`
2. Determine config path: `~/.config/opencode/opencode.json`
3. Create directory if missing: `~/.config/opencode/`
4. Read existing config or create new with schema
5. Parse as JSONC (handle comments)
6. Add `"opendevbrowser"` to plugin array if not present
7. Write back with proper formatting
8. Print success message with next steps

#### Files impacted
- `src/cli/installers/global.ts` (new file)
- `src/cli/index.ts`

#### End goal
`npx opendevbrowser --global` correctly updates global config.

#### Acceptance criteria
- [ ] Creates `~/.config/opencode/` if missing
- [ ] Creates `opencode.json` with `$schema` if missing
- [ ] Adds plugin to existing array without duplicates
- [ ] Preserves existing plugins and config keys
- [ ] Handles JSONC (comments preserved)
- [ ] Reports success: "Added opendevbrowser to global config"

---

### Task 4 — Implement Local (Project) Installation Logic

#### Reasoning
Local installation modifies `./opencode.json` in current directory, following jarvis-mcp `--local` flag pattern.

#### What to do
Create function to handle local/project installation.

#### How
1. Create `src/cli/installers/local.ts`
2. Determine config path: `./opencode.json`
3. Read existing config or create new with schema
4. Parse as JSONC
5. Add `"opendevbrowser"` to plugin array if not present
6. Write back with proper formatting
7. Print success message

#### Files impacted
- `src/cli/installers/local.ts` (new file)
- `src/cli/index.ts`

#### End goal
`npx opendevbrowser --local` correctly updates project config.

#### Acceptance criteria
- [ ] Creates `./opencode.json` with `$schema` if missing
- [ ] Adds plugin to existing array without duplicates
- [ ] Preserves existing plugins and config keys
- [ ] Works in any directory
- [ ] Reports success: "Added opendevbrowser to project config"

---

### Task 5 — Implement Plugin Config Creation (Optional)

#### Reasoning
Users may want a starter `opendevbrowser.jsonc` with documented options. This is optional via `--with-config` flag.

#### What to do
Create plugin config file with sensible defaults when requested.

#### How
1. Create `src/cli/templates/config.ts` with default config template
2. If `--with-config` flag present:
   - Global: create `~/.config/opencode/opendevbrowser.jsonc`
   - Local: create `./opendevbrowser.jsonc`
3. Include comments documenting each option
4. Use JSONC format

#### Files impacted
- `src/cli/templates/config.ts` (new file)
- `src/cli/installers/global.ts`
- `src/cli/installers/local.ts`

#### End goal
`npx opendevbrowser --global --with-config` creates both files.

#### Acceptance criteria
- [ ] Config created at correct location
- [ ] All options documented with comments
- [ ] Defaults are sensible (headless: false, etc.)
- [ ] Valid JSONC that parses correctly
- [ ] Only created when `--with-config` specified

---

### Task 6 — Implement Update Command

#### Reasoning
Users need a way to update plugin version. OpenCode caches npm packages in `~/.cache/opencode/node_modules/`.

#### What to do
Add `--update` flag that clears cache to trigger reinstall.

#### How
1. Create `src/cli/commands/update.ts`
2. Delete `~/.cache/opencode/node_modules/opendevbrowser/`
3. Optionally clear entire cache if package not found
4. Print message: "Cache cleared. OpenCode will install latest version on next run."

#### Files impacted
- `src/cli/commands/update.ts` (new file)
- `src/cli/index.ts`

#### End goal
`npx opendevbrowser --update` clears cache for reinstall.

#### Acceptance criteria
- [ ] `--update` flag recognized
- [ ] Clears cached plugin files
- [ ] Handles case where cache doesn't exist
- [ ] Reports success with instructions

---

### Task 7 — Implement Uninstall Command

#### Reasoning
Users should be able to cleanly remove the plugin from config.

#### What to do
Add `--uninstall` flag to remove plugin from config.

#### How
1. Create `src/cli/commands/uninstall.ts`
2. Check both global and local configs
3. If both exist: prompt which to remove (or `--global`/`--local` to specify)
4. Remove `"opendevbrowser"` from plugin array
5. Optionally remove `opendevbrowser.jsonc` (prompt first)
6. Optionally clear cache

#### Files impacted
- `src/cli/commands/uninstall.ts` (new file)
- `src/cli/index.ts`

#### End goal
`npx opendevbrowser --uninstall` removes plugin cleanly.

#### Acceptance criteria
- [ ] `--uninstall` flag recognized
- [ ] Removes from plugin array
- [ ] Combines with `--global`/`--local` to specify which
- [ ] Prompts before deleting config file
- [ ] Reports success

---

### Task 8 — Implement Shared Utilities

#### Reasoning
Both installers need common functions for config reading/writing.

#### What to do
Create shared utilities for config manipulation.

#### How
1. Create `src/cli/utils/config.ts` with:
   - `readConfig(path)`: Read and parse JSONC config
   - `writeConfig(path, config)`: Write config with formatting
   - `addPlugin(config, name)`: Add plugin to array if not present
   - `removePlugin(config, name)`: Remove plugin from array
   - `ensureDir(path)`: Create directory if missing
2. Use `jsonc-parser` (already a dependency) for JSONC handling

#### Files impacted
- `src/cli/utils/config.ts` (new file)

#### End goal
Shared utilities prevent code duplication.

#### Acceptance criteria
- [ ] JSONC parsing preserves comments
- [ ] Config writing maintains formatting
- [ ] Plugin array manipulation is idempotent
- [ ] Directory creation is safe

---

### Task 9 — Add CLI Tests

#### Reasoning
CLI functionality needs comprehensive test coverage.

#### What to do
Create tests for CLI commands and installers.

#### How
1. Create `tests/cli/` directory
2. Test argument parsing in `tests/cli/args.test.ts`
3. Test installers in `tests/cli/installers.test.ts`
4. Test config utilities in `tests/cli/utils.test.ts`
5. Use temp directories for isolation
6. Mock fs operations where needed

#### Files impacted
- `tests/cli/args.test.ts` (new file)
- `tests/cli/installers.test.ts` (new file)
- `tests/cli/utils.test.ts` (new file)

#### End goal
CLI has comprehensive test coverage.

#### Acceptance criteria
- [ ] Argument parsing tested (all flags)
- [ ] Global installer tested (create, update, idempotent)
- [ ] Local installer tested (create, update, idempotent)
- [ ] Config utilities tested
- [ ] Error cases tested
- [ ] Coverage maintained at 95%+

---

## PART B: SKILL SYSTEM EXTENSION

### Task 10 — Add SkillInfo Type and Skill Metadata Parsing

#### Reasoning
Skills need metadata (name, description, version) for listing and validation. Currently metadata is in SKILL.md frontmatter but not parsed programmatically.

#### What to do
Create SkillInfo type and add metadata parsing to SkillLoader.

#### How
1. Create `src/skills/types.ts`:
   ```typescript
   export interface SkillInfo {
     name: string;
     description: string;
     version: string;
     path: string;
   }
   ```
2. Add `parseSkillMetadata(skillPath: string): SkillInfo` to SkillLoader
3. Parse YAML frontmatter using regex or simple parser
4. Validate required fields: name, description

#### Files impacted
- `src/skills/types.ts` (new file)
- `src/skills/skill-loader.ts`

#### End goal
Skills have typed metadata that can be listed and validated.

#### Acceptance criteria
- [ ] SkillInfo type exported
- [ ] `parseSkillMetadata(path)` returns SkillInfo
- [ ] Throws on missing required fields
- [ ] Unit tests for metadata parsing

---

### Task 11 — Extend SkillLoader with Multi-Skill Discovery

#### Reasoning
Current SkillLoader hardcodes single skill path. Need to discover all skills in `skills/` directory and optional user-defined paths.

#### What to do
Add `listSkills()` and `loadSkill(name, topic?)` methods to SkillLoader.

#### How
1. Add private `discoverSkills(): SkillInfo[]` that scans skill directories
2. Add public `listSkills(): SkillInfo[]` that returns discovered skills
3. Add public `loadSkill(name: string, topic?: string): string` that loads named skill
4. Keep `loadBestPractices(topic?)` for backward compatibility - delegates to `loadSkill('opendevbrowser-best-practices', topic)`
5. Cache discovered skills for performance

#### Files impacted
- `src/skills/skill-loader.ts`
- `src/skills/types.ts`

#### End goal
SkillLoader can discover, list, and load any skill by name.

#### Acceptance criteria
- [ ] `listSkills()` returns array of SkillInfo
- [ ] `loadSkill('skill-name')` loads named skill
- [ ] `loadSkill('skill-name', 'topic')` filters by topic
- [ ] `loadBestPractices()` still works (backward compat)
- [ ] Throws descriptive error for unknown skill
- [ ] Skills cached after first discovery

---

### Task 12 — Add User-Defined Skill Paths to Config

#### Reasoning
Users should be able to add custom skills without modifying the plugin.

#### What to do
Add `skillPaths` array to config schema and pass to SkillLoader.

#### How
1. Add to `configSchema` in `src/config.ts`:
   ```typescript
   skillPaths: z.array(z.string()).optional().default([])
   ```
2. Update SkillLoader constructor to accept optional additional paths
3. Update `src/index.ts` to pass `config.skillPaths` to SkillLoader
4. Default paths: `['~/.config/opencode/opendevbrowser-skills']`
5. Expand `~` to home directory

#### Files impacted
- `src/config.ts`
- `src/skills/skill-loader.ts`
- `src/index.ts`
- `tests/config.test.ts`

#### End goal
Users can configure custom skill directories in opendevbrowser.jsonc.

#### Acceptance criteria
- [ ] Config accepts `skillPaths: ["/path/to/skills"]`
- [ ] SkillLoader scans all configured paths
- [ ] Invalid paths logged as warning, not error
- [ ] `~` expanded to home directory

---

### Task 13 — Create opendevbrowser_skill_list Tool

#### Reasoning
Agents need to discover available skills before loading them.

#### What to do
Create new tool that lists all available skills with metadata.

#### How
1. Create `src/tools/skill_list.ts` following `prompting_guide.ts` pattern:
   ```typescript
   export function createSkillListTool(deps: ToolDeps): ToolDefinition {
     return {
       name: 'opendevbrowser_skill_list',
       description: 'List available browser automation skills',
       parameters: z.object({}),
       handler: async () => {
         const skills = deps.skills.listSkills();
         return ok({ skills });
       }
     };
   }
   ```
2. Register in `src/tools/index.ts`

#### Files impacted
- `src/tools/skill_list.ts` (new file)
- `src/tools/index.ts`

#### End goal
Agent can call `opendevbrowser_skill_list` to see available skills.

#### Acceptance criteria
- [ ] Tool returns array of `{ name, description, version }`
- [ ] Empty array if no skills found (not error)
- [ ] Registered as `opendevbrowser_skill_list`
- [ ] Has appropriate tool description

---

### Task 14 — Create opendevbrowser_skill_load Tool

#### Reasoning
Agents need to load specific skills by name, not just the default best-practices.

#### What to do
Create new tool that loads a named skill with optional topic filtering.

#### How
1. Create `src/tools/skill_load.ts`:
   ```typescript
   export function createSkillLoadTool(deps: ToolDeps): ToolDefinition {
     return {
       name: 'opendevbrowser_skill_load',
       description: 'Load a specific browser automation skill by name',
       parameters: z.object({
         name: z.string().describe('Name of the skill to load'),
         topic: z.string().optional().describe('Optional topic to filter')
       }),
       handler: async (args) => {
         const skill = deps.skills.loadSkill(args.name, args.topic);
         return ok({ skill });
       }
     };
   }
   ```
2. Register in `src/tools/index.ts`

#### Files impacted
- `src/tools/skill_load.ts` (new file)
- `src/tools/index.ts`

#### End goal
Agent can load any skill by name with `opendevbrowser_skill_load`.

#### Acceptance criteria
- [ ] Tool loads named skill
- [ ] Topic filtering works
- [ ] Returns descriptive error for unknown skill
- [ ] Registered as `opendevbrowser_skill_load`

---

### Task 15 — Create Task-Specific Skill Packs

#### Reasoning
Different automation tasks need specialized guidance.

#### What to do
Create 3 task-specific skill packs following existing SKILL.md format.

#### How
1. Create `skills/login-automation/SKILL.md`:
   - Credential handling best practices
   - Form detection workflow
   - Error handling for auth failures
   
2. Create `skills/form-testing/SKILL.md`:
   - Form field discovery
   - Validation testing
   - Submit and verify patterns
   
3. Create `skills/data-extraction/SKILL.md`:
   - Table extraction patterns
   - Pagination handling
   - Data export workflows

4. Follow OpenCode naming: lowercase, hyphens, <=64 chars

#### Files impacted
- `skills/login-automation/SKILL.md` (new)
- `skills/form-testing/SKILL.md` (new)
- `skills/data-extraction/SKILL.md` (new)

#### End goal
Plugin ships with 4 skills total.

#### Acceptance criteria
- [ ] Each skill has valid YAML frontmatter (name, description, version)
- [ ] Names follow OpenCode convention (lowercase, hyphens)
- [ ] Each skill has workflow sections
- [ ] Each skill references appropriate opendevbrowser_* tools
- [ ] `listSkills()` returns all 4 skills

---

### Task 16 — Update Skill Loader Tests

#### Reasoning
New functionality needs comprehensive test coverage.

#### What to do
Add tests for all new SkillLoader methods.

#### How
1. Add tests for `listSkills()`:
   - Empty skills directory
   - Single skill
   - Multiple skills
   - Invalid skill (missing frontmatter)
   
2. Add tests for `loadSkill(name, topic)`:
   - Valid skill name
   - Invalid skill name
   - Topic filtering
   
3. Add tests for custom paths:
   - Valid path
   - Invalid path (warning, not error)
   - Multiple paths

4. Add tests for metadata parsing

#### Files impacted
- `tests/skill-loader.test.ts`

#### End goal
95%+ coverage for skill system.

#### Acceptance criteria
- [ ] All new methods tested
- [ ] Edge cases covered
- [ ] 95%+ coverage maintained

---

## PART C: CHROME WEB STORE SUBMISSION

### Task 17 — Create Chrome Web Store Graphic Assets

#### Reasoning
Chrome Web Store requires specific graphic assets for listing.

#### What to do
Create all required assets per Chrome guidelines.

#### How
1. Create `extension/store-assets/` directory
2. Create 128x128 store icon (PNG, square corners, no padding)
3. Create 1-5 screenshots (1280x800, PNG):
   - Screenshot 1: Extension popup showing connection status
   - Screenshot 2: Connected state with target info
   - Screenshot 3: Settings/relay configuration
4. Create 440x280 small promo tile (required)
5. Optional: 1400x560 marquee tile

#### Files impacted
- `extension/store-assets/` (new directory)
- `extension/store-assets/icon-store-128.png` (new)
- `extension/store-assets/screenshot-1.png` (new)
- `extension/store-assets/screenshot-2.png` (new)
- `extension/store-assets/promo-small-440x280.png` (new)

#### End goal
All required assets ready for Web Store submission.

#### Acceptance criteria
- [ ] 128x128 icon exists (PNG, square corners)
- [ ] At least 2 screenshots (1280x800)
- [ ] 440x280 promo tile exists
- [ ] Assets demonstrate actual extension UX
- [ ] No blur, distortion, or excessive text

---

### Task 18 — Prepare Chrome Web Store Listing Content

#### Reasoning
Listing needs optimized title, summary, and description for discoverability without keyword stuffing (causes rejection).

#### What to do
Create listing content document with all required fields.

#### How
1. Create `extension/store-assets/LISTING.md`:
   ```markdown
   # Chrome Web Store Listing
   
   ## Title (<=45 chars)
   OpenDevBrowser Relay
   
   ## Summary (<=132 chars)
   Connect OpenCode AI to your browser for automated testing and web development workflows.
   
   ## Description
   [Overview paragraph]
   [Feature bullets]
   [Permission justifications]
   
   ## Category
   Developer Tools
   
   ## Language
   English
   ```
2. No keyword stuffing
3. Justify each permission clearly

#### Files impacted
- `extension/store-assets/LISTING.md` (new file)

#### End goal
Ready-to-paste content for Web Store dashboard.

#### Acceptance criteria
- [ ] Title <=45 chars, clear and unique
- [ ] Summary <=132 chars, highlights core value
- [ ] Description has overview + feature bullets
- [ ] Each permission justified (debugger, tabs, storage)
- [ ] No keyword stuffing

---

### Task 19 — Validate Privacy Policy for Chrome Web Store

#### Reasoning
Chrome requires privacy policy, especially with debugger permission which triggers manual review.

#### What to do
Review and update `docs/privacy.md` for Chrome Web Store compliance.

#### How
1. Verify all 7 disclosure categories:
   - What data collected (relay settings, tab metadata)
   - How data used (local relay only)
   - Data retention (session only, not persisted)
   - Third-party sharing (none)
   - User rights (access, delete)
   - Security measures (token auth, localhost binding)
   - Contact info
2. Add explicit debugger permission justification
3. Ensure last-updated date is current
4. Verify hosted at accessible URL

#### Files impacted
- `docs/privacy.md`

#### End goal
Privacy policy meets Chrome Web Store requirements.

#### Acceptance criteria
- [ ] All 7 disclosure categories covered
- [ ] Debugger permission explicitly justified
- [ ] Last-updated date current
- [ ] Hosted at publicly accessible URL

---

### Task 20 — Validate Manifest for Web Store Review

#### Reasoning
debugger + tabs permissions trigger manual review (3-7 extra days). Ensure minimal permissions.

#### What to do
Review manifest.json for minimal permissions and review readiness.

#### How
1. Verify current permissions are minimal:
   - `debugger`: Required for CDP access
   - `tabs`: Required for target listing
   - `storage`: Required for relay settings
2. Verify host_permissions limited: `127.0.0.1/*`, `localhost/*`
3. Verify all icon sizes exist: 16, 32, 48, 128
4. Verify version matches package.json
5. Add `version_name` for display if desired

#### Files impacted
- `extension/manifest.json`
- `extension/icons/*` (verify all sizes)

#### End goal
Manifest optimized for smooth review process.

#### Acceptance criteria
- [ ] No unnecessary permissions
- [ ] host_permissions: localhost/127.0.0.1 only
- [ ] All icon sizes present (16, 32, 48, 128)
- [ ] Version matches package.json
- [ ] Manifest validates against MV3 schema

---

## PART D: NPM REGISTRY OPTIMIZATION

### Task 21 — Optimize package.json for NPM

#### Reasoning
NPM listing needs proper metadata for discoverability and trust.

#### What to do
Review and optimize package.json for NPM best practices.

#### How
1. Verify required fields present:
   ```json
   {
     "name": "opendevbrowser",
     "version": "0.2.0",
     "description": "OpenCode plugin for browser automation via CDP",
     "keywords": ["opencode", "plugin", "browser", "automation", "cdp", "playwright", "testing"],
     "license": "MIT",
     "author": "...",
     "repository": {
       "type": "git",
       "url": "..."
     }
   }
   ```
2. Add bin entry for CLI
3. Verify files whitelist includes cli:
   ```json
   {
     "files": ["dist", "skills", "extension/dist", "extension/icons"]
   }
   ```
4. Add engines if needed: `"engines": { "node": ">=18" }`

#### Files impacted
- `package.json`

#### End goal
Package.json optimized for NPM registry.

#### Acceptance criteria
- [ ] All required fields present
- [ ] Keywords include: opencode, plugin, browser, automation, cdp
- [ ] License specified (MIT)
- [ ] Repository URL correct
- [ ] bin entry for CLI
- [ ] files whitelist correct

---

### Task 22 — Enhance README for NPM and CLI

#### Reasoning
README is the NPM landing page. Needs badges and CLI documentation.

#### What to do
Add badges and document CLI installation prominently.

#### How
1. Add shields.io badges at top:
   - npm version
   - license
   - CI status (if applicable)
2. Add prominent CLI installation section:
   ```markdown
   ## Quick Install
   
   ```bash
   # Interactive installation
   npx opendevbrowser
   
   # Or specify location
   npx opendevbrowser --global   # User-wide
   npx opendevbrowser --local    # This project only
   ```
3. Document all CLI flags
4. Link to full documentation

#### Files impacted
- `README.md`

#### End goal
README compelling for NPM visitors with clear CLI docs.

#### Acceptance criteria
- [ ] Version badge present
- [ ] License badge present
- [ ] CLI installation prominent (first install option)
- [ ] All CLI flags documented
- [ ] Quick-start example present

---

## PART E: DOCUMENTATION AND FINALIZATION

### Task 23 — Update AGENTS.md for Skill System

#### Reasoning
Agent guidelines need skill system documentation.

#### What to do
Update AGENTS.md files with skill patterns.

#### How
1. Add to root `AGENTS.md`:
   - Skill system overview
   - How to create custom skills
   - Skill format specification
   
2. Update `skills/AGENTS.md`:
   - Document each bundled skill
   - Explain skill discovery
   - Note OpenCode naming conventions

#### Files impacted
- `AGENTS.md`
- `skills/AGENTS.md`

#### End goal
Agent documentation covers skill system.

#### Acceptance criteria
- [ ] Skill format documented
- [ ] Discovery mechanism documented
- [ ] User customization documented
- [ ] OpenCode naming conventions noted

---

### Task 24 — Create CLI Documentation

#### Reasoning
CLI needs dedicated documentation for reference.

#### What to do
Create comprehensive CLI usage documentation.

#### How
1. Create `docs/CLI.md`:
   ```markdown
   # OpenDevBrowser CLI
   
   ## Installation
   
   ## Commands
   
   ### Install (default)
   ### Update
   ### Uninstall
   
   ## Flags
   
   ## Examples
   
   ## Troubleshooting
   ```
2. Include examples for each use case
3. Add troubleshooting section
4. Link from README

#### Files impacted
- `docs/CLI.md` (new file)
- `README.md` (add link)

#### End goal
Comprehensive CLI documentation.

#### Acceptance criteria
- [ ] All commands documented
- [ ] All flags documented
- [ ] Examples for each use case
- [ ] Troubleshooting section
- [ ] Linked from README

---

### Task 25 — Validate OpenCode Skill Format Alignment

#### Reasoning
Skills should follow OpenCode naming conventions for familiarity.

#### What to do
Validate all skill formats match OpenCode patterns.

#### How
1. Verify skill names:
   - Lowercase only
   - Hyphens for separators
   - 1-64 characters
   - Match directory name
   
2. Verify descriptions:
   - 1-1024 characters
   - Clear and descriptive
   
3. Update any non-conforming skills
4. Document format in skills/AGENTS.md

#### Files impacted
- `skills/*/SKILL.md` (all)
- `skills/AGENTS.md`

#### End goal
Skills follow OpenCode conventions.

#### Acceptance criteria
- [ ] All skill names valid (lowercase, hyphens, <=64 chars)
- [ ] All skill names match directory names
- [ ] All descriptions <=1024 chars
- [ ] Format documented in skills/AGENTS.md

---

### Task 26 — Final Integration Testing

#### Reasoning
All components need end-to-end validation.

#### What to do
Run full validation suite.

#### How
1. Run `npm run lint` - fix any errors
2. Run `npm run build` - verify clean build
3. Run `npm run test` - verify 95%+ coverage
4. Test CLI manually:
   - `npx . --help` (local testing)
   - `npx . --global --with-config`
   - `npx . --local`
   - `npx . --update`
   - `npx . --uninstall`
5. Test skill loading:
   - List skills
   - Load each skill
   - Topic filtering

#### Files impacted
- None (validation only)

#### End goal
All components work together correctly.

#### Acceptance criteria
- [ ] Lint passes with no errors
- [ ] Build completes successfully
- [ ] All tests pass
- [ ] Coverage >=95%
- [ ] CLI installs correctly (both modes)
- [ ] Skills load correctly
- [ ] Extension builds correctly

---

## File-by-File Implementation Sequence

| Order | File | Tasks |
|-------|------|-------|
| 1 | `package.json` | 1, 21 (add bin, deps, metadata) |
| 2 | `src/cli/args.ts` | 2 (new - arg parsing) |
| 3 | `src/cli/utils/config.ts` | 8 (new - config utilities) |
| 4 | `src/cli/installers/global.ts` | 3 (new - global installer) |
| 5 | `src/cli/installers/local.ts` | 4 (new - local installer) |
| 6 | `src/cli/templates/config.ts` | 5 (new - config template) |
| 7 | `src/cli/commands/update.ts` | 6 (new - update command) |
| 8 | `src/cli/commands/uninstall.ts` | 7 (new - uninstall command) |
| 9 | `src/cli/index.ts` | 1, 2 (new - CLI entry) |
| 10 | `src/skills/types.ts` | 10 (new - SkillInfo type) |
| 11 | `src/skills/skill-loader.ts` | 10, 11, 12 (extend) |
| 12 | `src/config.ts` | 12 (add skillPaths) |
| 13 | `src/index.ts` | 12 (pass skillPaths) |
| 14 | `src/tools/skill_list.ts` | 13 (new tool) |
| 15 | `src/tools/skill_load.ts` | 14 (new tool) |
| 16 | `src/tools/index.ts` | 13, 14 (register tools) |
| 17 | `skills/login-automation/SKILL.md` | 15 (new skill) |
| 18 | `skills/form-testing/SKILL.md` | 15 (new skill) |
| 19 | `skills/data-extraction/SKILL.md` | 15 (new skill) |
| 20 | `tests/cli/args.test.ts` | 9 (new tests) |
| 21 | `tests/cli/installers.test.ts` | 9 (new tests) |
| 22 | `tests/cli/utils.test.ts` | 9 (new tests) |
| 23 | `tests/skill-loader.test.ts` | 16 (extend tests) |
| 24 | `extension/store-assets/*` | 17, 18 (new assets) |
| 25 | `docs/privacy.md` | 19 (update) |
| 26 | `extension/manifest.json` | 20 (validate) |
| 27 | `README.md` | 22 (update) |
| 28 | `AGENTS.md` | 23 (update) |
| 29 | `skills/AGENTS.md` | 23, 25 (update) |
| 30 | `docs/CLI.md` | 24 (new doc) |

---

## Dependencies to Add

| Package | Version | Purpose |
|---------|---------|---------|
| `@inquirer/prompts` | `^7.0.0` | Interactive CLI prompts |

**Note:** `jsonc-parser` already exists as dependency.

---

## Compliance Checklist

### OpenCode Plugin Alignment
- [x] Config format: `{"plugin": ["opendevbrowser"]}`
- [x] Schema included: `"$schema": "https://opencode.ai/config.json"`
- [x] Global path: `~/.config/opencode/opencode.json`
- [x] Local path: `./opencode.json`
- [x] CLI pattern: `--local`/`--global` flags (jarvis-mcp)
- [x] Auto-install: OpenCode handles npm install via Bun
- [x] Skill names: lowercase, hyphens, <=64 chars

### Chrome Web Store
- [ ] Manifest V3 (already compliant)
- [ ] 128x128 store icon
- [ ] 1+ screenshots (1280x800)
- [ ] 440x280 promo tile
- [ ] Privacy policy URL
- [ ] Permission justifications
- [ ] No eval(), no remote code (already compliant)
- [ ] debugger permission justified

### NPM Registry
- [ ] name, version, description (exists)
- [ ] keywords, license, repository
- [ ] bin entry for CLI
- [ ] files whitelist
- [ ] README with badges and CLI docs

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-12-28 | Initial plan |
| 2.0 | 2025-12-28 | Validated against OpenCode patterns, adopted jarvis-mcp CLI pattern, renamed --project to --local, simplified interactive flow |

---

## Summary

This plan covers **26 tasks** across 5 major areas:

| Part | Focus | Tasks |
|------|-------|-------|
| **A** | CLI Installer (jarvis-mcp pattern) | 9 tasks |
| **B** | Skill System Extension | 7 tasks |
| **C** | Chrome Web Store | 4 tasks |
| **D** | NPM Registry | 2 tasks |
| **E** | Documentation | 4 tasks |

**Key Validations:**
- CLI follows jarvis-mcp pattern (`--local`/`--global`)
- OpenCode config format aligned
- Chrome Web Store policies - no conflicts
- NPM best practices followed
- Skill format follows OpenCode conventions
