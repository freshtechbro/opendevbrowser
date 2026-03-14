# Canvas Governance Playbook

## Purpose

Use this playbook before any `/canvas` mutation and during every design-feedback loop. It keeps the runtime handshake, governance state, and evaluation rules aligned with the design-canvas spec.

## Required command order

1. `canvas.session.open`
2. Read the handshake and confirm `preflightState: "handshake_read"`
3. `canvas.plan.set`
4. `canvas.plan.get` or `canvas.capabilities.get` until the runtime reports `plan_accepted`
5. `canvas.document.patch`
6. `canvas.preview.render` or `canvas.tab.open`
7. `canvas.feedback.poll`
8. `canvas.document.save` or `canvas.document.export`

Mutation is blocked until the handshake has been read and the plan is accepted. A save is still invalid when required governance blocks remain missing in `requiredBeforeSave`.

## Handshake requirements

Every `canvas.session.open` response is the runtime contract. Read these fields before sending a patch:

- `canvasSessionId`
- `browserSessionId`
- `documentId`
- `leaseId`
- `preflightState`
- `governanceRequirements.requiredBeforeMutation`
- `governanceRequirements.requiredBeforeSave`
- `generationPlanRequirements.requiredBeforeMutation`
- `allowedLibraries`
- `allowedBeforePlan`

Interpret `allowedLibraries` by lane:
- `components` are reusable UI adapters such as `shadcn`
- `icons` are approved icon families
- `styling` is for utility/theme adapters such as `tailwindcss`
- do not mix icon or styling libraries into `componentStrategy.approvedLibraries`

Preflight states:
- `handshake_read`
- `plan_submitted`
- `plan_accepted`
- `patching_enabled`

## Governance blocks

The document must declare `designGovernance` with at least:

- `intent`
- `designLanguage`
- `contentModel`
- `layoutSystem`
- `typographySystem`
- `colorSystem`
- `surfaceSystem`
- `iconSystem`
- `motionSystem`
- `responsiveSystem`
- `accessibilityPolicy`
- `libraryPolicy`
- `runtimeBudgets`

The first accepted `generationPlan` must include:

- `targetOutcome`
- `visualDirection`
- `layoutStrategy`
- `contentStrategy`
- `componentStrategy`
- `motionPosture`
- `responsivePosture`
- `accessibilityPosture`
- `validationTargets`

## Blocker handling

Canonical blocker path:

```json
{
  "code": "plan_required",
  "blockingCommand": "canvas.document.patch",
  "requiredNextCommands": ["canvas.plan.set"],
  "details": { "auditId": "CANVAS-01" }
}
```

If `canvas.document.patch` or `canvas.document.save` returns a blocker, stop mutating and fix the missing handshake, governance, or plan requirement before retrying.

## Canvas robustness issue classes

| Audit ID | Failure class | Typical signal | Required response |
|---|---|---|---|
| `CANVAS-01` | Handshake missing or unread before mutation | `plan_required`, missing `handshake_read` evidence | Re-run `canvas.session.open` or `canvas.capabilities.get`, then `canvas.plan.set` |
| `CANVAS-02` | Required governance block missing | save blocker, empty `requiredBeforeSave`, validation warning | Fill missing `designGovernance.*` fields before save/export |
| `CANVAS-03` | Required `generationPlan` field missing or malformed | `canvas.plan.set` rejected or warnings retained | Submit a complete plan and wait for acceptance |
| `CANVAS-04` | Library or icon-policy violation | validation warning, policy blocker, downgraded export | Adjust component/library choice to match `libraryPolicy` and `iconSystem` |
| `CANVAS-05` | Unsupported target or overlay mount failure | `unsupported_target`, `restricted_url`, overlay mount error | Move to a normal http(s) preview target or managed mode |
| `CANVAS-06` | Runtime budget exceeded or preview downgrade ignored | degrade warning, overflowed media/fonts/telemetry budget | Reduce preview cost or accept the downgrade before proceeding |
| `CANVAS-07` | Feedback missing target attribution or validation metadata | feedback lacks `targetId`, `pageId`, `class`, or `evidenceRefs` | Re-poll or fix the feedback source before trusting the result |

## Feedback evaluation loop

Required categories:

- `render`
- `console`
- `network`
- `validation`
- `performance`
- `asset`
- `export`

Required fields per feedback item:

- `documentId`
- `pageId`
- `prototypeId`
- `targetId`
- `documentRevision`
- `severity`
- `class`
- `message`
- `evidenceRefs`

Streaming checks:

- `feedback.item` carries the canonical feedback payload
- `feedback.heartbeat` proves the subscription is still alive
- `feedback.complete` explains why the stream ended

## Router and template references

- `scripts/odb-workflow.sh canvas-preflight`
- `scripts/odb-workflow.sh canvas-feedback-eval`
- `assets/templates/canvas-handshake-example.json`
- `assets/templates/canvas-generation-plan.v1.json`
- `assets/templates/canvas-feedback-eval.json`
- `assets/templates/canvas-blocker-checklist.json`
