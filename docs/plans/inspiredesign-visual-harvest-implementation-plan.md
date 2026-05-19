# InspireDesign Visual Harvest Implementation Plan

## Context

Source materials:
- `/Users/bishopdotun/Downloads/inspiredesign-visual-harvest-implementation-plan.md`
- `docs/investigations/design-prototyping-workflow-2026-05-18.md`

Goal: add `opendevbrowser inspiredesign harvest` as an extension of the existing `inspiredesign` workflow, not as a new top-level workflow. The harvest path must add bounded discovery, path-based screenshot evidence, deterministic ranked references, visual-first artifacts, a `meta-prompt.md`, and motion-design handoff while preserving existing `inspiredesign run` behavior unless visual evidence is explicitly enabled.

Key invariants:
- Keep daemon method `inspiredesign.run`.
- Do not bypass provider policy for `policy_blocked`, unresolved `auth_required`, `challenge_detected`, or `rate_limited`.
- Do not store base64 images, temp paths, full DOM, or full snapshot text in JSON.
- Store screenshots as artifact files and JSON as metadata-only paths, hashes, viewport, provenance, and warnings.
- Keep production code generation out of harvest output.

## Task 1 - Shared Visual Harvest Model

Reasoning: visual evidence, policy decisions, and discovery diagnostics need small pure helpers before workflow wiring.
What to do: add shared types and deterministic helpers for visual evidence, visual policy, and reference discovery.
How:
1. Add `src/inspiredesign/visual-evidence.ts` with runtime and persisted metadata types plus serialization helpers.
2. Add `src/inspiredesign/visual-policy.ts` with deterministic allow or skip decisions from fetch issues and cookie policy.
3. Add `src/inspiredesign/reference-discovery.ts` to normalize provider search results, reject invalid candidates, and de-dupe URLs.
Files impacted: `src/inspiredesign/visual-evidence.ts` (new), `src/inspiredesign/visual-policy.ts` (new), `src/inspiredesign/reference-discovery.ts` (new), focused tests.
Acceptance criteria:
- [ ] Helpers compile with strict TypeScript.
- [ ] Unit tests cover policy blockers, auth rules, invalid URLs, duplicates, and metadata redaction.
- [ ] No helper depends on browser manager internals.

## Task 2 - CLI And Tool Inputs

Reasoning: users need a first-class `harvest` entrypoint while existing `run` calls remain stable.
What to do: extend the CLI and direct tool schema with harvest and visual-evidence inputs.
How:
1. Update `src/cli/commands/inspiredesign.ts` to accept `run` and `harvest`.
2. Parse `--query`, repeatable `--provider`, `--max-references`, and `--visual-evidence`.
3. Keep dispatch to daemon method `inspiredesign.run`.
4. Update `src/tools/inspiredesign_run.ts` with matching optional fields.
Files impacted: `src/cli/commands/inspiredesign.ts`, `src/tools/inspiredesign_run.ts`, `tests/cli-workflows.test.ts`, `tests/tools-workflows.test.ts`.
Acceptance criteria:
- [ ] `run` defaults remain `mode=compact` and visual evidence `off`.
- [ ] `harvest` defaults to `mode=path`, visual evidence `required`, and `maxReferences=5`.
- [ ] Invalid `--query` on `run`, provider without query, bad max reference count, and bad visual mode produce usage errors.

## Task 3 - Workflow Normalization And Discovery

Reasoning: URL-backed capture and query-backed discovery must converge into one deterministic reference list.
What to do: extend workflow input normalization and add bounded provider search discovery.
How:
1. Extend `InspiredesignRunInput` and resolved input in `src/providers/workflows.ts`.
2. Trim and de-dupe URLs and providers while preserving first occurrence.
3. Call optional `runtime.search` once when `query` is present.
4. Merge explicit and discovered URLs, truncate to `maxReferences`, and expose discovery diagnostics.
Files impacted: `src/providers/workflows.ts`, `src/inspiredesign/reference-discovery.ts`, workflow tests.
Acceptance criteria:
- [ ] Explicit URLs always sort before discovered URLs.
- [ ] Missing search capability produces an actionable follow-up constraint, not a crash.
- [ ] Provider-specific scraping, infinite scroll, and private endpoints are not introduced.

## Task 4 - Visual Capture

Reasoning: screenshot evidence must reuse the existing browser screenshot primitive while preserving current snapshot, clone, and DOM capture.
What to do: add optional screenshot capture to the existing deep-capture session.
How:
1. Extend `InspiredesignCaptureManagerLike` with optional `screenshot`.
2. Extend capture options with visual evidence metadata and temp artifact paths.
3. Capture viewport and full-page PNGs after existing text capture and before disconnect.
4. Return failures as visual metadata while preserving text capture attempts.
Files impacted: `src/inspiredesign/capture.ts`, `src/inspiredesign/visual-evidence.ts`, `tests/providers-inspiredesign-capture.test.ts`.
Acceptance criteria:
- [ ] Screenshot unavailable is skipped in `auto` mode and failed in `required` mode.
- [ ] Screenshot failures do not suppress snapshot, clone, DOM, or disconnect.
- [ ] Returned persisted metadata never includes base64.

