# OpenDevBrowser Landing Page Specification

Status: historical design specification (frontend implementation is now live; verify active behavior in `frontend/src/**` and `docs/FRONTEND.md`)
Date: 2026-02-17
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
16. Documentation architecture: two-layer design (marketing gateway + content-optimized docs sub-routes with collapsible sidebar).
17. Docs content is auto-generated at build time from repository source-of-truth files — no manual content sync.
18. Product positioning: agent-agnostic (use "AI agents", never "OpenCode agents").

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

### 4.1 Implementation architecture (approved, professional file structure)

The landing website must be implemented as a dedicated root-level frontend application, separate from the plugin runtime.

Architecture boundary rules:

- landing UI code lives in `/frontend` only,
- plugin/runtime code remains in root `/src` and is not mixed with website UI files,
- `docs/landing-prototypes/*` remains prototype/reference only (not production implementation surface).

Canonical structure:

```text
/
├─ frontend/
│  ├─ package.json
│  ├─ next.config.mjs
│  ├─ tsconfig.json
│  ├─ public/
│  │  └─ brand/                     # synced from root /assets
│  ├─ scripts/
│  │  ├─ generate-docs.mjs          # build-time docs generation
│  │  └─ sync-brand-assets.mjs
│  ├─ src/
│  │  ├─ app/
│  │  │  ├─ layout.tsx
│  │  │  ├─ loading.tsx
│  │  │  ├─ (marketing)/
│  │  │  │  ├─ page.tsx             # /
│  │  │  │  ├─ product/page.tsx
│  │  │  │  ├─ use-cases/page.tsx
│  │  │  │  ├─ workflows/page.tsx
│  │  │  │  ├─ security/page.tsx
│  │  │  │  ├─ open-source/page.tsx
│  │  │  │  ├─ docs/page.tsx        # gateway
│  │  │  │  ├─ resources/page.tsx
│  │  │  │  └─ company/page.tsx
│  │  │  └─ docs/
│  │  │     └─ [category]/
│  │  │        └─ [slug]/page.tsx   # docs sub-routes
│  │  ├─ components/
│  │  │  ├─ layout/                 # Header, Footer, StickyCTA
│  │  │  ├─ marketing/
│  │  │  ├─ docs/
│  │  │  └─ shared/
│  │  ├─ content/
│  │  │  ├─ docs-manifest.json      # generated
│  │  │  └─ docs-generated/         # generated, gitignored
│  │  ├─ lib/
│  │  │  ├─ analytics/              # cta_click contract + validation
│  │  │  ├─ docs/                   # content loaders
│  │  │  ├─ seo/                    # route metadata + structured data
│  │  │  └─ ui/                     # motion/transition helpers
│  │  ├─ data/
│  │  │  ├─ cta-registry.ts
│  │  │  ├─ metrics.ts
│  │  │  └─ roadmap.ts
│  │  └─ styles/
│  │     ├─ globals.css
│  │     └─ tokens.css
│  └─ tests/
│     ├─ unit/
│     └─ e2e/
├─ assets/                          # brand/source assets
├─ docs/                            # canonical product/spec docs
└─ src/                             # existing plugin runtime
```

Implementation notes:

- use Next.js App Router in `frontend/src/app`,
- enforce CTA and analytics registry from a single source (`frontend/src/data/cta-registry.ts`),
- generate docs sub-route content at build time via `frontend/scripts/generate-docs.mjs`,
- keep marketing and docs layouts sharing one token system while preserving docs density constraints.

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
- All icon-only buttons must have `aria-label`.
- No clickable `div`/`span` — use semantic `<button>` or `<a>`/`<Link>`.
- Images: descriptive `alt` text or `alt=""` for decorative.
- Skip link for main content required.

### 5.7 Color palette (dark-mode primary)

Color space: `oklch()` for perceptual uniformity and contrast compliance.
Source of truth: `assets/DESIGN_SPEC.md` — locked visual identity hex values converted to OKLCH.

