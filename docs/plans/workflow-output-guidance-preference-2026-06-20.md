# Workflow Output Guidance Preference: Plan

## Goal

Align workflow output guidance so agents prefer the existing omitted-output default, with Inspiredesign CLI artifacts landing under `<cwd>/.opendevbrowser/inspiredesign/<runId>`. Preserve intentional explicit external roots for temp, release, debug, and adjacent evidence lanes, but stop teaching routine workflow runs to use `/tmp` or custom `artifacts/...` roots.

## Scope And Non-goals

- Scope is guidance alignment, public-surface examples, skill examples, and regression tests.
- Do not rewrite the runtime default path policy. `src/providers/workflow-output-root.ts`, `src/cli/commands/workflow-output.ts`, and `src/tools/workflow-output.ts` already implement the desired omitted-output behavior.
- Do not remove caller-controlled explicit output roots. The change is to make preferred placement clear, not to block intentional external roots.
- Do not collapse non-workflow lanes into workflow bundle policy. Screenshot, screencast, Canvas, annotation, desktop audit, release proof, and cleanup examples keep their own output rules.

## Background

- The established runtime default is `.opendevbrowser`, not a temp directory. `src/providers/workflow-output-root.ts:3` defines `WORKFLOW_ARTIFACT_DIRECTORY = ".opendevbrowser"`, and `src/providers/workflow-output-root.ts:9-20` resolves omitted workflow output roots to `workspaceRoot/.opendevbrowser` or `process.cwd()/.opendevbrowser`, while preserving explicit nonblank roots.
- CLI commands resolve output before daemon dispatch. `src/cli/commands/workflow-output.ts:5-13` defaults omitted `--output-dir` to `.opendevbrowser`, rejects blank values, and resolves relative paths from invocation cwd. `src/cli/commands/inspiredesign.ts:207-214` parses explicit `--output-dir`, and `src/cli/commands/inspiredesign.ts:348-356` sends `outputDir: resolveWorkflowOutputDirFlag(parsed.outputDir)` to `inspiredesign.run`.
- Daemon and tool calls already prefer workspace-root omitted output. `src/cli/daemon-commands.ts:76-79` resolves omitted daemon roots through `core.workspaceRoot`; `src/cli/daemon-commands.ts:897-912` applies that to `inspiredesign.run`. `src/tools/workflow-output.ts:4-15` preserves explicit tool output roots, but omitted roots use `deps.workspaceRoot/.opendevbrowser` when available.
- Artifact bundling appends the workflow namespace and run id. `src/providers/workflows.ts:6189-6196` resolves the Inspiredesign artifact root before execution; `src/providers/workflows.ts:6537-6549` calls `createArtifactBundle({ namespace: "inspiredesign", outputDir: artifactRoot })`; `src/providers/artifacts.ts:104-127` writes to `<outputDir>/<namespace>/<runId>`.
- Tests lock the current runtime contract. `tests/cli-workflows.test.ts:38` defines `defaultWorkflowOutputDir = resolve(".opendevbrowser")`; `tests/cli-workflows.test.ts:116-139` checks omitted CLI workflow output; `tests/cli-workflows.test.ts:145-171` checks explicit relative roots are preserved and resolved before daemon dispatch. `tests/daemon-commands.integration.test.ts:2220-2235` verifies omitted daemon Inspiredesign output uses `core.workspaceRoot/.opendevbrowser`. `tests/tools-workflows.test.ts:199-214` verifies omitted direct Inspiredesign tool output lands in `<workspaceRoot>/.opendevbrowser/inspiredesign/<runId>`.
- v0.0.30 established the broader output-storage contract. `docs/RELEASE_0.0.30_EVIDENCE.md:26-29` records omitted CLI workflow outputs as `<cli cwd>/.opendevbrowser/<workflow>/<uuid>`, daemon and OpenCode direct tools using workspace root, and explicit `outputDir` preservation. `docs/RELEASE_0.0.30_EVIDENCE.md:76-80` records live validation of those paths.
- Current docs contain the correct omitted-output contract, but also normalize custom roots. `docs/CLI.md:618` describes omitted roots as `<invocation-or-workspace-root>/.opendevbrowser/<namespace>/<runId>` and says direct callers can still pass explicit output directories. `docs/SURFACE_REFERENCE.md:568-570` repeats the same split across workflow bundle and browser evidence lanes.
- Agent-facing examples still encourage nonpreferred explicit roots. `docs/CLI.md:526` shows product-video with `--output-dir /tmp/product-video`; `docs/CLI.md:558` shows Inspiredesign with `--output-dir /tmp/inspiredesign`; `src/public-surface/source.ts:734` carries the Inspiredesign temp-root example into generated manifests; `skills/opendevbrowser-best-practices/SKILL.md:152` and `skills/opendevbrowser-best-practices/scripts/odb-workflow.sh:45` show Pinterest harvest with `--output-dir "artifacts/pinterest-harvest/<pin-id>"`.
- Public-surface generated files should not be edited by hand. `src/public-surface/source.ts` is the source for `src/public-surface/generated-manifest.ts` and `src/public-surface/generated-manifest.json`; docs guidance in `docs/AGENTS.md` requires updating source surfaces and generated artifacts together when mirrored public docs change.
- Adjacent lanes remain intentionally different. `docs/ARCHITECTURE.md:371-386` distinguishes workflow bundles from Canvas, screenshot, screencast, annotation, desktop audit, and release proof lanes. Those lanes should not be collapsed into the workflow bundle policy.

