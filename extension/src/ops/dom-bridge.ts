export type DomCapture = {
  html: string;
  styles: Record<string, string>;
  warnings: string[];
  inlineStyles: boolean;
};

type RuntimePreviewBridgeResult =
  | {
    ok: true;
    artifact: {
      projection: "bound_app_runtime";
      rootBindingId: string;
      capturedAt: string;
      hierarchyHash: string;
      nodes: Array<{
        nodeId: string;
        bindingId: string;
        text: string;
        childOrderHash: string;
        attributes: Record<string, string>;
        styleProjection: Record<string, string>;
      }>;
    };
  }
  | {
    ok: false;
    fallbackReason:
      | "runtime_bridge_unavailable"
      | "runtime_projection_unsupported"
      | "runtime_projection_failed"
      | "runtime_instrumentation_missing"
      | "fallback_canvas_html";
    message: string;
  };

type CaptureOptions = {
  sanitize?: boolean;
  maxNodes?: number;
  inlineStyles?: boolean;
  styleAllowlist?: string[];
  skipStyleValues?: string[];
};

type SelectorState = {
  attached: boolean;
  visible: boolean;
};

type CanvasOverlaySelection = {
  pageId: string | null;
  nodeId: string | null;
  targetId: string | null;
  updatedAt?: string;
};

type ElementAction =
  | { type: "outerHTML" }
  | { type: "innerText" }
  | { type: "getAttr"; name: string }
  | { type: "getValue" }
  | { type: "isEnabled" }
  | { type: "isChecked" }
  | { type: "click" }
  | { type: "hover" }
  | { type: "focus" }
  | { type: "type"; value: string; clear: boolean; submit: boolean }
  | { type: "setChecked"; checked: boolean }
  | { type: "select"; values: string[] }
  | { type: "scrollIntoView" };

const DEFAULT_MAX_NODES = 1000;
const CANVAS_OVERLAY_STYLE = `
.opendevbrowser-canvas-overlay {
  position: fixed;
  top: 16px;
  right: 16px;
  z-index: 2147483647;
  max-width: 280px;
  padding: 12px 14px;
  border-radius: 14px;
  border: 1px solid rgba(148, 163, 184, 0.28);
  background: rgba(15, 23, 42, 0.94);
  color: #f8fafc;
  box-shadow: 0 24px 60px rgba(15, 23, 42, 0.28);
  font: 600 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.opendevbrowser-canvas-overlay strong {
  display: block;
  margin-bottom: 4px;
  font-size: 11px;
  letter-spacing: 0.08em;
  opacity: 0.72;
  text-transform: uppercase;
}

.opendevbrowser-canvas-highlight {
  outline: 3px solid #0ea5e9 !important;
  outline-offset: 2px !important;
}
`;

export class DomBridge {
  async getOuterHtml(tabId: number, selector: string): Promise<string> {
    const result = await runWithElement<string>(tabId, selector, { type: "outerHTML" });
    return result;
  }

  async getInnerText(tabId: number, selector: string): Promise<string> {
    const result = await runWithElement<string>(tabId, selector, { type: "innerText" });
    return result;
  }

  async getAttr(tabId: number, selector: string, name: string): Promise<string | null> {
    const result = await runWithElement(tabId, selector, { type: "getAttr", name });
    return result as string | null;
  }

  async getValue(tabId: number, selector: string): Promise<string | null> {
    const result = await runWithElement(tabId, selector, { type: "getValue" });
    return result as string | null;
  }

  async isVisible(tabId: number, selector: string): Promise<boolean> {
    const state = await this.getSelectorState(tabId, selector);
    return state.visible;
  }

  async isEnabled(tabId: number, selector: string): Promise<boolean> {
    const result = await runWithElement(tabId, selector, { type: "isEnabled" });
    return Boolean(result);
  }

  async isChecked(tabId: number, selector: string): Promise<boolean> {
    const result = await runWithElement(tabId, selector, { type: "isChecked" });
    return Boolean(result);
  }

  async click(tabId: number, selector: string): Promise<void> {
    await runWithElement(tabId, selector, { type: "click" });
  }

