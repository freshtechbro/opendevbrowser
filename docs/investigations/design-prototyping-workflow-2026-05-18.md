# Investigation: Design Prototyping Workflow

## Summary
OpenDevBrowser should add this as an `inspiredesign` extension, preferably `opendevbrowser inspiredesign harvest`, not as a new top-level workflow. The recommended approach is artifact-first: policy-gated discovery, path-based screenshot evidence, deterministic ranking, extracted transferable design qualities, a `meta-prompt.md`, and handoff through best-practices, design-agent, and motion-design before any component implementation.

## Symptoms
- Agents creating frontend prototypes can overfit to residual training data rather than fresh visual references.
- The proposed workflow needs external design inspiration, ranked screenshots, qualities extraction, and a meta-prompt that feeds design, motion, and best-practices skills.
- Pinterest looks attractive because logged-in browser state can expose a large visual corpus, but provider policy, cookie handling, visual evidence, ranking, and artifact provenance need investigation.

## Background / Prior Research
- Market scan: current AI prototyping tools are converging on iterative design loops rather than one-shot code generation. Relevant options include Figma Make and First Draft, v0, Lovable, Framer AI, Uizard, Google Stitch, Relume, Builder.io Visual Copilot, Locofy, and Anima. Common patterns are prompt-to-prototype, screenshot or Figma-to-code, component mapping, design-system constraints, deployment, and visual review loops. Sources gathered by external research: [Figma Make](https://www.figma.com/blog/introducing-figma-make/), [Figma First Draft](https://help.figma.com/hc/en-us/articles/23955143044247-Use-First-Draft-with-Figma-AI), [v0 docs](https://v0.app/docs), [Lovable docs](https://docs.lovable.dev/introduction/welcome), [Uizard](https://uizard.io/), [Google Stitch](https://blog.google/innovation-and-ai/models-and-research/google-labs/stitch-ai-ui-design/), [Relume docs](https://resources.relume.io/resources/docs/building-a-sitemap-with-ai), [Builder.io Visual Copilot](https://www.builder.io/blog/visual-copilot), [Locofy](https://www.locofy.ai/convert/figma-to-nextjs), and [Anima Figma-to-code docs](https://support.animaapp.com/en/articles/11721866-anima-figma-plugin-design-to-code-in-figma).
- Open-source and research signals: screenshot-to-code work commonly uses render, compare, and refine loops rather than trusting first-pass code. External research noted [screenshot-to-page](https://github.com/Mrxyy/screenshot-to-page), [tailwind-screenshot-to-code](https://github.com/otherlibrary/tailwind-screenshot-to-code), [WebSight](https://arxiv.org/abs/2403.09029), and [VisRefiner](https://arxiv.org/abs/2602.05998). Practical lesson: OpenDevBrowser should make browser-rendered validation and screenshot comparison part of the workflow, not a later optional QA step.
- Image-to-code workflow research: the strongest systems use staged loops: collect references, normalize/crop/annotate, extract structured signals, synthesize a design contract, generate constrained code, render in browser, compare visually, and iterate. Sources gathered by external research include [Vercel v0 screenshot workflow](https://vercel.com/docs/v0/workflows/screenshot), [Builder.io Generate Code](https://site.builder.io/c/docs/generate-code), [Figma Dev Mode MCP](https://developers.figma.com/docs/figma-mcp-server), [Figma Make docs](https://www.figma.com/code-docs/intro-to-figma-make/), [abi/screenshot-to-code](https://github.com/abi/screenshot-to-code), [Design2Code](https://arxiv.org/abs/2403.03163), [OpenAI image input docs](https://developers.openai.com/api/docs/guides/images-vision), [Playwright visual comparisons](https://playwright.dev/docs/test-snapshots), and [Storybook visual tests](https://storybook.js.org/docs/writing-tests/visual-testing).
- Pinterest feasibility: official Pinterest Developer Guidelines prohibit automated scraping or data extraction unless expressly permitted, while API v5 supports authenticated boards/pins workflows under explicit scopes, access tiers, and rate limits. Sources: [Pinterest Developer Guidelines](https://policy.pinterest.com/en/developer-guidelines), [Pinterest boards and pins API docs](https://developer.pinterest.com/docs/work-with-organic-content-and-users/create-boards-and-pins/), [Pinterest access tiers](https://developers.pinterest.com/docs/key-concepts/access-tiers/), [Pinterest rate limits](https://developers.pinterest.com/docs/reference/rate-limits/), and [Pinterest sandbox](https://developers.pinterest.com/docs/developer-tools/sandbox/).
- Dribbble feasibility: official API access is OAuth-based, rate-limited, and centered on authenticated-user resources. External research found the API is not a strong general inspiration search source, and Dribbble Terms restrict scraping and automated access beyond normal browser use. Sources: [Dribbble API v2](https://developer.dribbble.com/v2/), [Dribbble Shots API](https://developer.dribbble.com/v2/shots/), and [Dribbble Terms](https://dribbble.com/terms).
- OpenDevBrowser research CLI attempt: `npx opendevbrowser research run --topic "AI design prototyping Pinterest Dribbble inspiration image to code workflows" --days 365 --sources web,community --browser-mode managed --mode json --output-dir .opendevbrowser/research/design-prototyping-investigation --timeout-ms 120000 --output-format json` failed with `Daemon on 127.0.0.1:8788 pid=42446 is protected by a different opendevbrowser build. Start with opendevbrowser serve.` This is an environment blocker, not research evidence.

## Investigator Findings

### 2026-05-18 In-workspace verification

#### 1. Current inspiredesign CLI and workflow pipeline

**Evidence:**
- `inspiredesign` is registered as a lazy CLI command in `src/cli/index.ts:826-829`, and the direct tool path is exposed by `src/tools/inspiredesign_run.ts:20-66`.
- CLI input already has the expected workflow controls: `brief`, repeatable `urls`, `captureMode`, prototype guidance, render mode, output location, TTL, browser mode, cookie use, challenge automation mode, and cookie policy override in `src/cli/commands/inspiredesign.ts:16-29`.
- Flag parsing covers `--brief`, repeatable `--url`, `--capture-mode`, `--include-prototype-guidance`, `--mode`, `--timeout-ms`, `--output-dir`, `--ttl-hours`, `--browser-mode`, `--use-cookies`, `--challenge-automation-mode`, and `--cookie-policy[-override]` in `src/cli/commands/inspiredesign.ts:47-197`; run validation and daemon dispatch happen in `src/cli/commands/inspiredesign.ts:203-232`.
- The workflow fetches each URL, runs deep capture when enabled, builds a design packet, renders output, and writes an artifact bundle in `src/providers/workflows.ts:3296-3388`.
- The handoff bundle is already centralized around `design.md`, `advanced-brief.md`, `design-contract.json`, `canvas-plan.request.json`, `design-agent-handoff.json`, `generation-plan.json`, implementation plans, `evidence.json`, and optional `prototype-guidance.md` in `src/inspiredesign/handoff.ts:1-11`.
- Handoff next steps already route through the advanced brief, Canvas plan request, `canvas.plan.set`, and governance patching in `src/inspiredesign/handoff.ts:233-241`.

**Conclusion:** `inspiredesign` is the correct integration seam. It already owns the CLI, tool, daemon workflow, artifact bundle, Canvas handoff, and downstream design-agent routing.

#### 2. Capture primitives and screenshot persistence

**Evidence:**
- The generic browser screenshot primitive supports optional `path`, `ref`, and `fullPage`; when `path` is provided it persists a PNG, otherwise it returns base64 in memory in `src/browser/browser-manager.ts:2004-2058`.
- Browser replay already persists visual evidence. The screencast recorder defaults output to `.opendevbrowser/replays/screencasts/<session>/<screencastId>` in `src/browser/screencast-recorder.ts:104-119`, names `frames/`, `replay.json`, `replay.html`, and `preview.png` in `src/browser/screencast-recorder.ts:52-58`, captures frame PNGs in `src/browser/screencast-recorder.ts:335-356`, and writes the manifest/replay result in `src/browser/screencast-recorder.ts:399-430`.
- Inspiredesign deep capture does not use screenshot or screencast. Its manager capability set is `launch`, cookies, navigation, `snapshot`, `clonePage`, `disconnect`, and optional `clonePageHtmlWithOptions` in `src/inspiredesign/capture.ts:15-66`.
- The current inspiredesign capture evidence schema is text, DOM, and clone-preview based: title, snapshot content/ref count/warnings, DOM HTML/truncation, clone component/CSS previews/warnings, and attempts in `src/inspiredesign/contract.ts:93-114`.
- Deep capture records snapshot, clone, and DOM attempts in `src/inspiredesign/capture.ts:244-380`, then launches a headless managed session, imports configured cookies when allowed, navigates, waits, captures, and disconnects in `src/inspiredesign/capture.ts:382-468`.
- Artifact bundles can store strings, JSON records, or buffers in `src/providers/artifacts.ts:10-14`, but inspiredesign renderer currently passes only Markdown and JSON handoff files in `src/providers/renderer.ts:746-764`.
- The persisted `evidence.json` intentionally redacts capture payloads to title, derived signals, and attempts in `src/inspiredesign/contract.ts:2049-2062`.

**Conclusion:** Screenshot persistence exists in the browser layer and browser replay, but inspiredesign does not yet persist first-class visual reference evidence. A new integration should reuse the browser screenshot/path artifact primitive rather than inventing storage.

#### 3. Reference pattern-board and ranking gaps

**Evidence:**
- The current pattern-board model contains reference id/name/url, surface type, capture methods, layout recipe, content hierarchy, component families, motion posture, token notes, borrow/reject patterns, and rationale in `src/inspiredesign/reference-pattern-board.ts:27-48`.
- Reference signals are derived from title, excerpt, snapshot text, clone preview/CSS text, and DOM text in `src/inspiredesign/reference-pattern-board.ts:183-193`.
- Usability is determined by clean text evidence, not visual evidence, in `src/inspiredesign/reference-pattern-board.ts:195-221`.
- Entries are generated from textual patterns and the first clean signal in `src/inspiredesign/reference-pattern-board.ts:341-374`.
- Board construction filters usable references, preserves source order, computes shared strengths from the flattened borrow patterns, and sets `dominantDirection` from `entries[0]` in `src/inspiredesign/reference-pattern-board.ts:381-397`.

**Conclusion:** There is a real gap for a reference pattern board with visual evidence, thumbnails, viewport metadata, visual scores, confidence, provenance, and ranking. Today the board is useful but text-first and order-preserving.

#### 4. Cookie, policy, and anti-bot seams

**Evidence:**
- Inspiredesign exposes `--use-cookies`, `--challenge-automation-mode`, `--cookie-policy-override`, and `--cookie-policy` in `src/cli/commands/inspiredesign.ts:154-197`, and the direct tool exposes the matching `useCookies`, `challengeAutomationMode`, and `cookiePolicyOverride` fields in `src/tools/inspiredesign_run.ts:32-54`.
- Provider runtime cookie policy precedence is override, then explicit `useCookies=false`, then config default, with `useCookies=true` upgrading config `off` to `auto` in `src/providers/runtime-policy.ts:48-63`; the resolved policy carries cookies and challenge settings in `src/providers/runtime-policy.ts:77-111`.
- Inspiredesign deep capture has a local resolver where override wins and `useCookies=false` means `off` in `src/inspiredesign/capture.ts:160-165`; required-cookie verification fails when no configured source or observable cookies exist in `src/inspiredesign/capture.ts:184-199`; configured cookies are imported and verified during capture in `src/inspiredesign/capture.ts:430-439`.
- Managed provider fallback imports configured cookies and verifies them before navigation in `src/providers/runtime-factory.ts:1215-1235`; `required` cookie policy maps missing or unverifiable cookies to `auth_required` in `src/providers/runtime-factory.ts:1238-1254`; extension fallback verifies live-session cookies and also fails `required` when none are observable in `src/providers/runtime-factory.ts:1319-1330`.
- Challenge automation is resolved by run, then session, then config in `src/challenges/policy-gate.ts:61-73`; helper mode is blocked for `off`, blocked for `browser`, and only eligible when policy enables the optional bridge in `src/challenges/policy-gate.ts:78-103`; browser-native challenge actions are gated by config in `src/challenges/policy-gate.ts:120-139`.
- Web provider policy can deny domains, require allow lists, and enforce robots blocked domains in strict, warn, or off mode in `src/providers/web/policy.ts:1-76`.
- Anti-bot policy defaults to enabled, 30 second cooldown, one challenge retry, and no browser escalation in `src/providers/shared/anti-bot-policy.ts:56-61`; cooldown and escalation reason sets include auth, token, challenge, rate limit, and IP block cases in `src/providers/shared/anti-bot-policy.ts:63-73`; preflight and postflight enforce cooldown, retry, and escalation metadata in `src/providers/shared/anti-bot-policy.ts:104-180`.

**Conclusion:** The safest workflow is public-first URL capture with explicit policy gates. Authenticated inspiration should be opt-in through existing cookie policy and extension/session seams, and provider-specific sources such as Pinterest or Dribbble should not become scraper defaults without official API or explicit user-authorized evidence.

#### 5. Skill handoff and motion-design gap

**Evidence:**
- Runtime handoff currently defines only `opendevbrowser-best-practices "quick start"` and `opendevbrowser-design-agent "canvas-contract"` in `src/inspiredesign/handoff.ts:28-60`.
- The follow-through summary tells downstream agents to load only those two skills in `src/inspiredesign/handoff.ts:233-237`.
- The typed command examples include only `loadBestPractices`, `loadDesignAgent`, and `continueInCanvas` in `src/inspiredesign/contract.ts:424-428`, and build followthrough copies only the current command constants in `src/inspiredesign/contract.ts:1548-1554`.
- Provider success handoff suggests only the baseline runbook and Canvas contract lane before `canvas.plan.set` in `src/providers/workflow-handoff.ts:431-446`.
- Help onboarding prints only `quick`, `design`, `brief`, `prep`, and `run` details for `inspiredesign_followthrough` in `src/cli/help.ts:307-316`.
- The motion-design skill exists and explicitly says to load best-practices, design-agent, then motion-design in `skills/opendevbrowser-motion-design/SKILL.md:24-37`; design-agent also points to motion authority and instructs agents to load motion-design for motion-heavy work in `skills/opendevbrowser-design-agent/SKILL.md:35-37` and `skills/opendevbrowser-design-agent/SKILL.md:76-81`.
- Docs are ahead of runtime: `docs/CLI.md:546-548` already says to add `opendevbrowser_skill_load opendevbrowser-motion-design "quick start"` when motion, scroll choreography, gesture motion, reduced motion, or temporal proof is part of the design.

**Conclusion:** The reported motion-design handoff gap is true. Runtime handoff, CLI help, and tests lag behind the skill/docs guidance.

#### 6. Tests and docs likely needing update

**Evidence:**
- Current workflow tests assert the two-skill recommended set in `tests/providers-inspiredesign-workflow.test.ts:348-351`.
- Contract tests assert command examples without motion-design in `tests/providers-inspiredesign-contract.test.ts:338-342`.
- CLI help tests assert the `inspiredesign_followthrough` details without a motion entry and only check best-practices/design-agent command output in `tests/cli-help.test.ts:90-98` and `tests/cli-help.test.ts:136-139`.
- Existing docs already describe inspiredesign flags, artifact outputs, handoff flow, cookie policy, and challenge precedence in `docs/CLI.md:520-569`; they will need synchronization if runtime output, artifact files, visual evidence, ranking fields, or motion handoff change.

**Conclusion:** Implementation must update tests with the runtime change, not weaken them. Add new coverage for visual evidence artifacts and ranking once implemented.

### Recommended implementation shape

1. Keep `inspiredesign` as the entry point. Add an optional visual-evidence stage after deep capture and before `buildInspiredesignPacket` in `src/providers/workflows.ts`, so existing fetch/capture/pattern synthesis remains intact.
2. Extend `InspiredesignCaptureEvidence` and artifact rendering with a separate first-class visual evidence model: screenshot path, thumbnail path, viewport/device metadata, capture timestamp, page title/url, warnings, image hash if needed, and provenance. Store image assets through the existing artifact bundle mechanism, likely under a `visual-evidence/` subdirectory.
3. Evolve `referencePatternBoard` from text-only entries to ranked evidence entries. Add explicit `rank`, `score`, `confidence`, `visualStrengths`, `visualRisks`, and `selectionReason`, while preserving current textual fields for backward readability.
4. Add policy gates before visual evidence capture. Default to public-first URLs. Require explicit `--use-cookies` or `--cookie-policy required` for authenticated references, surface `auth_required` cleanly, and preserve robots/legal warnings in evidence metadata.
5. Add `opendevbrowser-motion-design "quick start"` to runtime handoff when motion-relevant cues exist, or include it unconditionally as an optional recommended skill with clear conditional wording matching `docs/CLI.md:546-548`.
6. Update tests in the inspiredesign workflow, contract, CLI help, daemon/CLI plumbing, and capture suites. Add regression tests that a URL-backed run persists visual evidence metadata and that ranked pattern-board output is deterministic.
7. Update docs in `docs/CLI.md`, `docs/SURFACE_REFERENCE.md`, `docs/ARCHITECTURE.md`, and the relevant skill artifacts/templates so the public surface, runtime handoff, and design-agent workflow stay aligned.

## Investigation Log

### Phase 0 - Workspace Verification
**Hypothesis:** RepoPrompt is bound to the OpenDevBrowser codebase and the investigation starts from a clean worktree.
**Findings:** RepoPrompt bound successfully to `/Users/bishopdotun/Documents/DevProjects/opendevbrowser`; git status was clean on `codex/motion-design-skill-oracle-export`.
**Evidence:** `mcp__RepoPrompt__bind_context` and `mcp__RepoPrompt__git status`.
**Conclusion:** Confirmed.

### Phase 1.5 - External Market and Provider Research
**Hypothesis:** Existing tools and policies can identify a safer, higher-leverage workflow than building a direct Pinterest scraper.
**Findings:** Market tools emphasize constrained generation, component mapping, Figma/screenshot ingestion, iterative editing, and render validation. Pinterest and Dribbble should not be treated as broad scraping providers; the safer lane is bounded user-visible screenshot evidence, with official API evidence only under explicit credentials and scopes.
**Evidence:** External research agents `642B6D0B-0AC2-4A04-9EC1-3D62E0C505EB` and `B7B6E84F-B4C2-4744-B600-4E8AA3CF01CB`; links listed under Background / Prior Research.
**Conclusion:** Confirmed.

## Root Cause
`inspiredesign` already has the correct workflow spine for reference-driven design artifacts, but it is still text/DOM centered. It can fetch references, run deep capture, generate design contracts, produce Canvas handoff artifacts, and render an artifact bundle, but it does not persist first-class screenshot evidence, rank visual references, or synthesize a dedicated meta-prompt from visual inspiration.

The user problem is therefore not missing generic browser automation. The gap is a missing visual-inspiration layer inside the existing `inspiredesign` pipeline:
- Provider policy is not specialized for Pinterest/Dribbble-style visual inspiration.
- Deep capture does not store screenshot artifacts even though browser screenshot and screencast primitives exist.
- The reference pattern board is text-first and source-order preserving rather than visual, scored, and ranked.
- Runtime handoff omits `opendevbrowser-motion-design` even though design docs and the motion skill already expect it for motion-heavy work.

## Recommendations
1. Extend `inspiredesign` rather than adding a new top-level workflow. Add a `harvest` subcommand or mode for bounded discovery and visual evidence, while preserving `inspiredesign run --url` for explicit references.
2. Treat Pinterest and Dribbble as policy-restricted visual evidence providers. Default to user-supplied URLs and bounded user-visible screenshots. Use official API evidence only with explicit credentials and scopes. Block broad scraping, infinite-scroll harvesting, private endpoint reverse engineering, and unsafe fallback from `policy_blocked`.
3. Add first-class visual artifacts. Store PNG screenshots under the artifact bundle, and keep JSON path-based with refs, hashes, viewport metadata, source URL, timestamp, warnings, and provenance. Do not embed base64 image blobs in JSON.
4. Extend reference ranking in `src/inspiredesign/reference-pattern-board.ts`. Score by brief fit, visual distinctiveness, evidence completeness, transferability, and policy confidence. Reject login walls, JavaScript shells, challenge pages, missing required screenshots, and policy-blocked sources.
5. Emit a `meta-prompt.md` artifact that combines top ranked references, extracted qualities, borrow/reject guidance, motion posture, accessibility constraints, implementation constraints, and a no-copying-assets warning.
6. Update handoff routing to include `opendevbrowser-motion-design "quick start"` alongside best-practices and design-agent, either unconditionally as a recommended skill or conditionally when motion cues are present.
7. Keep production code generation out of the harvest step. The harvest output should feed Canvas, design-agent, and later implementation after review, render, accessibility, lint, type, and test gates.

Recommended implementation sequence if this becomes a build task:
1. Write a formal plan under `docs/plans/` defining visual evidence, ranked reference, provider policy, and artifact schemas.
2. Update `src/cli/commands/inspiredesign.ts` and `src/providers/workflows.ts` for `harvest` inputs, provider/query controls, screenshot options, and output serialization.
3. Add a focused visual inspiration policy module tied into cookie, challenge, anti-bot, and provider failure handling.
4. Extend `src/inspiredesign/capture.ts` to call `BrowserManagerLike.screenshot` and persist screenshot files by artifact path.
5. Extend `src/inspiredesign/reference-pattern-board.ts` with deterministic ranking, confidence, provenance, visual strengths, visual risks, and selection reasons.
6. Extend `src/inspiredesign/contract.ts`, `src/inspiredesign/handoff.ts`, and `src/providers/renderer.ts` to emit `visual-evidence.json`, `ranked-references.json`, `screenshot-index.json`, and `meta-prompt.md`.
7. Add motion-design skill routing in runtime handoff, CLI help, docs, and tests.
8. Add regression tests for policy-blocked providers, auth-required capture, screenshot refs, no base64 JSON, deterministic ranking, JavaScript-shell rejection, motion-design handoff, and no unsafe scraping fallback.
9. Update `docs/CLI.md`, `docs/SURFACE_REFERENCE.md`, architecture docs, `skills/opendevbrowser-design-agent/artifacts/research-harvest-workflow.md`, `skills/opendevbrowser-design-agent/assets/templates/reference-pattern-board.v1.json`, and `skills/opendevbrowser-best-practices/artifacts/provider-workflows.md`.

## Preventive Measures
- Keep visual inspiration as transformed design guidance, not copied assets or layouts.
- Require explicit provenance for every visual reference: retrieval path, URL, timestamp, viewport, policy status, and capture confidence.
- Stop on `policy_blocked`, `auth_required`, or `challenge_detected` rather than escalating to scraping.
- Keep screenshots in artifact files and JSON as references only.
- Validate generated prototypes with browser rendering, screenshot comparison, accessibility snapshots, and human review before source edits.
- Keep design-system tokens authoritative; inferred screenshot tokens should be advisory and confidence-labeled.