## Output Preference Contract

- Routine workflow runs should omit `--output-dir`.
- If an agent or wrapper must pass an explicit workflow root, it should prefer `--output-dir .opendevbrowser`.
- The workflow namespace is appended by the runtime. For Inspiredesign, `--output-dir .opendevbrowser` produces `.opendevbrowser/inspiredesign/<runId>`, not `.opendevbrowser/inspiredesign/inspiredesign/<runId>`.
- External roots remain valid only when intentional, such as temp cleanup roots, release proof outputs, debug or audit evidence, screenshot paths, and screencast replay directories.

## Approach

Keep runtime behavior untouched and make the preference dominant across every agent-facing surface. The implementation should first update source-of-truth docs and public-surface source, then regenerate generated manifests, then update skill guidance and helper script examples, then add focused tests that fail if routine workflow examples drift back to `/tmp` or custom `artifacts/...` roots. Tests must also protect intentional exceptions so the fix does not erase legitimate external-output lanes.

## Work Items

## Task 1 - Align Public Docs

Reasoning: `docs/CLI.md` and `docs/SURFACE_REFERENCE.md` currently describe omitted roots correctly, but examples still teach agents to pass explicit temp roots for normal workflow runs.

What to do: Update public docs so routine workflow examples omit `--output-dir`, and the notes explain `--output-dir .opendevbrowser` as the preferred explicit root when a flag is necessary.

How:
1. In `docs/CLI.md`, remove `--output-dir /tmp/product-video` from the routine product-video example around the product-video workflow section.
2. In `docs/CLI.md`, remove `--output-dir /tmp/inspiredesign` from the routine Inspiredesign example.
3. Strengthen the wrapper behavior output-root bullet so it leads with the preference: omit `--output-dir`; use `--output-dir .opendevbrowser` only when an explicit root is needed; use external roots only intentionally.
4. Add a short note in product-video and Inspiredesign sections that `outputDir` is a root, and the workflow appends `<namespace>/<runId>`.
5. Keep artifact cleanup wording that uses `/tmp/opendevbrowser`, but clarify it applies only to cleaning explicit temp artifact roots.
6. Update `docs/SURFACE_REFERENCE.md` so the concise workflow output note also states the preference before explicit-root preservation.
7. Treat `docs/ARCHITECTURE.md` as conditional. Edit the provider artifact storage matrix only if the current matrix cannot express the guidance preference without implying a runtime rewrite. Leave adjacent lanes unchanged.

Files impacted:
- `docs/CLI.md`
- `docs/SURFACE_REFERENCE.md`
- `docs/ARCHITECTURE.md`

End goal: User-facing docs teach the preferred root without hiding explicit override support.

Acceptance criteria:
- [ ] Routine workflow examples in `docs/CLI.md` do not use `/tmp/product-video` or `/tmp/inspiredesign`.
- [ ] `docs/CLI.md` documents `--output-dir .opendevbrowser` as the preferred explicit workflow root.
- [ ] `docs/SURFACE_REFERENCE.md` mentions preferred omitted workflow roots before caller-controlled explicit roots.
- [ ] If `docs/ARCHITECTURE.md` changes, it still separates workflow bundles from screenshot, screencast, Canvas, annotation, desktop audit, cleanup, and release proof lanes.

Done when: A reader copying docs examples gets `.opendevbrowser/<namespace>/<runId>` by default.

Dependencies: None.

Size: Medium.

## Task 2 - Align Public Surface Source And Regenerate Manifests

Reasoning: `src/public-surface/source.ts` feeds generated command/tool metadata. Editing generated manifests directly would drift from source and violate docs guidance.