## Task 5 - Artifact Collation

Reasoning: PNG files, hashes, byte counts, and metadata must be finalized before packet rendering and bundle creation.
What to do: wire visual policy, temp files, hash enrichment, and PNG artifact files into `runInspiredesignWorkflow`.
How:
1. Create a run-scoped temp directory only when visual evidence is enabled.
2. Apply visual policy before browser visual capture.
3. Finalize runtime temp PNGs into `ArtifactFile[]` buffers, hashes, and artifact-relative metadata.
4. Clean temp files in `finally`.
Files impacted: `src/providers/workflows.ts`, `src/inspiredesign/visual-policy.ts`, `src/inspiredesign/visual-evidence.ts`, workflow tests.
Acceptance criteria:
- [ ] PNG artifacts are written under `visual-evidence/<referenceId>/`.
- [ ] JSON references artifact-relative paths and hashes only.
- [ ] Policy-blocked, unresolved auth, challenge, and rate-limit references do not fall back to browser screenshots.

## Task 6 - Ranked References And Meta Prompt

Reasoning: harvest is useful only if it turns references into ranked, transferable design guidance.
What to do: extend the reference pattern board, packet, evidence serialization, and meta-prompt output.
How:
1. Add deterministic rank, score, confidence, visual strengths, visual risks, selection reason, and rejected references in `src/inspiredesign/reference-pattern-board.ts`.
2. Add `src/inspiredesign/meta-prompt.ts`.
3. Extend `InspiredesignPacket` and evidence JSON in `src/inspiredesign/contract.ts`.
4. Keep old artifact names and fields stable.
Files impacted: `src/inspiredesign/reference-pattern-board.ts`, `src/inspiredesign/meta-prompt.ts` (new), `src/inspiredesign/contract.ts`, contract tests.
Acceptance criteria:
- [ ] `dominantDirection` uses rank 1, not source order.
- [ ] Ranking ties are deterministic.
- [ ] `meta-prompt.md` includes ranked references, borrow/reject guidance, motion posture, accessibility constraints, no-copying warning, and validation gates.

## Task 7 - Renderer, Handoff, Help, And Public Surface

Reasoning: generated artifacts and first-contact guidance must match runtime behavior.
What to do: emit new files and align runtime handoff, provider handoff, generated help, docs, and public surface metadata.
How:
1. Update `src/inspiredesign/handoff.ts` with new files and `opendevbrowser-motion-design`.
2. Update `src/providers/renderer.ts` to emit `visual-evidence.json`, `screenshot-index.json`, `ranked-references.json`, and `meta-prompt.md`.
3. Update `src/providers/workflow-handoff.ts`, `src/cli/help.ts`, and `src/public-surface/source.ts`.
4. Update docs and skill artifacts that consume harvest output.
Files impacted: `src/inspiredesign/handoff.ts`, `src/providers/renderer.ts`, `src/providers/workflow-handoff.ts`, `src/cli/help.ts`, `src/public-surface/source.ts`, `docs/CLI.md`, `docs/SURFACE_REFERENCE.md`, `docs/ARCHITECTURE.md`, `skills/opendevbrowser-design-agent/artifacts/research-harvest-workflow.md`, `skills/opendevbrowser-design-agent/assets/templates/reference-pattern-board.v1.json`, `skills/opendevbrowser-motion-design/SKILL.md`, `skills/opendevbrowser-best-practices/**`, help and surface tests.
Acceptance criteria:
- [ ] Runtime handoff recommends best-practices, design-agent, and motion-design.
- [ ] Help includes harvest and visual/meta/motion follow-through.
- [ ] Docs state policy boundaries and metadata-only JSON rules.

## Task 8 - Validation And Regression Gates

Reasoning: the change touches CLI, tools, workflow runtime, artifacts, docs, and skills.
What to do: run focused tests first, fix regressions, then run full quality gates.
How:
1. Run inspiredesign capture, contract, workflow, CLI, tool, help, and public-surface tests.
2. Run skill validators for touched skill packs.
3. Run formatter or diff check, lint, typecheck, build, coverage, and full tests.
4. Inspect one generated harvest artifact bundle for PNG files and metadata-only JSON.
Files impacted: tests and generated artifacts only unless fixes are needed.
Acceptance criteria:
- [ ] Focused inspiredesign tests pass.
- [ ] `npm run lint`, `npm run typecheck`, `npm run build`, and `npm run test` pass.
- [ ] Skill asset validators pass for touched skills.
- [ ] Bundle inspection confirms no base64 image blobs or temp paths in JSON.