  async hover(tabId: number, selector: string): Promise<void> {
    await runWithElement(tabId, selector, { type: "hover" });
  }

  async focus(tabId: number, selector: string): Promise<void> {
    await runWithElement(tabId, selector, { type: "focus" });
  }

  async press(tabId: number, selector: string | null, key: string): Promise<void> {
    const result = await runInTab(tabId, (sel, pressedKey) => {
      const target = sel ? document.querySelector(sel as string) : document.activeElement;
      if (!target) {
        return { ok: false, error: "Element not found" };
      }
      if (target instanceof HTMLElement) {
        target.focus();
      }
      const opts = { key: pressedKey as string, bubbles: true, cancelable: true };
      target.dispatchEvent(new KeyboardEvent("keydown", opts));
      target.dispatchEvent(new KeyboardEvent("keypress", opts));
      target.dispatchEvent(new KeyboardEvent("keyup", opts));
      return { ok: true };
    }, [selector, key]);
    assertRunResult(result);
  }

  async type(tabId: number, selector: string, text: string, clear: boolean, submit: boolean): Promise<void> {
    await runWithElement(tabId, selector, { type: "type", value: text, clear, submit });
  }

  async setChecked(tabId: number, selector: string, checked: boolean): Promise<void> {
    await runWithElement(tabId, selector, { type: "setChecked", checked });
  }

  async select(tabId: number, selector: string, values: string[]): Promise<void> {
    await runWithElement(tabId, selector, { type: "select", values });
  }

  async scroll(tabId: number, dy: number, selector?: string): Promise<void> {
    const result = await runInTab(tabId, (sel, delta) => {
      if (sel) {
        const el = document.querySelector(sel as string);
        if (!el) {
          return { ok: false, error: "Element not found" };
        }
        (el as HTMLElement).scrollBy(0, Number(delta));
      } else {
        window.scrollBy(0, Number(delta));
      }
      return { ok: true };
    }, [selector ?? null, dy]);
    assertRunResult(result);
  }

  async scrollIntoView(tabId: number, selector: string): Promise<void> {
    await runWithElement(tabId, selector, { type: "scrollIntoView" });
  }

  async mountCanvasOverlay(
    tabId: number,
    input: { mountId: string; title: string; prototypeId: string; selection: CanvasOverlaySelection }
  ): Promise<{ overlayState: string }> {
    return await runInTab(tabId, mountCanvasOverlayScript, [{ ...input, cssText: CANVAS_OVERLAY_STYLE }]);
  }

  async unmountCanvasOverlay(tabId: number, mountId: string): Promise<boolean> {
    return await runInTab(tabId, unmountCanvasOverlayScript, [mountId]);
  }

  async selectCanvasOverlay(
    tabId: number,
    input: { nodeId: string | null; selectionHint: Record<string, unknown> }
  ): Promise<Record<string, unknown>> {
    return await runInTab(tabId, selectCanvasOverlayScript, [input]);
  }

  async syncCanvasOverlay(
    tabId: number,
    input: { mountId: string; title: string; selection: CanvasOverlaySelection }
  ): Promise<{ overlayState: string }> {
    return await runInTab(tabId, syncCanvasOverlayScript, [{ ...input, cssText: CANVAS_OVERLAY_STYLE }]);
  }

  async getSelectorState(tabId: number, selector: string): Promise<SelectorState> {
    const result = await runInTab(tabId, (sel) => {
      const el = document.querySelector(sel as string);
      if (!el) {
        return { attached: false, visible: false };
      }
      const style = window.getComputedStyle(el as Element);
      const rect = (el as Element).getBoundingClientRect();
      const visible = style.display !== "none"
        && style.visibility !== "hidden"
        && style.opacity !== "0"
        && rect.width > 0
        && rect.height > 0;
      return { attached: true, visible };
    }, [selector]);
    return result as SelectorState;
  }