What to do: Update public-surface source examples and notes, then regenerate generated manifests.

How:
1. In `src/public-surface/source.ts`, remove `--output-dir /tmp/inspiredesign` from the Inspiredesign public example.
2. Inspect both command examples and workflow tool examples in `src/public-surface/source.ts`; update every routine workflow example that still teaches a nonpreferred explicit root.
3. Add concise workflow output preference wording at the least invasive shared location in `src/public-surface/source.ts`. A reusable constant is acceptable, but not required if the current structure has a clearer existing note pattern.
4. Attach the preference wording to research, shopping, product-video, and Inspiredesign command or tool notes where those notes are represented in source.
5. Ensure the note does not apply to `artifacts cleanup`, screenshot, or screencast examples.
6. Run `node scripts/generate-public-surface-manifest.mjs`.
7. Review generated `src/public-surface/generated-manifest.ts` and `src/public-surface/generated-manifest.json` only as outputs from the generator.

Files impacted:
- `src/public-surface/source.ts`
- `src/public-surface/generated-manifest.ts`
- `src/public-surface/generated-manifest.json`
- Possibly tests that assert generated help parity.

End goal: Generated help and tool metadata stop teaching temp roots for routine workflow runs.

Acceptance criteria:
- [ ] `src/public-surface/source.ts` contains no `/tmp/inspiredesign` routine workflow example.
- [ ] Generated manifests contain the updated Inspiredesign example.
- [ ] Generated workflow tool examples are checked as well as command examples.
- [ ] Generated workflow notes include the preferred omitted output or `.opendevbrowser` explicit-root guidance.
- [ ] Cleanup and screencast examples remain intentionally explicit where appropriate.

Done when: Public-surface generation produces no diff beyond the intended guidance and example changes.

Dependencies: Task 1.

Size: Medium.

## Task 3 - Align Best-practices Skill Guidance

Reasoning: Agents often load `opendevbrowser-best-practices` before running workflows, so stale skill examples can override correct docs by habit.

What to do: Update best-practices skill text and helper script output so routine workflow commands omit `--output-dir`, while preserving explicit debug and release evidence examples.

How:
1. In `skills/opendevbrowser-best-practices/SKILL.md`, strengthen the existing omitted-output guidance near validated lanes to say routine workflow runs should omit `--output-dir`.
2. Add that `--output-dir .opendevbrowser` is preferred only when a wrapper requires an explicit root.
3. Remove `--output-dir "artifacts/pinterest-harvest/<pin-id>"` from the canonical Pinterest harvest command.
4. Add multi-pin guidance saying each omitted run returns its own `artifact_path` under `.opendevbrowser/inspiredesign/<runId>`.
5. Preserve QA replay and release proof examples, and label them as debug or release evidence lanes rather than routine workflow bundle guidance.
6. Mirror the same command and comment changes in `skills/opendevbrowser-best-practices/scripts/odb-workflow.sh`.
7. Inspect `skills/opendevbrowser-best-practices/scripts/validate-skill-assets.sh`. Update it only if it already validates exact strings that this task changes, or if an existing validation would otherwise accept stale routine workflow roots. Prefer the Vitest guidance tests in Task 4 as the primary drift gate.

Files impacted:
- `skills/opendevbrowser-best-practices/SKILL.md`
- `skills/opendevbrowser-best-practices/scripts/odb-workflow.sh`
- Possibly `skills/opendevbrowser-best-practices/scripts/validate-skill-assets.sh`, only for existing exact-string validation or stale-root checks.

End goal: The skill no longer teaches agents to create custom workflow roots for routine Inspiredesign harvests.

Acceptance criteria:
- [ ] `SKILL.md` contains no `artifacts/pinterest-harvest` routine workflow root.
- [ ] `odb-workflow.sh` contains no `artifacts/pinterest-harvest` routine workflow root.
- [ ] Both surfaces mention `artifact_path` for locating multi-pin results.
- [ ] QA replay and release proof examples remain present and scoped as exceptions.
- [ ] Skill validator behavior is either unchanged with rationale, or updated only to reflect existing ownership of exact example validation.

Done when: Skill guidance matches docs and public surface.

Dependencies: Task 1.

Size: Medium.

## Task 4 - Add Guidance Regression Tests

Reasoning: Runtime tests already lock output resolution. The missing protection is against agent-facing guidance drifting back to `/tmp` or custom workflow roots.

What to do: Add focused tests for docs, public-surface source, generated help examples, and best-practices skill guidance.

