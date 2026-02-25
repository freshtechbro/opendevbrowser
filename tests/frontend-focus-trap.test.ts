// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { getFocusableElements, getWrappedFocusTarget } from "../frontend/src/components/layout/focus-trap";

const byId = (container: HTMLElement, id: string): HTMLElement =>
  container.querySelector<HTMLElement>(`#${id}`) as HTMLElement;

describe("frontend focus trap helpers", () => {
  it("collects focusable elements and skips disabled/tabindex=-1 nodes", () => {
    const container = document.createElement("div");
    container.innerHTML = `
      <a id="link" href="/docs">Docs</a>
      <button id="button">Action</button>
      <button id="disabled" disabled>Disabled</button>
      <div id="custom" tabindex="0"></div>
      <div id="skip" tabindex="-1"></div>
    `;

    const focusable = getFocusableElements(container);

    expect(focusable.map((node) => node.id)).toEqual(["link", "button", "custom"]);
  });

  it("wraps focus from last to first on forward tab", () => {
    const container = document.createElement("div");
    container.innerHTML = `
      <button id="first">First</button>
      <button id="last">Last</button>
    `;
    const focusable = getFocusableElements(container);

    const wrapped = getWrappedFocusTarget({
      focusable,
      activeElement: byId(container, "last"),
      shiftKey: false
    });

    expect(wrapped).toBe(byId(container, "first"));
  });

  it("wraps focus from first to last on reverse tab", () => {
    const container = document.createElement("div");
    container.innerHTML = `
      <button id="first">First</button>
      <button id="last">Last</button>
    `;
    const focusable = getFocusableElements(container);

    const wrapped = getWrappedFocusTarget({
      focusable,
      activeElement: byId(container, "first"),
      shiftKey: true
    });

    expect(wrapped).toBe(byId(container, "last"));
  });

  it("returns null when no wrapping is needed", () => {
    const container = document.createElement("div");
    container.innerHTML = `
      <button id="first">First</button>
      <button id="middle">Middle</button>
      <button id="last">Last</button>
    `;
    const focusable = getFocusableElements(container);

    const wrapped = getWrappedFocusTarget({
      focusable,
      activeElement: byId(container, "middle"),
      shiftKey: false
    });

    expect(wrapped).toBeNull();
  });

  it("returns null when no focusable elements exist", () => {
    expect(getWrappedFocusTarget({
      focusable: [],
      activeElement: null,
      shiftKey: false
    })).toBeNull();
  });

  it("returns null when focusable entries are sparse", () => {
    const button = document.createElement("button");
    expect(getWrappedFocusTarget({
      focusable: [undefined as unknown as HTMLElement, button],
      activeElement: button,
      shiftKey: false
    })).toBeNull();
    expect(getWrappedFocusTarget({
      focusable: [button, undefined as unknown as HTMLElement],
      activeElement: button,
      shiftKey: true
    })).toBeNull();
  });

  it("returns an empty focusable list for null containers", () => {
    expect(getFocusableElements(null)).toEqual([]);
  });
});