  async captureDom(tabId: number, selector: string, options: CaptureOptions = {}): Promise<DomCapture> {
    const payload = await runInTab(tabId, (sel, opts) => {
      const root = document.querySelector(sel as string);
      if (!root) {
        return { ok: false, error: "Element not found" };
      }
      const config = opts as CaptureOptions & { styleAllowlist: string[]; skipStyleValues: string[] };
      const shouldSanitize = config.sanitize !== false;
      const maxNodes = typeof config.maxNodes === "number" ? config.maxNodes : 1000;
      const inlineStyles = config.inlineStyles !== false;
      const styleAllowlist = Array.isArray(config.styleAllowlist) ? config.styleAllowlist : [];
      const skipStyleValues = Array.isArray(config.skipStyleValues) ? config.skipStyleValues : [];

      const style = window.getComputedStyle(root as Element);
      const styles: Record<string, string> = {};
      for (const prop of Array.from(style)) {
        styles[prop] = style.getPropertyValue(prop);
      }

      const warnings: string[] = [];
      const clone = (root as Element).cloneNode(true) as Element;
      const originalElements = [root as Element, ...Array.from((root as Element).querySelectorAll("*"))];
      const cloneElements = [clone, ...Array.from(clone.querySelectorAll("*"))];
      const nodeLimit = Math.max(1, maxNodes);

      if (originalElements.length > nodeLimit) {
        const omitted = originalElements.length - nodeLimit;
        warnings.push(`Export truncated at ${nodeLimit} nodes; ${omitted} nodes omitted.`);
      }

      const limit = Math.min(originalElements.length, nodeLimit);
      if (inlineStyles) {
        const skipSet = new Set(skipStyleValues);
        for (let index = 0; index < limit; index += 1) {
          const source = originalElements[index];
          const target = cloneElements[index];
          if (!source || !target) continue;
          const computed = window.getComputedStyle(source);
          const parts: string[] = [];
          for (const prop of styleAllowlist) {
            const value = computed.getPropertyValue(prop).trim();
            if (value && !skipSet.has(value)) {
              parts.push(`${prop}: ${value};`);
            }
          }
          if (parts.length > 0) {
            target.setAttribute("style", parts.join(" "));
          }
        }
      }

      if (originalElements.length > nodeLimit) {
        for (let index = nodeLimit; index < cloneElements.length; index += 1) {
          const target = cloneElements[index];
          if (target) {
            target.remove();
          }
        }
      }

      const container = document.createElement("template");
      container.content.appendChild(clone);

      if (shouldSanitize) {
        const blockedTags = new Set([
          "script",
          "iframe",
          "object",
          "embed",
          "frame",
          "frameset",
          "applet",
          "base",
          "link",
          "meta",
          "noscript"
        ]);
        const urlAttrs = new Set(["href", "src", "action", "formaction", "xlink:href", "srcset"]);

        const isDangerousUrl = (value: string) => {
          const normalized = value.trim().toLowerCase();
          return normalized.startsWith("javascript:")
            || normalized.startsWith("data:")
            || normalized.startsWith("vbscript:");
        };

        const isDangerousSrcset = (value: string) => {
          const entries = value.split(",");
          return entries.some((entry) => {
            const url = entry.trim().split(/\s+/)[0] || "";
            return isDangerousUrl(url);
          });
        };

        const DANGEROUS_CSS_PATTERNS = [
          /url\s*\(/i,
          /expression\s*\(/i,
          /-moz-binding/i,
          /behavior\s*:/i,
          /javascript\s*:/i
        ];

        for (const el of Array.from(container.content.querySelectorAll("*"))) {
          if (blockedTags.has(el.tagName.toLowerCase())) {
            el.remove();
            continue;
          }
          for (const attr of Array.from(el.attributes)) {
            const name = attr.name.toLowerCase();
            const value = attr.value;
            if (name.startsWith("on")) {
              el.removeAttribute(attr.name);
              continue;
            }
            if (urlAttrs.has(name)) {
              if ((name === "srcset" && isDangerousSrcset(value)) || isDangerousUrl(value)) {
                el.removeAttribute(attr.name);
              }
              continue;
            }
            if (name === "style") {
              const normalized = value.toLowerCase();
              if (DANGEROUS_CSS_PATTERNS.some((pattern) => pattern.test(normalized))) {
                el.removeAttribute(attr.name);
              }
            }
          }
        }
      }

      return {
        ok: true,
        value: {
          html: container.innerHTML,
          styles,
          warnings,
          inlineStyles
        }
      };
    }, [selector, {
      sanitize: options.sanitize !== false,
      maxNodes: options.maxNodes ?? DEFAULT_MAX_NODES,
      inlineStyles: options.inlineStyles !== false,
      styleAllowlist: options.styleAllowlist ?? [],
      skipStyleValues: options.skipStyleValues ?? []
    }]);

    if (!payload || typeof payload !== "object" || (payload as { ok?: boolean }).ok !== true) {
      const record = payload as { error?: string } | null;
      throw new Error(record?.error || "Dom capture failed");
    }

    return payload.value as DomCapture;
  }

  async applyRuntimePreviewBridge(
    tabId: number,
    bindingId: string,
    rootSelector: string,
    html: string
  ): Promise<RuntimePreviewBridgeResult> {
    return await runInTab(tabId, (payload) => {
      const input = payload as { bindingId: string; rootSelector: string; html: string };
      const root = document.querySelector(input.rootSelector);
      if (!(root instanceof HTMLElement)) {
        return {
          ok: false,
          fallbackReason: "runtime_projection_unsupported",
          message: `Runtime root not found for selector ${input.rootSelector}.`
        } satisfies RuntimePreviewBridgeResult;
      }
      const existingBindingId = root.getAttribute("data-binding-id");
      if (existingBindingId !== input.bindingId) {
        return {
          ok: false,
          fallbackReason: "runtime_instrumentation_missing",
          message: "Runtime root is missing the expected data-binding-id instrumentation."
        } satisfies RuntimePreviewBridgeResult;
      }
      root.innerHTML = input.html;
      const nodes = [root, ...Array.from(root.querySelectorAll("[data-node-id]"))]
        .filter((element): element is HTMLElement => element instanceof HTMLElement && element.hasAttribute("data-node-id"))
        .map((element) => {
          const computed = window.getComputedStyle(element);
          const childOrder = Array.from(element.children)
            .map((child) => child instanceof HTMLElement ? child.getAttribute("data-node-id") ?? child.tagName.toLowerCase() : "")
            .join("|");
          return {
            nodeId: element.getAttribute("data-node-id") ?? "",
            bindingId: element.getAttribute("data-binding-id") ?? input.bindingId,
            text: (element.innerText || "").trim(),
            childOrderHash: childOrder,
            attributes: {
              "data-node-id": element.getAttribute("data-node-id") ?? "",
              ...(element.hasAttribute("data-binding-id")
                ? { "data-binding-id": element.getAttribute("data-binding-id") ?? "" }
                : {})
            },
            styleProjection: {
              color: computed.color,
              backgroundColor: computed.backgroundColor,
              fontSize: computed.fontSize,
              fontWeight: computed.fontWeight,
              borderRadius: computed.borderRadius,
              display: computed.display
            }
          };
        });
      return {
        ok: true,
        artifact: {
          projection: "bound_app_runtime",
          rootBindingId: input.bindingId,
          capturedAt: new Date().toISOString(),
          hierarchyHash: nodes.map((node) => `${node.nodeId}:${node.childOrderHash}`).join("|"),
          nodes
        }
      } satisfies RuntimePreviewBridgeResult;
    }, [{ bindingId, rootSelector, html }]);
  }
}

type RunResult<T> = { ok: true; value: T } | { ok: false; error: string };

const runWithElement = async <T>(tabId: number, selector: string, action: ElementAction): Promise<T> => {
  const result = await runInTab(tabId, (sel, act) => {
    const el = document.querySelector(sel as string);
    if (!el) {
      return { ok: false, error: "Element not found" };
    }
    const dispatchPointer = (target: Element, type: string, buttons: number) => {
      const rect = target.getBoundingClientRect();
      const init = {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        button: 0,
        buttons
      };
      if (typeof PointerEvent === "function") {
        target.dispatchEvent(new PointerEvent(type, init));
        return;
      }
      target.dispatchEvent(new MouseEvent(type.replace(/^pointer/, "mouse"), init));
    };
    const dispatchMouse = (target: Element, type: string, buttons: number) => {
      const rect = target.getBoundingClientRect();
      target.dispatchEvent(new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        button: 0,
        buttons
      }));
    };
    const dispatchHover = (target: Element) => {
      dispatchPointer(target, "pointerover", 0);
      dispatchPointer(target, "pointerenter", 0);
      dispatchMouse(target, "mouseover", 0);
      dispatchMouse(target, "mouseenter", 0);
      dispatchPointer(target, "pointermove", 0);
      dispatchMouse(target, "mousemove", 0);
    };
    const dispatchClick = (target: Element) => {
      dispatchHover(target);
      dispatchPointer(target, "pointerdown", 1);
      dispatchMouse(target, "mousedown", 1);
      if (target instanceof HTMLElement) {
        target.focus();
      }
      dispatchPointer(target, "pointerup", 0);
      dispatchMouse(target, "mouseup", 0);
      if (target instanceof HTMLElement) {
        target.click();
        return;
      }
      target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, composed: true, view: window }));
    };
    const action = act as ElementAction;
    switch (action.type) {
      case "outerHTML":
        return { ok: true, value: (el as Element).outerHTML };
      case "innerText":
        return { ok: true, value: (el as HTMLElement).innerText || el.textContent || "" };
      case "getAttr":
        return { ok: true, value: (el as Element).getAttribute(action.name) };
      case "getValue":
        if ("value" in el) {
          return { ok: true, value: String((el as HTMLInputElement).value ?? "") };
        }
        return { ok: true, value: null };
      case "isEnabled":
        if ("disabled" in el) {
          return { ok: true, value: !(el as HTMLInputElement).disabled };
        }
        return { ok: true, value: true };
      case "isChecked":
        if ("checked" in el) {
          return { ok: true, value: Boolean((el as HTMLInputElement).checked) };
        }
        return { ok: true, value: false };
      case "click":
        dispatchClick(el);
        return { ok: true, value: true };
      case "hover": {
        dispatchHover(el);
        return { ok: true, value: true };
      }
      case "focus":
        (el as HTMLElement).focus();
        return { ok: true, value: true };
      case "type": {
        const input = el as HTMLInputElement | HTMLTextAreaElement;
        if (action.clear) {
          input.value = "";
        }
        input.value = String(action.value ?? "");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        if (action.submit) {
          input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        }
        return { ok: true, value: true };
      }
      case "setChecked":
        if (!("checked" in el)) {
          return { ok: false, error: "Element does not support checked" };
        }
        (el as HTMLInputElement).checked = Boolean(action.checked);
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return { ok: true, value: true };
      case "select":
        if (!(el instanceof HTMLSelectElement)) {
          return { ok: false, error: "Element is not a select" };
        }
        for (const option of Array.from(el.options)) {
          option.selected = action.values.includes(option.value);
        }
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return { ok: true, value: true };
      case "scrollIntoView":
        el.scrollIntoView({ block: "center", inline: "nearest" });
        return { ok: true, value: true };
      default:
        return { ok: false, error: "Unknown action" };
    }
  }, [selector, action]);

  if (!result || typeof result !== "object") {
    throw new Error("Script execution failed");
  }
  const record = result as RunResult<T>;
  if (record.ok !== true) {
    throw new Error(record.error || "Script execution failed");
  }
  return record.value as T;
};

