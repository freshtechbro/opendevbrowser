# Pinterest Harvest Visual-First Plan Critique

## Context / Scope

Reviewed only `docs/plans/pinterest-harvest-visual-first-implementation-plan-2026-05-23.md` (`Plan`) and `prompt-exports/oracle-plan-2026-05-22-211958-pinterest-plan-60cba-9d0f.md` (`Export`). Source was not edited.

## 1. Top 3 under-specified seams

1. **Pinterest media scope is reopened instead of decided.** The plan classifies `board` and `idea_page` as first-class outcomes (`Plan:46-54`) and gates source-page quality (`Plan:58-64`), but leaves first-pass board and idea support open (`Plan:250-254`). The export resolved this for sequencing: canonical image and video pins are first-class, while boards and idea pages stay diagnostic unless concrete media is extracted (`Export:165-166`, `Export:280-282`). Implementers would have to guess whether PH-002 through PH-006 build board or idea flows now.

2. **The capture execution boundary is unclear.** PH-005 and PH-006 say image pins capture PNGs first and video pins start/stop screencasts (`Plan:82-100`), but not whether this runs against the current browser-native or extension session, a new managed session, or refactored `capture.ts`. The background proves this matters because current deep capture launches a fresh headless no-extension session (`Plan:13`). The export kept this as a workflow seam around manager APIs and daemon routing (`Export:56-63`, `Export:121-123`).

3. **The analysis producer and contract owner are underspecified.** PH-008 requires an analysis status “such as” `design_ready` and proposes a separate analysis module (`Plan:118-126`), but does not say what produces analysis, which artifact owns it, or whether visual and motion use one schema. Ranking and Canvas gates depend on that answer (`Plan:130-140`, `Plan:178-188`).

## 2. Specificity balance comparing plan vs export

The plan is usefully concrete on source files and existing evidence. It over-specifies some tactical choices the implementation agent could own, especially internal strategy names (`Plan:74`) and new module names (`Plan:52`, `Plan:112`, `Plan:124`). It also drops useful export framing: a recommended-decision block and dependency map (`Export:170-205`), explicit top-level `readiness` and `rankedReferenceCount` fields (`Export:217-225`), and the resolved first-pass board or idea stance (`Export:165-166`, `Export:280-282`).

## 3. Contradictions or missing dependencies

- PH-001 names `ready`, `harvestReadiness`, `productSuccess`, and `artifactAuthority` but omits top-level `readiness` despite the export and background treating readiness as a public product field (`Plan:38`, `Export:172`).
- PH-006 says replay, frames, preview, and manifest metadata are persisted before PH-007 defines motion evidence persistence (`Plan:98-114`). Split capture from persistence or make PH-006 depend on PH-007.
- PH-014 surfaces analysis outcomes but does not depend on PH-008 or PH-009 (`Plan:190-199`).
- PH-016 validates `productSuccess:false` and product-ready flows but does not depend on PH-001, PH-009, PH-010, or PH-012 (`Plan:214-223`).

## 4. Risk of over-planning

Cut or simplify PH-014 by folding metadata surfacing into PH-001, PH-007, PH-010, and PH-012. Merge PH-015 and PH-016 into one test wave unless there is a specific fixture gap. Keep PH-018 as a checklist under final acceptance rather than a work item. The current 18-item split may create sequencing overhead without reducing risk.

## 5. Questions whose answers would change implementation order

1. Is first pass canonical image and video pins only, with boards and idea pages diagnostic unless concrete media is extracted?
2. What exact component produces visual and motion analysis?
3. Does visual or motion capture run in the active browser-native session, the existing deep-capture path, or a new shared capture coordinator?
4. Is `motion-evidence.json` definitely the canonical motion artifact, or is a compatibility summary in `visual-evidence.json` also required?
5. Which top-level readiness fields are public contract: `ready`, `readiness`, `harvestReadiness`, `productSuccess`, `artifactAuthority`, and `rankedReferenceCount`, or a smaller set?