Core palette:

```css
/* ── Background & surface (derived from Deep Navy #0F172A) ── */
--color-bg:             oklch(16% 0.03 264);   /* #0F172A deep navy */
--color-surface-1:      oklch(20% 0.03 264);   /* card/panel base */
--color-surface-2:      oklch(24% 0.03 264);   /* elevated card */
--color-surface-3:      oklch(28% 0.03 264);   /* highest elevation */

/* ── Brand & action (locked identity) ── */
--color-primary:        oklch(57% 0.09 178);   /* #0D9488 Primary Teal — links, primary CTA */
--color-primary-hover:  oklch(63% 0.10 178);   /* lighter teal hover */
--color-accent:         oklch(68% 0.11 207);   /* #06B6D4 Accent Cyan — badges, callouts */
--color-accent-hover:   oklch(74% 0.12 207);   /* lighter cyan hover */
--color-glow:           oklch(79% 0.11 207);   /* #22D3EE Glow Cyan — halos, pulses */

/* ── Text ── */
--color-text:           oklch(100% 0 0);       /* #FFFFFF Pure White — primary text */
--color-text-muted:     oklch(70% 0.02 264);   /* secondary/caption text */
--color-text-subtle:    oklch(50% 0.02 264);   /* disabled/placeholder */

/* ── Semantic ── */
--color-success:        oklch(72% 0.14 155);   /* green — status pass */
--color-warning:        oklch(78% 0.14 85);    /* amber — caution */
--color-error:          oklch(62% 0.20 25);    /* red — error/blocked */

/* ── Glass tints (derived from Glow Cyan) ── */
--color-glass-border:   oklch(79% 0.11 207 / 0.12);
--color-glass-fill:     oklch(79% 0.11 207 / 0.06);
```

Locked gradient formula (from `DESIGN_SPEC.md`):

```css
--gradient-brand: linear-gradient(135deg, var(--color-primary), var(--color-accent));
--gradient-glow:  radial-gradient(var(--color-glow) 0%, transparent 70%);
```

Contrast requirements:

- `--color-text` on `--color-bg`: >= 15:1 (AAA+).
- `--color-text-muted` on `--color-bg`: >= 4.5:1 (AA).
- `--color-primary` on `--color-bg`: >= 4.5:1 (AA).
- All CTA button text on button background: >= 4.5:1 (AA).
- Glow effects capped at 40% opacity max (per `DESIGN_SPEC.md` lock).

### 5.8 Typography scale

Font stack:

- Display/heading: `"Satoshi", "General Sans", system-ui, sans-serif`
- Body: `"Plus Jakarta Sans", "Inter var", system-ui, sans-serif`
- Code/mono: `"JetBrains Mono", "Fira Code", ui-monospace, monospace`

Fluid scale using `clamp()` (min @ 390px, max @ 1536px):

```css
--font-size-hero:       clamp(2.75rem, 2rem + 3vw, 4.5rem);
--font-size-section:    clamp(1.875rem, 1.5rem + 1.5vw, 2.75rem);
--font-size-subsection: clamp(1.375rem, 1.1rem + 1vw, 1.875rem);
--font-size-body:       clamp(1rem, 0.92rem + 0.4vw, 1.175rem);
--font-size-caption:    clamp(0.8125rem, 0.78rem + 0.2vw, 0.9375rem);
--font-size-code:       clamp(0.875rem, 0.84rem + 0.2vw, 1rem);
```

Weight map:

- Hero headline: `800`
- Section heading: `700`
- Body: `400`
- Body emphasis: `600`
- Code: `450`

Line height:

- Headings: `1.15`
- Body: `1.6`
- Code: `1.5`

Letter spacing:

- Hero headline: `-0.02em`
- Section heading: `-0.015em`
- Body: `0`
- Code: `0`

### 5.9 Motion choreography sheet

