# OpenDevBrowser UI Example Map

Use nearby repo examples before inventing new structure. These are not design mandates, but they are the fastest way to align with current patterns and shipped constraints.

## Extension UI

- `extension/popup.html`
  - compact control surfaces, diagnostics panels, brand treatment, settings rows
- `extension/src/popup.tsx`
  - popup state orchestration, health-state rendering, annotation history affordances
- `extension/canvas.html`
  - full-screen extension-hosted editor shell
- `extension/src/canvas-page.ts`
  - design-tab shell wiring, stage controls, inspector and layers integration
- `extension/src/canvas/canvas-runtime.ts`
  - runtime-side canvas state ownership and preview synchronization
- `extension/src/annotate-content.ts`
  - in-page overlay state, annotation affordances, selection lifecycle

## Canvas Core

- `src/browser/canvas-manager.ts`
  - public `/canvas` contract surface and session-summary ownership
- `src/canvas/export.ts`
  - canonical preview and export renderer boundary
- `src/canvas/document-store.ts`
  - normalized design document truth and mutation flow

## Tests As UI Behavior Proof

- `tests/extension-canvas-editor.test.ts`
  - token editor, layers, inspector, and design-tab interaction expectations
- `tests/extension-canvas-runtime.test.ts`
  - runtime shell and preview bridge expectations
- `tests/extension-popup-brand.test.ts`
  - popup brand and icon assertions
- `tests/extension-background.test.ts`
  - popup and annotation routing expectations that affect UI trust

## How To Use This Map

1. Find the closest shipped surface.
2. Reuse its ownership model and shell assumptions unless the new brief requires a deliberate break.
3. Record any intentional deviation in the design contract and ship audit.
