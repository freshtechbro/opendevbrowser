# OpenDevBrowser Landing Page Specification

Status: Draft v4 (Option B visual-first)
Date: 2026-02-16
Priority: Landing pages (dashboard deferred)
Approved visual direction: Concept 1, Option B (Diagonal Split Hero)

---

## 1) Objective and Scope

Design and ship a complete marketing web surface for OpenDevBrowser that is:

- modern, sleek, responsive,
- visual-first (low text density),
- technically credible,
- clearly open source,
- conversion-ready for docs quickstart and GitHub release adoption.

In scope:

- full landing route map,
- page-by-page section specifications,
- Option B UI system requirements,
- metrics verification protocol,
- robust "How it Works" contract,
- public roadmap content,
- measurable acceptance criteria.

Out of scope:

- dashboard implementation details,
- backend CMS implementation,
- long-form marketing prose.

---

## 2) Detailed Search Findings: "How it Works" Validation

A detailed repository search was completed on 2026-02-16 to validate the workflow model against current implementation surfaces.

Primary validation sources:

- `docs/ARCHITECTURE.md` (runtime flow + session modes + workflow primitives)
- `README.md` (quick start model)
- `src/tools/index.ts` (current tool surface)
- `src/providers/workflows.ts` (research/shopping/product-video orchestration)
- `docs/CLI.md` (CLI command surfaces and operational flow)

Validated workflow contract for landing content:

1. Launch/connect session (`launch`, `connect`, managed/extension/cdpConnect)
2. Navigate and snapshot (`goto`, `snapshot`)
3. Act via stable refs (`click`, `type`, `select`, `press`, `scroll`)
4. Observe and debug (`console_poll`, `network_poll`, `debug_trace_snapshot`, `perf`)
5. Run packaged workflows (`research_run`, `shopping_run`, `product_video_run`)
6. Export/capture outputs (`screenshot`, `clone_page`, `clone_component`, `annotate`)
7. Verify and close (`status`, follow-up snapshots, `disconnect`)

This 7-step model replaces the old short-form "Launch -> Snapshot -> Act -> Verify" copy anywhere the section appears.

---

## 3) Resolved Decisions (Current)

1. Canonical visual direction: Option B (Diagonal Split Hero) across routes.
2. No pricing page for v1 landing IA.
3. Project positioning: open source first.
4. GitHub icon is required in top-right navigation and footer.
5. GitHub icon canonical destination:
- `https://github.com/freshtechbro/opendevbrowser/releases/latest`
6. Optional secondary GitHub text link (`README`):
- `https://github.com/freshtechbro/opendevbrowser#readme`
7. Testimonials are removed for now (all routes).
8. Metrics proof strip remains, but only with strict verification (section 9).
9. `Get Started` routes to `/docs#quickstart` site-wide.
10. CTA analytics event is simplified to `cta_click` only.
11. Mandatory anchors:
- `/docs#security`
- `/resources#changelog`
12. CTA IDs and section IDs must follow strict centralized taxonomy.
13. Canonical metrics source-of-truth file:
- `docs/LANDING_METRICS_SOURCE_OF_TRUTH.md`
14. Canonical open-source roadmap file:
- `docs/OPEN_SOURCE_ROADMAP.md`
15. Analytics `route` is always the current pathname; global CTA placement is represented via `section_id` scope `global`.

---

## 4) Site Map (Landing Pages)

Primary routes:

1. `/` - Home
2. `/product` - Product Architecture + Feature Surface
3. `/use-cases` - User-Needs Use Cases
4. `/workflows` - Workflow Modules (Research/Shopping/Product Video)
5. `/security` - Security, Reliability, Operations
6. `/open-source` - OSS Scope, Releases, Roadmap, Contribution
7. `/docs` - Docs Gateway + Quickstart
8. `/resources` - Changelog, Guides, Examples
9. `/company` - Mission, Credibility, Contact

Optional phase-2 routes:

- `/blog`
- `/partners`
- `/careers`

---

## 5) Global UX and Visual System (Option B)

### 5.1 Composition model

- Hero pattern: diagonal split (copy block left, isometric visual field right).
- Content rhythm: short visual modules over long paragraphs.
- Copy budget:
- hero headline: max 8 words,
- hero subcopy: max 16 words,
- section body blocks: max 2 lines before visual card/bullet structure.

### 5.2 Visual language