Animation library baseline: **GSAP ScrollTrigger** for scroll-linked reveals and scrubbing.
Component-level transitions: **Framer Motion** (React) or CSS transitions.

Signature moments (priority-ranked):

| Priority | Moment | Transform | Duration | Easing | Reduced-motion fallback |
|----------|--------|-----------|----------|--------|-------------------------|
| 1 | Hero load | Staggered text reveal (`translateY(24px)` + `opacity: 0→1`) + isometric deck fade-in | 800ms (text) + 1200ms (visual) | `cubic-bezier(0.16, 1, 0.3, 1)` | Instant reveal, no motion |
| 2 | Section scroll reveal | `translateY(32px)` + `opacity: 0→1`, stagger 80ms per child | 500ms | `cubic-bezier(0.16, 1, 0.3, 1)` | Instant reveal |
| 3 | Card hover | `translateY(-4px)` + shadow → `--elevation-3` | 200ms | `cubic-bezier(0.34, 1.56, 0.64, 1)` | No transform, instant shadow |
| 4 | Isometric tile tilt | `rotateX(5deg) rotateY(5deg)` on mouse-move | 300ms | spring: `stiffness 400, damping 17` | Disabled |
| 5 | Button press | `scale(0.97)` | 100ms | `ease-out` | `scale(0.99)`, 50ms |
| 6 | CTA glow pulse | `box-shadow` radiance cycle (`--color-primary / 30%`) | 2000ms | `ease-in-out`, infinite | Disabled |
| 7 | Proof-strip count-up | Number count from 0 → value on scroll enter | 1500ms | `ease-out` | Instant value display |
| 8 | Page route transition | Shared hero crossfade + incoming content slide-up | 400ms | `cubic-bezier(0.4, 0, 0.2, 1)` | Instant swap |

Scroll animation plan:

| Section type | Behavior | GSAP config |
|-------------|----------|-------------|
| Hero parallax | Isometric visual moves at 0.6x scroll speed | `scrub: true`, `start: "top top"`, `end: "bottom top"` |
| Proof strip | Count-up + staggered card reveal on scroll enter | `start: "top 80%"`, `toggleActions: "play none none none"` |
| Feature card grids | Staggered fade-in, 80ms offset per card | `batch: true`, `start: "top 85%"` |
| How-it-Works steps | Sequential pin + step reveal | `pin: true`, `scrub: 1` |
| CTA bands | Soft parallax on background gradient | `scrub: true` |

Global timing rules:

- No animation longer than 1200ms (except hero load sequence).
- No `transition: all` — only explicit properties.
- All motion must have `prefers-reduced-motion: reduce` fallback.
- Scroll-triggered animations fire once (`once: true`) unless scrub-linked.

### 5.10 Glassmorphism depth tokens

Elevation levels:

```css
/* Glass surface variants — tinted with brand Glow Cyan (#22D3EE) */
--glass-1-bg:       oklch(79% 0.11 207 / 0.04);
--glass-1-blur:     8px;
--glass-1-border:   oklch(79% 0.11 207 / 0.08);
--glass-1-shadow:   0 2px 8px oklch(16% 0.03 264 / 0.30);

--glass-2-bg:       oklch(79% 0.11 207 / 0.07);
--glass-2-blur:     16px;
--glass-2-border:   oklch(79% 0.11 207 / 0.12);
--glass-2-shadow:   0 4px 16px oklch(16% 0.03 264 / 0.35);

--glass-3-bg:       oklch(79% 0.11 207 / 0.10);
--glass-3-blur:     24px;
--glass-3-border:   oklch(79% 0.11 207 / 0.16);
--glass-3-shadow:   0 8px 32px oklch(16% 0.03 264 / 0.40);
```

Usage map:

- `glass-1`: proof-strip cards, navigation bar, footer panels.
- `glass-2`: feature cards, use-case lane cards, workflow panels.
- `glass-3`: hero content block, modal overlays, sticky CTA bar.

Noise overlay:

- Apply SVG noise filter or `background-image: url('/noise.svg')` at `opacity: 0.03` on `glass-2` and `glass-3` surfaces.
- Noise must be static (not animated) to avoid performance cost.

Light sweep:

- Subtle diagonal gradient at `135deg` (matching locked brand gradient angle) using `--color-glow` at `opacity: 0.04` on `glass-3` panels.
- Animates on hover only (shift gradient origin), not on scroll.

### 5.11 Loading states

Loading patterns (required):

- Skeleton screens:
  - Proof-strip cards: pulsing rectangle placeholders matching card dimensions.
  - Feature grids: card-shaped skeleton with shimmer animation.
  - Use-case lanes: list skeleton with icon placeholder + two text lines.

- Hero visual loading:
  - Show text content immediately (no blocking on visual).
  - Isometric visual area: low-opacity gradient placeholder → fade-in on load.
  - Blur-up technique for raster hero assets.

- 3D asset loading:
  - Pre-size containers to prevent CLS (explicit `width`/`height` or `aspect-ratio`).
  - Show CSS-only fallback (gradient + glass surface) while JS/3D loads.
  - Progressive enhancement: static PNG → animated SVG → interactive 3D.

- Route transition loading:
  - Shared navigation/header persists during transition.
  - Incoming content: skeleton shell → staggered reveal on data ready.
  - Maximum skeleton display: 300ms before content must appear or error state shown.

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
| `/docs/[slug]` | Edit on GitHub | `https://github.com/freshtechbro/opendevbrowser/edit/main/{source_path}` | Contribution | `cta_click` | `docs_edit_on_github` | `docs::content-header` |
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
| `/docs` | Isometric quickstart rail + action cards (gateway) |
| `/docs/[category]/[slug]` | Content-optimized layout with collapsible sidebar + terminal-chrome code blocks |
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

### Page 7: `/docs` (Gateway + Full Reference Documentation)

Purpose:
- shortest path to first successful run (gateway),
- complete auto-generated reference documentation for the full project surface.

Architecture:
- two-layer design: gateway page (marketing layout) + docs sub-routes (content-optimized layout).

Primary CTA:
- `Quickstart` -> `/docs#quickstart`

Anchor requirements:

- `id="quickstart"`
- `id="security"`

#### 7a) `/docs` gateway (marketing layout)

Uses the standard cinematic layout (diagonal hero, glass cards, motion choreography).

Required sections:

1. Docs hero (isometric quickstart rail visual)
2. Install path cards (npx, npm global, manual)
3. First-run walkthrough (3-step visual)
4. Documentation category cards (link to sub-routes)
5. Troubleshooting preview
6. Community/support links

#### 7b) `/docs/[category]/[slug]` sub-routes (docs layout)

Uses a dedicated content-optimized layout that shares design tokens but shifts density for reference reading.

Docs layout rules:
- same `oklch()` palette, typography stack, and brand identity as marketing pages,
- glassmorphism limited to `glass-1` only (sidebar, code blocks),
- motion reduced to card hover lift and code block focus states only — no parallax, no scroll reveals,
- body content area uses `max-width: 72ch` centered,
- code blocks use terminal-style chrome (dot-r/dot-y/dot-g header) matching marketing code showcase,
- navigation header persists but simplifies (no sticky CTA bar on docs sub-routes).

#### 7c) Docs information architecture

