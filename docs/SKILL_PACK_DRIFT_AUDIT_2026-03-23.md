# Skill Pack Drift Closure

Status: active  
Date: 2026-03-23

## Summary

The validated skill-pack drift from the March 23 audit is patched.

The fix set preserves the intentional runtime model:
- bundled fallback still runs after `skillPaths`
- loader discovery still requires `SKILL.md`
- installer still copies every bundled `skills/` directory
- runtime governance still treats the bundle as 9 canonical `opendevbrowser-*` packs plus 2 empty compatibility alias directories (`research/`, `shopping/`)

## Validated Drift Inventory

### 1. Public skill discovery docs understated loader behavior

Confirmed before patch:
- `README.md` and `docs/CLI.md` stopped the discovery order at `skillPaths`
- the runtime loader actually appends the bundled package `skills/` directory after `skillPaths`
- the docs also blurred the difference between copied directories and discoverable skills

Patched in:
- `README.md`
- `docs/CLI.md`

Result:
- both docs now state the bundled fallback explicitly
- both docs now explain the split between 11 copied directories and 9 discoverable canonical packs
- both docs now clarify that `research/` and `shopping/` remain non-discoverable compatibility aliases unless a verified migration adds `SKILL.md`

### 2. Central docs-drift governance missed three canonical packs

Confirmed before patch:
- `scripts/docs-drift-check.mjs` covered best-practices, design-agent, login, form, research, and shopping
- it did not validate `opendevbrowser-continuity-ledger`, `opendevbrowser-data-extraction`, or `opendevbrowser-product-presentation-asset`

Patched in:
- `scripts/docs-drift-check.mjs`
- `tests/docs-drift-check.test.ts`

Result:
- central docs-drift now validates all omitted canonical packs with marker-level checks
- the drift test now asserts those new checks directly

### 3. Most workflow-pack validators were structural only

Confirmed before patch:
- `opendevbrowser-data-extraction`, `opendevbrowser-form-testing`, and `opendevbrowser-login-automation` validated assets and references but did not execute workflow contracts
- `opendevbrowser-research` and `opendevbrowser-shopping` verified resolver wiring but did not execute wrapper outputs
- `opendevbrowser-product-presentation-asset` verified file presence but did not exercise `render-video-brief.sh`

Patched in:
- `skills/opendevbrowser-data-extraction/scripts/validate-skill-assets.sh`
- `skills/opendevbrowser-form-testing/scripts/validate-skill-assets.sh`
- `skills/opendevbrowser-login-automation/scripts/validate-skill-assets.sh`
- `skills/opendevbrowser-research/scripts/validate-skill-assets.sh`
- `skills/opendevbrowser-shopping/scripts/validate-skill-assets.sh`
- `skills/opendevbrowser-product-presentation-asset/scripts/validate-skill-assets.sh`
- `tests/skill-workflow-packs.test.ts`

Result:
- data-extraction now proves list, pagination, infinite-scroll, and anti-bot workflow markers
- form-testing now proves validation, multi-step, and challenge-checkpoint markers
- login-automation now proves password, challenge, and pointer workflow markers and validates `record-auth-signals.sh` against the sample fixture
- research now executes wrapper modes against a deterministic local fixture CLI and verifies bundle creation
- shopping now executes wrapper modes against a deterministic local fixture CLI and verifies normalized offers plus market-analysis output
- product-presentation-asset now runs `render-video-brief.sh` against a metadata-only fixture and verifies generated files plus evidence placeholders

### 4. Resolver needed a deterministic validator seam

Confirmed before patch:
- the shared resolver had no validator-only override hook
- research and shopping validators needed a deterministic way to run wrapper contracts without live CLI, browser, or network dependencies

Patched in:
- `skills/opendevbrowser-best-practices/scripts/resolve-odb-cli.sh`
- `skills/opendevbrowser-best-practices/scripts/validator-fixture-cli.sh`
- `skills/opendevbrowser-best-practices/scripts/validate-skill-assets.sh`
- `tests/skill-workflow-packs.test.ts`

Result:
- `ODB_CLI_VALIDATOR_OVERRIDE` now lets validators force a local fixture CLI path before repo-local, installed, PATH, or `npx` resolution
- the new fixture CLI returns deterministic `research run` and `shopping run` outputs for validator-only use
- best-practices validation now treats the helper as an internal shipped asset
- the workflow-pack test suite now proves the override takes precedence

## Scope Deliberately Not Changed

These behaviors remain intentional and were not changed:
- bundled fallback ordering in `src/skills/skill-loader.ts`
- `SKILL.md` as the discovery gate
- copy-all installer behavior in `src/cli/installers/skills.ts`
- 9-pack canonical runtime governance in the skill runtime matrix
- `opendevbrowser-continuity-ledger` staying doc-only

## Verification Commands

Focused verification used during remediation:

```bash
node scripts/docs-drift-check.mjs
npx vitest run tests/docs-drift-check.test.ts tests/skill-workflow-packs.test.ts --coverage.enabled=false
./skills/opendevbrowser-best-practices/scripts/validate-skill-assets.sh
```

Closure gates to run after the full patch set:

```bash
node scripts/docs-drift-check.mjs
./skills/opendevbrowser-best-practices/scripts/validate-skill-assets.sh
npm run lint
npm run typecheck
npm run build
npm run extension:build
npm run test
```

## Residual Status

No remaining confirmed drift from the March 23 validated inventory.

Ongoing guardrail:
- future skill-pack changes should update public docs, `scripts/docs-drift-check.mjs`, and the affected pack validator in the same patch so copied-versus-discoverable inventory and wrapper semantics cannot drift apart again.