- Core style: Isometric Command Deck + glassmorphism surfaces.
- Mandatory depth cues:
- layered gradients/noise,
- elevation tokens (`glass-1|glass-2|glass-3`),
- depth shadows and light sweeps.

### 5.3 3D isometric icon strategy

Preferred sourcing order:

1. Open-source icon set first: `3dicons` (CC0)
- `https://3dicons.co/about`
- `https://github.com/realvjy/3dicons`
2. Licensed pack fallback (if coverage gaps): IconScout 3D packs
- `https://iconscout.com/3ds`
3. If icon does not exist: create custom icon in Blender and export PNG/glTF.

Asset requirements:

- maintain license provenance log,
- keep visual style unified (camera angle, lighting, saturation),
- do not mix conflicting 3D rendering styles in one viewport region.

### 5.4 Motion and scroll

- Smooth scroll baseline:
- native `scroll-behavior: smooth` minimum,
- optional enhanced smooth scroll via Lenis where performance budget allows.
- Scroll transitions:
- staggered reveal,
- depth parallax on hero/major visuals,
- no jarring transforms.
- Hover effects (cards/icons):
- slight lift,
- soft shadow bloom,
- controlled tilt on isometric tiles.

### 5.5 Layout and spacing

- 12-column desktop grid, 1-column mobile stack.
- Content max width: `1200px`.
- Long-copy max width: `72ch`.
- Section padding:
- desktop `96px`, tablet `72px`, mobile `56px`.

### 5.6 Accessibility

- Visible focus rings on all interactive elements.
- Min touch target `44x44`.
- Reduced-motion mode required.
- WCAG AA minimum contrast.

---

## 6) Global Components (Shared)

1. Top navigation
- Brand
- Product, Use Cases, Workflows, Security, Open Source, Docs, Resources
- CTA group: `Get Started`, `View Docs`
- GitHub icon button (required)
- href: `https://github.com/freshtechbro/opendevbrowser/releases/latest`

2. Proof strip
- metrics cards only (no testimonials)
- data must satisfy section 9 verification protocol

3. Footer
- product/dev/security/company/community links
- GitHub icon/link repeat
- optional README text link

4. Sticky conversion CTA
- primary: `Get Started`
- secondary: `Download Latest Release`

---

## 7) CTA and Funnel Mapping (Required)

| Placement Surface (not analytics `route`) | CTA | Destination | Funnel Stage | Event | `cta_id` | `section_id` |
|------|-------------|-------------|--------------|-------|----------|-------------|
| `/` | Get Started | `/docs#quickstart` | Activation | `cta_click` | `home_get_started_quickstart` | `home::hero` |
| `/product` | Read Docs | `/docs` | Education -> Activation | `cta_click` | `product_read_docs` | `product::hero` |
| `/use-cases` | Explore Workflow Modules | `/workflows` | Discovery -> Evaluation | `cta_click` | `use_cases_explore_workflows` | `use-cases::hero` |
| `/workflows` | Start with Quickstart | `/docs#quickstart` | Evaluation -> Activation | `cta_click` | `workflows_start_quickstart` | `workflows::hero` |
| `/security` | Security Docs | `/docs#security` | Trust -> Activation | `cta_click` | `security_view_docs_security` | `security::hero` |
| `/open-source` | View Latest Release | `https://github.com/freshtechbro/opendevbrowser/releases/latest` | Conversion | `cta_click` | `open_source_view_latest_release` | `open-source::release-panel` |
| `/open-source` | View GitHub Repo | `https://github.com/freshtechbro/opendevbrowser` | Conversion | `cta_click` | `open_source_view_github_repo` | `open-source::cta-row` |
| `/docs` | Quickstart | `/docs#quickstart` | Activation | `cta_click` | `docs_start_quickstart` | `docs::hero` |
| `/resources` | View Changelog | `/resources#changelog` | Retention/Education | `cta_click` | `resources_view_changelog` | `resources::hero` |
| `/company` | Contact Team | `/company#contact` | Support/Partnership | `cta_click` | `company_contact_team` | `company::contact` |
| `sitewide` | Get Started (Top Nav) | `/docs#quickstart` | Activation | `cta_click` | `global_top_nav_get_started` | `global::top-nav` |
| `sitewide` | View Docs (Top Nav) | `/docs` | Education -> Activation | `cta_click` | `global_top_nav_view_docs` | `global::top-nav` |
| `sitewide` | GitHub Icon (Top Nav) | `https://github.com/freshtechbro/opendevbrowser/releases/latest` | Conversion | `cta_click` | `global_top_nav_open_release_latest` | `global::top-nav` |
| `sitewide` | GitHub Icon (Footer) | `https://github.com/freshtechbro/opendevbrowser/releases/latest` | Conversion | `cta_click` | `global_footer_open_release_latest` | `global::footer` |
| `sitewide` | View README (Footer) | `https://github.com/freshtechbro/opendevbrowser#readme` | Education | `cta_click` | `global_footer_view_readme` | `global::footer` |
| `sitewide` | Get Started (Sticky CTA) | `/docs#quickstart` | Activation | `cta_click` | `global_sticky_get_started` | `global::sticky-cta` |
| `sitewide` | Download Latest Release (Sticky CTA) | `https://github.com/freshtechbro/opendevbrowser/releases/latest` | Conversion | `cta_click` | `global_sticky_download_latest_release` | `global::sticky-cta` |