```
/docs                              ← Gateway (marketing layout)
/docs/quickstart                   ← First-run walkthrough
/docs/installation                 ← Install paths (npx, npm, global, manual)
/docs/concepts/
  session-modes                    ← Managed / CDP Connect / Extension Relay
  snapshot-refs                    ← AX-tree, ref system, action model
  security-model                   ← Defense-in-depth, allowlists, redaction
/docs/tools/
  index                            ← Tool surface overview (47 tools, grouped)
  [tool-name]                      ← Per-tool reference (params, examples, output)
/docs/cli/
  index                            ← CLI command overview (54 commands, grouped)
  [command-name]                   ← Per-command reference (flags, examples, output)
/docs/extension/
  setup                            ← Chrome extension install + pairing
  relay-protocol                   ← WebSocket relay, flat sessions, hub mode
/docs/workflows/
  research                         ← Research workflow module
  shopping                         ← Shopping workflow module
  product-video                    ← Product video workflow module
/docs/skills/
  overview                         ← Skill pack system
  [skill-name]                     ← Per-skill reference
/docs/guides/
  qa-loop                          ← Use-case walkthrough guides
  data-extraction
  auth-automation
  visual-qa
  ui-component-extraction
  ops-monitoring
/docs/changelog                    ← Versioned release notes (mirrors CHANGELOG.md)
```

#### 7d) Collapsible sidebar component

The docs layout uses a three-state collapsible sidebar for navigation.

State definitions:

| State | Trigger | Sidebar width | Content width | Behavior |
|-------|---------|---------------|---------------|----------|
| Expanded | Default on desktop ≥1024px | `280px` | `calc(100% - 280px)` | Full section tree with nested groups |
| Collapsed | User toggle or viewport <1024px | `48px` icon rail | `calc(100% - 48px)` | Section icons only, tooltip on hover, click re-expands |
| Overlay | Viewport <768px | `0` (off-canvas) | `100%` | Hamburger trigger, sidebar slides over as sheet |

Interaction requirements:

- toggle button: sidebar bottom edge when expanded, top-left icon when collapsed,
- `aria-expanded` + `aria-controls` on toggle button,
- keyboard shortcut: `Cmd+\` (macOS) / `Ctrl+\` (Windows/Linux) toggles sidebar,
- user preference persisted via `localStorage('odb-docs-sidebar')`,
- transition: `grid-template-columns` animates `280px → 48px` over `200ms cubic-bezier(0.4, 0, 0.2, 1)`,
- reduced-motion: instant snap (no animation),
- overlay mode: focus trap while open, `Escape` closes.

Sidebar visual tokens:

- background: `--glass-1-bg` with `--color-glass-border` edge,
- active nav item: `2px` left border in `--color-primary`,
- section group headers: `--font-size-caption` in `--color-text-subtle`,
- collapsed rail icons: `--color-surface-1` background, `--color-primary` dot indicators,
- no new visual language — all derived from existing token set.

Code block benefit:
- collapsed state gives code blocks ~200px more horizontal space, critical for CLI examples with long flag chains.

#### 7e) Auto-generation pipeline

All docs sub-route content is auto-generated at build time from repository source-of-truth files.

Generation script: `scripts/generate-docs.mjs`

Source mapping:

| Source file | Generates | Extraction method |
|-------------|-----------|-------------------|
| `src/tools/index.ts` + individual tool files | `/docs/tools/[name]` | Parse Zod schema → params table, extract JSDoc → description, pull examples from tests |
| `docs/CLI.md` | `/docs/cli/[command]` | Parse existing markdown command blocks (flags, examples, output) |
| `docs/SURFACE_REFERENCE.md` | `/docs/tools/index` + `/docs/cli/index` | Category groupings already defined |
| `docs/ARCHITECTURE.md` | `/docs/concepts/*` | Section splitting by `##` headings |
| `skills/*/SKILL.md` | `/docs/skills/[name]` | Frontmatter + body content |
| `CHANGELOG.md` | `/docs/changelog` | Direct render with version anchors |
| `src/relay/` + `extension/` | `/docs/extension/*` | Structured extraction from module docs |

Output format: MDX files consumed by Next.js docs pages.

Pipeline rules:

- runs at `npm run build` time (no runtime generation),
- fails build if source files are missing or malformed,
- emits sidebar navigation manifest (`docs-manifest.json`) consumed by sidebar component,
- no manual content sync — source files are the single source of truth,
- generated files are gitignored (derived artifacts, not source).

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

1. Performance (Core Web Vitals)
- LCP <= 2.5s (desktop broadband)
- INP < 200ms (replaces FID as primary responsiveness metric)
- CLS < 0.1 (pre-size 3D containers with `aspect-ratio` to prevent shift)
- defer heavy 3D assets
- code-split large visual modules
- inline critical CSS above-the-fold
- preload fonts: Satoshi (display), Plus Jakarta Sans (body), JetBrains Mono (code)

2. Accessibility
- keyboard navigation
- visible focus states (`:focus-visible` with `--color-accent` ring)
- reduced-motion mode (`prefers-reduced-motion: reduce` on all animation)
- semantic landmarks/headings
- skip link to `#main-content`
- `aria-label` on all icon-only buttons (GitHub, close, menu)

3. Responsive behavior
- no mobile overflow
- sticky CTA consistency
- simplified 3D layers on constrained devices
- fluid typography via `clamp()` (section 5.8) — no media-query font overrides
- container queries on card components for layout-aware responsiveness

4. SEO
- route metadata (title, description, OG tags per route)
- strong internal links
- indexable docs/resources/open-source routes
- structured data (`Organization`, `SoftwareApplication`) on home route

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

7. Modern CSS requirements
- `oklch()` color space for all palette tokens (section 5.7)
- `clamp()` for all fluid sizing (section 5.8)
- `container queries` (`@container`) on card and panel components
- `@layer` cascade layers: `reset`, `tokens`, `base`, `components`, `utilities`
- `color-mix()` for dynamic glass tint generation from `--color-primary`
- CSS `scroll-timeline` / `animation-timeline: scroll()` as progressive enhancement fallback for GSAP
- View Transitions API (`document.startViewTransition`) for route changes (Chrome 111+, progressive)
- `backdrop-filter` for glassmorphism (Firefox fallback: solid `--color-surface-2` background)

8. Page transition contract
- Use Next.js App Router `loading.tsx` skeleton as baseline.
- Layer View Transitions API for shared-element hero crossfade between routes.
- Fallback: CSS opacity crossfade (200ms) for browsers without View Transitions.
- Navigation/header must persist — no full-page blank state.
- Maximum time-to-content after route change: 400ms.

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

7. Documentation completeness
- [ ] `/docs` gateway page renders with marketing layout and category cards linking to sub-routes.
- [ ] Auto-generation pipeline (`scripts/generate-docs.mjs`) runs at build time without errors.
- [ ] All 47 tools have generated `/docs/tools/[name]` pages with params table, description, and examples.
- [ ] All 54 CLI commands have generated `/docs/cli/[command]` pages with flags, examples, and output.
- [ ] Concepts pages (`session-modes`, `snapshot-refs`, `security-model`) render from `docs/ARCHITECTURE.md`.
- [ ] Skill pack pages render from `skills/*/SKILL.md` files.
- [ ] Changelog page renders from `CHANGELOG.md` with version anchors.
- [ ] Collapsible sidebar renders in all three states (expanded, collapsed, overlay).
- [ ] Sidebar state persists across page navigation via `localStorage`.
- [ ] Sidebar toggle is keyboard-accessible (`Cmd+\` / `Ctrl+\`, `aria-expanded`).
- [ ] Docs sub-route pages use `glass-1` only — no `glass-2`/`glass-3` depth.
- [ ] Code blocks use terminal-chrome styling (dot header) matching marketing code showcase.
- [ ] "Edit on GitHub" link on every docs sub-route page resolves to correct source file.
- [ ] `docs-manifest.json` generated and consumed by sidebar navigation component.

---

## 15) Recommended Next Step

Create `docs/LANDING_PAGE_IMPLEMENTATION_PLAN.md` with:

- route-by-route file map,
- component inventory,
- 3D icon asset inventory and license provenance map,
- motion/scroll implementation plan,
- proof-strip metrics verification checklist,
- QA and acceptance checklist per route.
