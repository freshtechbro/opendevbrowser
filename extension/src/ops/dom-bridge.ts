export type DomCapture = {
  html: string;
  styles: Record<string, string>;
  warnings: string[];
  inlineStyles: boolean;
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

const DEFAULT_MAX_NODES = 1000;

export class DomBridge {
  async getOuterHtml(tabId: number, selector: string): Promise<string> {
    const result = await runWithElement(tabId, selector, (el) => (el as Element).outerHTML);
    return result;
  }

  async getInnerText(tabId: number, selector: string): Promise<string> {
    const result = await runWithElement(tabId, selector, (el) => (el as HTMLElement).innerText || el.textContent || "");
    return result;
  }

  async getAttr(tabId: number, selector: string, name: string): Promise<string | null> {
    const result = await runWithElement(tabId, selector, (el, attrName) => (el as Element).getAttribute(attrName as string), [name]);
    return result as string | null;
  }

  async getValue(tabId: number, selector: string): Promise<string | null> {
    const result = await runWithElement(tabId, selector, (el) => {
      if ("value" in el) {
        return String((el as HTMLInputElement).value ?? "");
      }
      return null;
    });
    return result as string | null;
  }

  async isVisible(tabId: number, selector: string): Promise<boolean> {
    const state = await this.getSelectorState(tabId, selector);
    return state.visible;
  }

  async isEnabled(tabId: number, selector: string): Promise<boolean> {
    const result = await runWithElement(tabId, selector, (el) => {
      if ("disabled" in el) {
        return !(el as HTMLInputElement).disabled;
      }
      return true;
    });
    return Boolean(result);
  }

  async isChecked(tabId: number, selector: string): Promise<boolean> {
    const result = await runWithElement(tabId, selector, (el) => {
      if ("checked" in el) {
        return Boolean((el as HTMLInputElement).checked);
      }
      return false;
    });
    return Boolean(result);
  }

  async click(tabId: number, selector: string): Promise<void> {
    await runWithElement(tabId, selector, (el) => {
      (el as HTMLElement).click();
      return true;
    });
  }

  async hover(tabId: number, selector: string): Promise<void> {
    await runWithElement(tabId, selector, (el) => {
      const event = new MouseEvent("mouseover", { bubbles: true, cancelable: true, view: window });
      el.dispatchEvent(event);
      return true;
    });
  }

  async focus(tabId: number, selector: string): Promise<void> {
    await runWithElement(tabId, selector, (el) => {
      (el as HTMLElement).focus();
      return true;
    });
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
    await runWithElement(tabId, selector, (el, value, shouldClear, shouldSubmit) => {
      const input = el as HTMLInputElement | HTMLTextAreaElement;
      if (shouldClear) {
        input.value = "";
      }
      input.value = String(value ?? "");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      if (shouldSubmit) {
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      }
      return true;
    }, [text, clear, submit]);
  }

  async setChecked(tabId: number, selector: string, checked: boolean): Promise<void> {
    await runWithElement(tabId, selector, (el, next) => {
      if (!("checked" in el)) {
        return false;
      }
      (el as HTMLInputElement).checked = Boolean(next);
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }, [checked]);
  }

  async select(tabId: number, selector: string, values: string[]): Promise<void> {
    await runWithElement(tabId, selector, (el, desired) => {
      if (!(el instanceof HTMLSelectElement)) {
        return false;
      }
      const set = new Set(desired as string[]);
      for (const option of Array.from(el.options)) {
        option.selected = set.has(option.value);
      }
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }, [values]);
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
    await runWithElement(tabId, selector, (el) => {
      el.scrollIntoView({ block: "center", inline: "nearest" });
      return true;
    });
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

    if (!payload.ok) {
      throw new Error(payload.error || "Dom capture failed");
    }

    return payload.value as DomCapture;
  }
}

type RunResult<T> = { ok: true; value: T } | { ok: false; error: string };

const runWithElement = async <T>(tabId: number, selector: string, fn: (el: Element, ...args: unknown[]) => T, args: unknown[] = []): Promise<T> => {
  const result = await runInTab(tabId, (sel, innerArgs) => {
    const el = document.querySelector(sel as string);
    if (!el) {
      return { ok: false, error: "Element not found" };
    }
    const fnArgs = Array.isArray(innerArgs) ? innerArgs : [];
    const value = fn(el as Element, ...fnArgs);
    return { ok: true, value };
  }, [selector, args]);

  if (!result.ok) {
    throw new Error(result.error || "Element not found");
  }
  return result.value as T;
};

const runInTab = async <T>(tabId: number, func: (...args: unknown[]) => T, args: unknown[] = []): Promise<T> => {
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
  if (!value || typeof value !== "object") return;
  const record = value as { ok?: boolean; error?: string };
  if (record.ok === false) {
    throw new Error(record.error || "Script execution failed");
  }
};