const runInTab = async <T, TArgs extends unknown[] = unknown[]>(
  tabId: number,
  func: (...args: TArgs) => T,
  args: TArgs = [] as unknown as TArgs
): Promise<T> => {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func,
      args
    });
    const [result] = results;
    if (!result) {
      throw new Error("No script result");
    }
    return result.result as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Script execution failed";
    throw new Error(message);
  }
};

const assertRunResult = (value: unknown): void => {
  if (!value || typeof value !== "object") {
    throw new Error("Script execution failed");
  }
  const record = value as { ok?: boolean; error?: string };
  if (record.ok === false) {
    throw new Error(record.error || "Script execution failed");
  }
};

function mountCanvasOverlayScript(input: {
  mountId: string;
  cssText: string;
  title: string;
  prototypeId: string;
  selection: CanvasOverlaySelection;
}): { overlayState: string } {
  const styleId = "opendevbrowser-canvas-style";
  if (!document.getElementById(styleId)) {
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = input.cssText;
    document.head.append(style);
  }
  document.getElementById(input.mountId)?.remove();
  const root = document.createElement("div");
  root.id = input.mountId;
  root.className = "opendevbrowser-canvas-overlay";
  const heading = document.createElement("strong");
  heading.textContent = "OpenDevBrowser Canvas";
  const titleDetail = document.createElement("div");
  titleDetail.textContent = input.title;
  const selectionDetail = document.createElement("div");
  selectionDetail.textContent = input.selection.nodeId ? `Selected ${input.selection.nodeId}` : input.prototypeId;
  root.append(heading, titleDetail, selectionDetail);
  document.body.append(root);
  document.querySelectorAll(".opendevbrowser-canvas-highlight").forEach((element) => {
    element.classList.remove("opendevbrowser-canvas-highlight");
  });
  if (input.selection.nodeId) {
    const element = document.querySelector(`[data-node-id="${input.selection.nodeId}"]`);
    if (element instanceof HTMLElement) {
      element.classList.add("opendevbrowser-canvas-highlight");
    }
  }
  return { overlayState: "mounted" };
}

