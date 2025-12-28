import type { Page } from "playwright-core";

export type DomCapture = {
  html: string;
  styles: Record<string, string>;
  warnings: string[];
};

type CaptureOptions = {
  sanitize?: boolean;
  maxNodes?: number;
  inlineStyles?: boolean;
};

const DEFAULT_MAX_NODES = 1000;

export async function captureDom(
  page: Page,
  selector: string,
  options: CaptureOptions = {}
): Promise<DomCapture> {
  const shouldSanitize = options.sanitize !== false;
  const maxNodes = options.maxNodes ?? DEFAULT_MAX_NODES;
  const inlineStyles = options.inlineStyles !== false;

  return page.$eval(
    selector,
    (el, opts) => {
      const style = window.getComputedStyle(el as Element);
      const styles: Record<string, string> = {};
      for (const prop of Array.from(style)) {
        styles[prop] = style.getPropertyValue(prop);
      }

      const warnings: string[] = [];
      const root = el as Element;
      const clone = root.cloneNode(true) as Element;
      const originalElements = [root, ...Array.from(root.querySelectorAll("*"))];
      const cloneElements = [clone, ...Array.from(clone.querySelectorAll("*"))];
      const nodeLimit = Math.max(1, opts.maxNodes);

      if (originalElements.length > nodeLimit) {
        const omitted = originalElements.length - nodeLimit;
        warnings.push(`Export truncated at ${nodeLimit} nodes; ${omitted} nodes omitted.`);
      }

      const limit = Math.min(originalElements.length, nodeLimit);
      if (opts.inlineStyles) {
        for (let index = 0; index < limit; index += 1) {
          const source = originalElements[index];
          const target = cloneElements[index];
          if (!source || !target) continue;
          const computed = window.getComputedStyle(source);
          const inline = Array.from(computed)
            .map((prop) => `${prop}: ${computed.getPropertyValue(prop)};`)
            .join(" ");
          target.setAttribute("style", inline);
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

      if (opts.shouldSanitize) {
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
            const url = entry.trim().split(/\s+/)[0] ?? "";
            return isDangerousUrl(url);
          });
        };

        const sanitizeElement = (element: Element) => {
          const tag = element.tagName.toLowerCase();
          if (blockedTags.has(tag)) {
            element.remove();
            return;
          }
          for (const attr of Array.from(element.attributes)) {
            const name = attr.name.toLowerCase();
            if (name.startsWith("on")) {
              element.removeAttribute(attr.name);
              continue;
            }
            if (urlAttrs.has(name)) {
              const value = attr.value || "";
              const dangerous = name === "srcset"
                ? isDangerousSrcset(value)
                : isDangerousUrl(value);
              if (dangerous) {
                element.removeAttribute(attr.name);
              }
            }
          }
        };

        for (const element of Array.from(container.content.querySelectorAll("*"))) {
          sanitizeElement(element);
        }
        if (container.content.firstElementChild) {
          sanitizeElement(container.content.firstElementChild);
        }
      }

      return { html: container.innerHTML, styles, warnings };
    },
    { shouldSanitize, maxNodes, inlineStyles }
  );
}