How:
1. Extend `tests/cli-help-parity.test.ts` or add a small focused test in that file to assert generated workflow command and tool examples do not contain forbidden routine workflow roots such as `/tmp/inspiredesign`, `/tmp/product-video`, or `artifacts/pinterest-harvest`.
2. Add `tests/workflow-output-guidance.test.ts` for docs and skills if keeping the parity test focused on generated metadata is cleaner.
3. In the new guidance test, extract only relevant docs sections before checking forbidden patterns, so allowed cleanup and screencast exceptions do not create false positives. Suggested boundaries: product-video workflow section from its heading to the Inspiredesign heading, Inspiredesign workflow section from its heading to the wrapper behavior or next major workflow heading, best-practices Inspiredesign examples around the design-contract synthesis section, and `print_pinterest_multi_pin_harvest_guidance` in `odb-workflow.sh`.
4. Assert preferred guidance exists: omitted workflow roots, `--output-dir .opendevbrowser`, and `artifact_path` for multi-pin Inspiredesign harvests.
5. Add an exception-preservation test that keeps intentional examples visible, including `/tmp/opendevbrowser` cleanup, `./artifacts/replay` screencast, release proof under `artifacts/release/...`, and QA replay output under `./artifacts/qa-replay`.

Files impacted:
- `tests/cli-help-parity.test.ts`
- New file: `tests/workflow-output-guidance.test.ts`
- Possibly test fixtures if current helpers require fixtures for public-surface metadata.

End goal: Future changes cannot reintroduce nonpreferred routine workflow roots without failing tests, and cannot accidentally remove documented external-root exceptions.

Acceptance criteria:
- [ ] Tests fail if generated workflow examples include `/tmp/inspiredesign`.
- [ ] Tests fail if docs or skills reintroduce `artifacts/pinterest-harvest` as routine workflow guidance.
- [ ] Tests pass while preserving cleanup, release, debug, screenshot, and screencast exception examples.
- [ ] No `any`, `ts-ignore`, lint suppressions, or broad snapshot assertions are added.

Done when: Focused tests fail before guidance fixes and pass after them.

Dependencies: Tasks 1, 2, and 3.

Size: Medium.

## Task 5 - Run Generation And Quality Gates

Reasoning: This change touches docs, generated public surface, skills, and tests. It must prove generated output is current and that guidance validators still agree.

What to do: Run focused and standard validation commands after the guidance and tests are updated.

How:
1. Run public-surface generation:
   ```bash
   node scripts/generate-public-surface-manifest.mjs
   ```
2. Run the best-practices skill validator:
   ```bash
   ./skills/opendevbrowser-best-practices/scripts/validate-skill-assets.sh
   ```
3. Run focused tests:
   ```bash
   npm run test -- tests/cli-help-parity.test.ts tests/workflow-output-guidance.test.ts
   ```
4. Run docs drift:
   ```bash
   node scripts/docs-drift-check.mjs
   ```
5. Run standard gates:
   ```bash
   npm run lint
   npm run typecheck
   npm run build
   npm run test
   ```

Files impacted:
- No new implementation files beyond tasks above.
- Generated files from Task 3 are expected to be modified.

End goal: The change is commit-ready with generated artifacts and validation aligned.

Acceptance criteria:
- [ ] Public-surface manifests are regenerated from source.
- [ ] Best-practices skill validator passes.
- [ ] Focused guidance tests pass.
- [ ] Docs drift check passes.
- [ ] Standard lint, typecheck, build, and test gates pass.

Done when: Full validation is green with no warnings or suppressions.

Dependencies: Tasks 1 through 4.

Size: Medium.

## Open Questions

- None blocking. Implementation should use the preference contract above and preserve intentional external roots.

## References

- `src/providers/workflow-output-root.ts`
- `src/cli/commands/workflow-output.ts`
- `src/cli/commands/inspiredesign.ts`
- `src/cli/daemon-commands.ts`
- `src/tools/workflow-output.ts`
- `src/tools/inspiredesign_run.ts`
- `src/providers/workflows.ts`
- `src/providers/artifacts.ts`
- `tests/cli-workflows.test.ts`
- `tests/daemon-commands.integration.test.ts`
- `tests/tools-workflows.test.ts`
- `tests/cli-help-parity.test.ts`
- `docs/CLI.md`
- `docs/SURFACE_REFERENCE.md`
- `docs/ARCHITECTURE.md`
- `src/public-surface/source.ts`
- `scripts/generate-public-surface-manifest.mjs`
- `skills/opendevbrowser-best-practices/SKILL.md`
- `skills/opendevbrowser-best-practices/scripts/odb-workflow.sh`
- `docs/RELEASE_0.0.30_EVIDENCE.md`