function unmountCanvasOverlayScript(mountId: string): boolean {
  document.getElementById(mountId)?.remove();
  document.querySelectorAll(".opendevbrowser-canvas-highlight").forEach((element) => {
    element.classList.remove("opendevbrowser-canvas-highlight");
  });
  return true;
}

function selectCanvasOverlayScript(input: {
  nodeId: string | null;
  selectionHint: Record<string, unknown>;
}): Record<string, unknown> {
  document.querySelectorAll(".opendevbrowser-canvas-highlight").forEach((element) => {
    element.classList.remove("opendevbrowser-canvas-highlight");
  });
  const selector = typeof input.selectionHint.selector === "string"
    ? input.selectionHint.selector
    : (input.nodeId ? `[data-node-id="${input.nodeId}"]` : null);
  const element = selector ? document.querySelector(selector) : null;
  if (!(element instanceof HTMLElement)) {
    return { matched: false };
  }
  element.classList.add("opendevbrowser-canvas-highlight");
  return {
    matched: true,
    selector,
    nodeId: input.nodeId,
    tagName: element.tagName.toLowerCase(),
    text: element.innerText.slice(0, 160),
    id: element.id || null,
    className: element.className || null
  };
}

function syncCanvasOverlayScript(input: {
  mountId: string;
  cssText: string;
  title: string;
  selection: CanvasOverlaySelection;
}): { overlayState: string } {
  const styleId = "opendevbrowser-canvas-style";
  if (!document.getElementById(styleId)) {
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = input.cssText;
    document.head.append(style);
  }
  let root = document.getElementById(input.mountId);
  if (!(root instanceof HTMLElement)) {
    root = document.createElement("div");
    root.id = input.mountId;
    root.className = "opendevbrowser-canvas-overlay";
    root.innerHTML = "<strong>OpenDevBrowser Canvas</strong><div></div><div></div>";
    document.body.append(root);
  }
  const [heading, titleDetail, selectionDetail] = Array.from(root.children);
  if (heading instanceof HTMLElement) {
    heading.textContent = "OpenDevBrowser Canvas";
  }
  if (titleDetail instanceof HTMLElement) {
    titleDetail.textContent = input.title;
  }
  if (selectionDetail instanceof HTMLElement) {
    selectionDetail.textContent = input.selection.nodeId ? `Selected ${input.selection.nodeId}` : "Canvas overlay synced";
  }
  document.querySelectorAll(".opendevbrowser-canvas-highlight").forEach((element) => {
    element.classList.remove("opendevbrowser-canvas-highlight");
  });
  if (input.selection.nodeId) {
    const element = document.querySelector(`[data-node-id="${input.selection.nodeId}"]`);
    if (element instanceof HTMLElement) {
      element.classList.add("opendevbrowser-canvas-highlight");
    }
  }
  return { overlayState: "mounted" };
}
