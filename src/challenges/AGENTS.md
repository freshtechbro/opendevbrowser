# src/challenges/ — Agent Guidelines

Bounded challenge orchestration plane. Extends `src/AGENTS.md`.

## Overview

Coordinates preserved auth and anti-bot incidents without becoming a second truth authority. This layer reads manager- and provider-owned signals, selects one bounded recovery lane, executes browser-scoped actions through the runtime handle, verifies progress, and records audit-ready outcomes.

## Authority Boundaries

- `src/browser/session-store.ts` owns blocker truth.
- Browser managers own surfaced `meta.blocker`, `meta.blockerState`, `meta.blockerResolution`, and additive `meta.challenge`/`meta.challengeOrchestration` fields.
- `src/browser/global-challenge-coordinator.ts` owns lifecycle only.
- `src/providers/runtime-factory.ts` and browser fallback transport own preserve-or-complete routing.
- `src/providers/registry.ts` owns durable anti-bot pressure.
- `src/challenges/` may interpret and act on those seams, but it must not redefine blocker, lifecycle, transport, or registry truth.

## Structure

```text
src/challenges/
├── orchestrator.ts               # Main coordinator: evidence → policy → strategy → execution → outcome
├── action-loop.ts                # Executes typed challenge action steps through runtime handle methods
├── interpreter.ts                # Classifies challenge evidence and human-boundary posture
├── strategy-selector.ts          # Chooses bounded recovery lane and attempt posture
├── verification-gate.ts          # Determines whether progress cleared, deferred, or stayed blocked
├── evidence-bundle.ts            # Canonical evidence capture and normalization
├── capability-matrix.ts          # Browser/helper eligibility calculation
├── policy-gate.ts                # challengeAutomationMode resolution and hard gating
├── human-yield-gate.ts           # Reclaimable human-yield packet generation
├── governed-adapter-gateway.ts   # Governed advanced lane selection
├── optional-computer-use-bridge.ts # Browser-scoped helper suggestions only
├── outcome-recorder.ts           # Audit trail storage and latest-attempt lookup
├── owned-environment-lane.ts     # Owned-environment fixture lane
├── sanctioned-identity-lane.ts   # Sanctioned identity/session reuse lane
├── service-adapter-lane.ts       # Service-backed recovery lane hooks
├── verification-gate.ts          # Progress verification policy
├── types.ts                      # Shared challenge types and step payloads
└── README.md                     # Short authority-boundary statement
```

## Key Patterns

- Evidence first: `ChallengeOrchestrator.captureEvidence()` gathers status, snapshot, debug trace, and cookie state before planning.
- Policy before action: resolve `challengeAutomationMode` and helper eligibility before selecting any lane.
- Browser-scoped execution only: actions flow through `ChallengeRuntimeHandle`; no desktop-agent or global OS automation.
- Verification after every bounded attempt: outcome must be `resolved`, `deferred`, `yield_required`, `policy_blocked`, or `still_blocked` with explicit reason.
- Audit trail always: `OutcomeRecorder` keeps durable, replay-safe records of attempts and verification state.

## In Scope

- Preserved-session reuse and legitimate cookie continuity
- Browser-native clicks, hover, select, scroll, pointer, drag, wait, snapshot, cookie inspection/import, and debug trace refresh
- Bounded interaction experimentation on recoverable shells and interstitials
- Reclaimable human-yield packets for secret-entry or human-authority boundaries
- Owned-environment fixtures that use sanctioned vendor test keys only

## Out of Scope

- Hidden bypasses or challenge-solving services
- Token harvesting
- Desktop-wide automation or global coordinate control
- Autonomous entry of usernames, passwords, OTPs, passkeys, or equivalent secrets

## Anti-Patterns

| Never | Why |
|-------|-----|
| Reclassify blocker truth inside `src/challenges/` | Manager/session-store surfaces remain authoritative |
| Execute actions outside `ChallengeRuntimeHandle` | Breaks browser-scoped safety and auditability |
| Treat helper suggestions as desktop-agent capability | Current helper bridge is browser-scoped only |
| Skip verification after action execution | Recovery lanes must prove progress or stand down explicitly |
| Persist durable pressure or retry budgets here | Registry/runtime layers own long-lived pressure state |

## Sync Points

When challenge behavior changes, also sync:
- `docs/ARCHITECTURE.md`
- `docs/CLI.md`
- `docs/SURFACE_REFERENCE.md`
- `docs/TROUBLESHOOTING.md`
- `README.md`
- parent guides in `AGENTS.md`, `src/AGENTS.md`, `src/browser/AGENTS.md`, and `src/providers/AGENTS.md`