Global CTA rules:

- all `Get Started` routes to `/docs#quickstart`,
- GitHub icon always routes to latest release,
- every clickable CTA in sections 6 and 10 must map to a row in this table,
- `sitewide` rows describe placement taxonomy only (top-nav/footer/sticky), not analytics route values,
- analytics `route` value must be the current pathname where the click happened (for global rows too),
- analytics payload must never emit `route: "global"` or `route: "sitewide"`,
- anchors `/docs#security` and `/resources#changelog` must exist in implementation.

---

## 8) Analytics Event Contract (Required)

Event names:

1. `cta_click` only

Required payload:

- `event_name`
- `route`
- `section_id`
- `cta_id`
- `destination_url`
- `timestamp`
- `session_id`
- `device_type` (`desktop|tablet|mobile`)

Taxonomy rules:

- `cta_id`: lowercase snake_case only, fixed registry (section 7)
- `section_id`: `<scope>::<section-slug>` lowercase
- valid `scope`: `home|product|use-cases|workflows|security|open-source|docs|resources|company|global`
- `route`: current pathname where the click occurred (for example `/product`)
- `route` must start with `/` and cannot be `global`/`sitewide`
- unknown ids fail validation in non-prod and emit structured errors in prod

---

## 9) Proof Strip Metric Integrity Protocol (Mandatory)

Purpose:

- prevent stale or inaccurate metrics,
- ensure all proof-strip data is reliable as of publication date.

As-of requirement:

- Every published proof-strip metric must include verification metadata timestamped the same day it is published.
- `2026-02-16` is the draft authoring date for this spec and must not be used as a hardcoded publish date.
- published UI must derive the shown `as_of_utc` from the latest verified entry in `docs/LANDING_METRICS_SOURCE_OF_TRUTH.md`.
- release is blocked if latest verified metric evidence is older than 24 hours at publish time.

Required verification checklist before publish:

1. Run:
- `npm run lint`
- `npx tsc --noEmit`
- `npm run build`
- `npm run test`
2. Capture metric source and evidence:
- source command,
- output artifact/file reference,
- UTC timestamp,
- owner/reviewer.
3. Record in metrics source-of-truth table:
- `docs/LANDING_METRICS_SOURCE_OF_TRUTH.md`
4. Reject metrics that are stale, unverifiable, or contradictory.

Metric card schema (required):

- `label`
- `value`
- `as_of_utc`
- `source_command_or_file`
- `verification_owner`
- `verification_status` (`verified|stale|blocked`)
- `verification_evidence_ref` (path/command output reference)

---

## 10) Page-by-Page Specifications

### 10.1 Route visual enforcement matrix

| Route | Mandatory signature visual requirement |
|------|----------------------------------------|
| `/` | Diagonal split hero + isometric command deck + proof-strip chips |
| `/product` | Isometric architecture graph with glass node cards |
| `/use-cases` | 3D card matrix with isometric category icons |
| `/workflows` | Isometric pipeline lanes with animated stage handoff |
| `/security` | Shield topology + control cards with concise trust copy |
| `/open-source` | OSS ecosystem board + release and roadmap panels |
| `/docs` | Isometric quickstart rail + action cards |
| `/resources` | Changelog timeline + guide card stack |
| `/company` | Contact glass panel + credibility icon tiles |

### Page 1: `/` Home

Purpose:
- immediate understanding + immediate action.

Primary CTA:
- `Get Started` -> `/docs#quickstart`

Required sections:

1. Diagonal hero (visual-weighted)
2. Verified proof strip (metrics only)
3. Value icon row (3 cards)
4. How it Works (7-step robust model from section 2)
5. Expanded use-case preview grid
6. Security preview (detailed, concise)
7. Open source preview (included now + roadmap teaser)
8. Developer quickstart block
9. Final CTA band

### Page 2: `/product`

Purpose:
- technical depth for implementation-minded users.

Primary CTA:
- `Read Docs` -> `/docs`

Required sections:

1. Diagonal product hero
2. Runtime architecture map
3. Mode comparison (managed / extension ops / legacy cdp)
4. Tool surface clusters
5. Diagnostics and verification surfaces
6. Export/artifact surfaces
7. Workflow integration block
8. CTA block

### Page 3: `/use-cases`

Purpose:
- communicate outcome-specific value with minimal copy.

Primary CTA:
- `Explore Workflow Modules` -> `/workflows`

Required sections:

1. Diagonal use-case hero
2. Expanded use-case grid (visual cards + snippets)
3. Persona chips
4. Workflow handoff CTA

Expanded use-case lanes (required):

1. QA loop
- snippet: "Run repeatable browser checks with trace-backed pass/fail evidence."
2. Auth automation
- snippet: "Operate safely in logged-in sessions using extension relay controls."
3. Data extraction
- snippet: "Extract structured page intelligence from DOM and workflow outputs."
4. Visual QA
- snippet: "Capture screenshots and annotations for fast UI review cycles."
5. UI component extraction
- snippet: "Clone pages/components into reusable frontend artifacts quickly."
6. Ops monitoring
- snippet: "Diagnose regressions early with status, console, network, and perf signals."
7. Research
- snippet: "Generate time-bounded multi-source research outputs in one workflow run."
8. Shopping
- snippet: "Compare offers across providers with normalized pricing and confidence signals."
9. Shopping deals hunt
- snippet: "Find best-value opportunities with score-aware deal ranking and filters."
10. UGC and presentation asset collection
- snippet: "Collect product visuals/copy artifacts for UGC videos and product slides."

### Page 4: `/workflows`

Purpose:
- explain module-level execution and outputs.

Primary CTA:
- `Start with Quickstart` -> `/docs#quickstart`

Required sections:

1. Diagonal workflows hero
2. Workflow tabs: Research, Shopping, Product Video
3. Pipeline view per tab:
- inputs,
- execution stages,
- outputs,
- links to use-case outcomes
4. Output preview wall
5. CTA row

### Page 5: `/security`

Purpose:
- concise trust posture for technical buyers.

Primary CTA:
- `Security Docs` -> `/docs#security`

Required sections:

1. Security hero
2. Secure defaults snapshot
3. Relay/token/origin controls
4. Data redaction handling
5. Reliability + testing posture
6. Operational controls and recovery surfaces
7. CTA row

Security preview copy standard (required):

- detailed enough to verify claims,
- concise enough to scan in under 20 seconds,
- each claim must map to a doc/code reference.

### Page 6: `/open-source`

Purpose:
- make open-source value explicit and actionable.

Primary CTA:
- `View Latest Release` -> `https://github.com/freshtechbro/opendevbrowser/releases/latest`

Secondary CTA:
- `View GitHub Repo` -> `https://github.com/freshtechbro/opendevbrowser`

Required sections:

1. Open-source hero
2. What is included now
3. Release/download panel
4. Contribution model
5. Public roadmap
6. CTA row

Open-source preview must include:

- license model,
- what ships today (core runtime + tools + CLI + extension + skills baseline),
- release/update path,
- contribution touchpoints,
- public roadmap summary sourced from `docs/OPEN_SOURCE_ROADMAP.md`.

### Page 7: `/docs`

Purpose:
- shortest path to first successful run.

Primary CTA:
- `Quickstart` -> `/docs#quickstart`

Required sections:

1. Docs hero
2. Install path cards
3. First-run walkthrough
4. Command/tool references
5. Troubleshooting
6. Community/support links

Anchor requirements:

- `id="quickstart"`
- `id="security"`

### Page 8: `/resources`

Purpose:
- release intelligence and implementation learning hub.

Primary CTA:
- `View Changelog` -> `/resources#changelog`

Required sections:

1. Resources hero
2. Changelog timeline
3. Guides/tutorial cards
4. Examples/templates
5. API/reference links

Anchor requirements:

- `id="changelog"`

### Page 9: `/company`

Purpose:
- trust, mission, and contact clarity.

Primary CTA:
- `Contact Team` -> `/company#contact`

Required sections:

