const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function getFocusableElements(container: ParentNode | null): HTMLElement[] {
  return Array.from(container?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [])
    .filter((node) => !node.hasAttribute("disabled") && node.tabIndex !== -1);
}

export function getWrappedFocusTarget(options: {
  focusable: readonly HTMLElement[];
  activeElement: Element | null;
  shiftKey: boolean;
}): HTMLElement | null {
  const { focusable, activeElement, shiftKey } = options;
  if (focusable.length === 0) {
    return null;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (!first || !last) {
    return null;
  }
  if (shiftKey && activeElement === first) {
    return last;
  }
  if (!shiftKey && activeElement === last) {
    return first;
  }
  return null;
}
