# Pinterest Pin Media P0-P2 Fix Loop - 2026-05-30

## Task 1 - Omit Diagnostic Media Files
Reasoning: Diagnostic pin-media bytes must not be bundled as evidence artifacts.
What to do: Return pin-media artifact files only for finalized `design_evidence` media.
How:
1. Inspect workflow finalization return shape.
2. Keep diagnostic persisted metadata on the reference.
3. Omit `ArtifactFile` for non-authoritative finalized evidence.
Files impacted: `src/providers/workflows.ts`, `tests/providers-inspiredesign-workflow.test.ts`.
Acceptance criteria:
- [ ] Diagnostic pin-media finalization keeps `pinMediaIndex` empty.
- [ ] Diagnostic media paths are absent from bundle manifests and filesystem output.

## Task 2 - Bound Media Fetch Reads
Reasoning: First-party media responses can be large enough to spike memory if buffered before checking size.
What to do: Enforce a named fetch byte ceiling before and during response body reads.
How:
1. Add a named maximum Pinterest media byte constant.
2. Reject oversized `Content-Length` headers before reading.
3. Read response streams incrementally and abort once the accumulated byte count exceeds the limit.
Files impacted: `src/browser/browser-manager.ts`, `tests/browser-manager.test.ts`.
Acceptance criteria:
- [ ] Oversized `Content-Length` fails without writing output.
- [ ] Chunked responses exceeding the limit fail without writing output.

## Task 3 - Refuse Symlink Output Targets
Reasoning: The browser primitive accepts an output path and must not follow symlink destinations.
What to do: Write captured bytes through a no-follow exclusive file open.
How:
1. Replace direct `writeFile` for pin-media output with a helper using `O_NOFOLLOW`, `O_CREAT`, `O_EXCL`, and mode `0600`.
2. Ensure failure returns a diagnostic capture error without partial success.
3. Add a symlink regression.
Files impacted: `src/browser/browser-manager.ts`, `tests/browser-manager.test.ts`.
Acceptance criteria:
- [ ] Existing symlink output targets are rejected.
- [ ] No bytes are written through the symlink target.

## Task 4 - Verify And Real Workflow
Reasoning: Unit regressions are necessary but the requested proof is a real Pinterest harvest with design insight.
What to do: Run focused tests, type/lint/build gates, contained review, then a real Pinterest harvest workflow.
How:
1. Run focused browser and workflow test files.
2. Run typecheck, lint, and build.
3. Repeat contained review for the patched scope.
4. Run `inspiredesign harvest` against Pinterest with real browser workflow settings and inspect output artifacts.
Files impacted: none.
Acceptance criteria:
- [ ] Focused tests pass.
- [ ] Static quality gates pass or any unrelated known blocker is reported.
- [ ] Real harvest completes and produces artifact-backed design insight.