1. Company hero
2. Mission/product principles
3. Credibility tiles
4. Contact block
5. Legal/trust links

---

## 11) Open Source Roadmap (Public)

Canonical source-of-truth:

- `docs/OPEN_SOURCE_ROADMAP.md`
- Any landing copy derived from roadmap must match this file at release time.

Roadmap framing:

- concrete, sequenced, and delivery-oriented,
- aligned to current product capabilities and user demand.

### Roadmap track A: Batteries-included skill packs

Focus:

- expand workflow-ready skill packs with deterministic scripts/templates.

Examples:

- research deep-dive packs,
- shopping-deal monitoring packs,
- UGC asset-pack generation packs,
- QA loop playbook packs.

### Roadmap track B: Hardening core workflows

Focus areas:

1. Research
2. QA loop
3. UI component extraction
4. UGC and product-presentation asset collection
5. Shopping deals workflows

Hardening scope:

- stronger deterministic outputs,
- better failure handling and diagnostics,
- tighter quality gates and regression coverage.

### Roadmap track C: Recurrent agent deal automation

Goal:

- allow agents to schedule recurrent deal checks for specific products.

Planned capabilities:

- saved watchlists,
- repeat cadence rules,
- alert thresholds (price/availability/delta),
- periodic summary artifacts for agent review.

---

## 12) Content and Copy Requirements

Must-have before launch:

1. Message hierarchy per page (headline/subheadline/CTA)
2. Capability claims mapped to current implementation surfaces
3. Security claims backed by references
4. Open-source and release-path clarity
5. Verified proof-strip metrics (section 9)
6. No testimonial sections in v1

Copy rules:

- concise, technical, specific,
- avoid generic AI marketing text,
- prefer snippet cards over paragraph blocks.

---

## 13) Technical Build Requirements

1. Performance
- LCP <= 2.5s (desktop broadband)
- defer heavy 3D assets
- code-split large visual modules

2. Accessibility
- keyboard navigation
- visible focus states
- reduced-motion mode
- semantic landmarks/headings

3. Responsive behavior
- no mobile overflow
- sticky CTA consistency
- simplified 3D layers on constrained devices

4. SEO
- route metadata
- strong internal links
- indexable docs/resources/open-source routes

5. QA toolchain (required)
- `npm run lint`
- `npx tsc --noEmit`
- `npm run build`
- `npm run test`

6. Viewport matrix
- mobile `390x844`
- tablet `768x1024`
- desktop `1280x800`
- wide desktop `1536x960`

---

## 14) Launch Acceptance Criteria

1. Route completeness
- [ ] All 9 primary routes implemented.
- [ ] Each route includes required sections from section 10.

2. Visual direction compliance
- [ ] Option B diagonal hero composition used consistently.
- [ ] Isometric icon modules present across all routes.
- [ ] Hover depth and smooth transition behavior implemented with reduced-motion fallback.

3. CTA and funnel correctness
- [ ] All primary CTAs match section 7 mapping.
- [ ] Global and secondary CTAs (nav/footer/sticky/open-source secondary) all match section 7 mapping.
- [ ] GitHub icon links to latest release URL in nav and footer.
- [ ] `/docs#security` and `/resources#changelog` resolve correctly.

4. Analytics correctness
- [ ] `cta_click` emitted for all mapped CTAs.
- [ ] Payload schema + id taxonomy validated.
- [ ] No event payload emits `route` as `global` or `sitewide`; pathname attribution is enforced at click time.

5. Content correctness
- [ ] Proof-strip metrics satisfy section 9 verification protocol.
- [ ] Proof-strip metrics source-of-truth file (`docs/LANDING_METRICS_SOURCE_OF_TRUTH.md`) is current and linked to evidence.
- [ ] No testimonial sections present in v1.
- [ ] Use-case grid includes all 10 required lanes with snippets.
- [ ] Open-source page includes included-now scope + roadmap tracks A/B/C synced with `docs/OPEN_SOURCE_ROADMAP.md`.

6. Quality gates
- [ ] Accessibility, responsive, and performance checks pass.
- [ ] Required toolchain commands pass before sign-off.

---

## 15) Recommended Next Step

Create `docs/LANDING_PAGE_IMPLEMENTATION_PLAN.md` with:

- route-by-route file map,
- component inventory,
- 3D icon asset inventory and license provenance map,
- motion/scroll implementation plan,
- proof-strip metrics verification checklist,
- QA and acceptance checklist per route.
