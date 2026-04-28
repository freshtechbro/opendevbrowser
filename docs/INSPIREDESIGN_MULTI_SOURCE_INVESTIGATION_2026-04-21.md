# Investigation: Inspiredesign Multiple Inspiration Sources

## Summary

`inspiredesign` already supports multiple inspiration URLs in the current checkout. The stronger defect is not array parsing or URL transport. The stronger defect is that protected or shell-heavy references can be treated as successful inspiration evidence after generic fetch, which makes mixed runs look broken or low quality.

## Symptoms

- User report: inspiredesign appears to fail when more than one inspiration source is provided.
- Example pair: `Pinterest.com` plus `Apple.com`.

## Investigation Log

### CLI and tool transport

**Hypothesis:** repeated `--url` values are collapsed or lost before the workflow runs.

**Findings:** repeated URLs are preserved across CLI, tool, daemon, and workflow normalization.

**Evidence:**
- [src/cli/utils/parse.ts:71](/Users/bishopdotun/Documents/DevProjects/opendevbrowser/src/cli/utils/parse.ts#L71)
- [src/cli/commands/inspiredesign.ts:40](/Users/bishopdotun/Documents/DevProjects/opendevbrowser/src/cli/commands/inspiredesign.ts#L40)
- [src/tools/inspiredesign_run.ts:15](/Users/bishopdotun/Documents/DevProjects/opendevbrowser/src/tools/inspiredesign_run.ts#L15)
- [src/cli/daemon-commands.ts:814](/Users/bishopdotun/Documents/DevProjects/opendevbrowser/src/cli/daemon-commands.ts#L814)
- [src/cli/daemon-commands.ts:1668](/Users/bishopdotun/Documents/DevProjects/opendevbrowser/src/cli/daemon-commands.ts#L1668)
- [src/providers/workflows.ts:1260](/Users/bishopdotun/Documents/DevProjects/opendevbrowser/src/providers/workflows.ts#L1260)
- [src/providers/workflows.ts:2560](/Users/bishopdotun/Documents/DevProjects/opendevbrowser/src/providers/workflows.ts#L2560)
- [tests/cli-workflows.test.ts:331](/Users/bishopdotun/Documents/DevProjects/opendevbrowser/tests/cli-workflows.test.ts#L331)

**Conclusion:** eliminated. Multiple inspiration sources are not failing because the `urls[]` array is dropped.

### Live repro in the current checkout

**Hypothesis:** the current repo fails on the reported `Apple + Pinterest` case in the normal public-first path.

**Findings:** the local checkout completed successfully for both single-source and two-source URL-backed runs once the daemon was started. In the current checkout, any supplied `--url` resolves to effective deep-capture semantics.

**Evidence:**
- `node dist/cli/index.js serve --output-format json`
- `node dist/cli/index.js inspiredesign run --brief "Design a premium consumer landing page" --url https://www.apple.com --mode json --output-dir /tmp/odb-inspiredesign-one --output-format json`
- `node dist/cli/index.js inspiredesign run --brief "Design a premium consumer landing page" --url https://www.apple.com --url https://www.pinterest.com --mode json --output-dir /tmp/odb-inspiredesign-two --output-format json`
- The two-source run returned evidence for both references and reported `reference_count=2`, `fetched_references=2`, `failed_fetches=0`.

**Conclusion:** the normal public-first multi-source lane works in this checkout, and URL-backed runs now already collect deep-capture evidence without a separate capture-mode opt-in.

### Provider and synthesis seam

**Hypothesis:** a protected source like Pinterest is being accepted too easily as usable inspiration input.

**Findings:** there is no Pinterest-specific social adapter, auto provider selection is not host-aware, the generic web fetch adapter normalizes any fetched HTML into a record, and inspiredesign currently treats any non-empty record set as a successful fetch.

**Evidence:**
- [src/providers/social/index.ts:27](/Users/bishopdotun/Documents/DevProjects/opendevbrowser/src/providers/social/index.ts#L27)
- [src/providers/policy.ts:31](/Users/bishopdotun/Documents/DevProjects/opendevbrowser/src/providers/policy.ts#L31)
- [src/providers/web/index.ts:202](/Users/bishopdotun/Documents/DevProjects/opendevbrowser/src/providers/web/index.ts#L202)
- [src/providers/workflows.ts:1431](/Users/bishopdotun/Documents/DevProjects/opendevbrowser/src/providers/workflows.ts#L1431)
- [src/providers/constraint.ts:210](/Users/bishopdotun/Documents/DevProjects/opendevbrowser/src/providers/constraint.ts#L210)

**Conclusion:** confirmed owner seam. The likely defect is reference-quality misclassification, not multi-source support.

### Deep capture seam

**Hypothesis:** deep capture adds a second failure path for protected references.

**Findings:** deep capture launches a fresh headless session per URL and only honors configured cookie sources. Active session cookies are not reused automatically.

**Evidence:**
- [src/inspiredesign/capture.ts:39](/Users/bishopdotun/Documents/DevProjects/opendevbrowser/src/inspiredesign/capture.ts#L39)
- [src/inspiredesign/capture.ts:170](/Users/bishopdotun/Documents/DevProjects/opendevbrowser/src/inspiredesign/capture.ts#L170)

**Conclusion:** secondary risk seam. It can make mixed runs degrade more sharply, but it is not the best primary explanation for the current public-first report.

**Follow-up note (2026-04-22):** URL-backed inspiredesign now intentionally treats deep capture as the default path, not an optional add-on. Cookie-source availability, session state, and deep-capture transport limits should therefore be treated as core constraints for any run that supplies `--url`, even when the primary product issue is still reference-quality classification.

## Root Cause

The best evidence-backed framing is:

1. `inspiredesign` already accepts and processes multiple URLs correctly.
2. A Pinterest URL currently falls through generic provider selection and generic web fetch.
3. The generic web fetch path can produce a normalized record from low-value shell HTML.
4. `inspiredesign` then treats any non-empty record set as `fetchStatus: "captured"`.
5. That lets unusable or weak references contaminate the design synthesis, which can make a multi-source run feel broken even though the plumbing itself worked.

## Recommendations

1. Keep CLI, tool, daemon, and workflow input contracts unchanged.
2. Harden post-fetch reference classification inside [src/providers/workflows.ts](/Users/bishopdotun/Documents/DevProjects/opendevbrowser/src/providers/workflows.ts) by reusing [src/providers/constraint.ts:210](/Users/bishopdotun/Documents/DevProjects/opendevbrowser/src/providers/constraint.ts#L210) before a reference is counted as usable inspiration evidence.
3. Add a mixed-domain regression in [tests/providers-inspiredesign-workflow.test.ts](/Users/bishopdotun/Documents/DevProjects/opendevbrowser/tests/providers-inspiredesign-workflow.test.ts) where one public reference succeeds and one protected or shell-heavy reference is downgraded rather than silently accepted.
4. Optionally improve [src/providers/renderer.ts:284](/Users/bishopdotun/Documents/DevProjects/opendevbrowser/src/providers/renderer.ts#L284) so compact output reports per-reference outcomes instead of only the total reference count.

## Preventive Measures

- Treat inspiration references as individually classifiable evidence, not all-or-nothing success.
- Exclude blocked or shell-only references from synthesis while preserving them in diagnostics.
- Keep regression coverage focused on mixed-domain partial-success cases rather than adding broader provider-routing changes first.
