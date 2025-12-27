import type { Page } from "playwright-core";

export type DomCapture = {
  html: string;
  styles: Record<string, string>;
};

const DANGEROUS_TAG_PATTERN =
  /<\s*(script|iframe|object|embed|frame|frameset|applet|base|link|meta|noscript)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>|<\s*(script|iframe|object|embed|frame|frameset|applet|base|link|meta|noscript)\b[^>]*\/?>/gi;

const EVENT_HANDLER_ATTR_PATTERN = /\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]*)/gi;

const DANGEROUS_URL_ATTR_PATTERN =
  /\s+(href|src|action)\s*=\s*["']\s*(javascript|data|vbscript):[^"']*["']/gi;

export function sanitizeHtml(html: string): string {
  let result = html;
  result = result.replace(DANGEROUS_TAG_PATTERN, "");
  result = result.replace(EVENT_HANDLER_ATTR_PATTERN, "");
  result = result.replace(DANGEROUS_URL_ATTR_PATTERN, "");
  return result;
}

export async function captureDom(
  page: Page,
  selector: string,
  options: { sanitize?: boolean } = {}
): Promise<DomCapture> {
  const shouldSanitize = options.sanitize !== false;

  return page.$eval(
    selector,
    (el, opts) => {
      const style = window.getComputedStyle(el as Element);
      const styles: Record<string, string> = {};
      for (const prop of Array.from(style)) {
        styles[prop] = style.getPropertyValue(prop);
      }

      let html = (el as Element).outerHTML;

      if (opts.shouldSanitize) {
        const DANGEROUS_TAG_PATTERN =
          /<\s*(script|iframe|object|embed|frame|frameset|applet|base|link|meta|noscript)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>|<\s*(script|iframe|object|embed|frame|frameset|applet|base|link|meta|noscript)\b[^>]*\/?>/gi;
        const EVENT_HANDLER_ATTR_PATTERN = /\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]*)/gi;
        const DANGEROUS_URL_ATTR_PATTERN =
          /\s+(href|src|action)\s*=\s*["']\s*(javascript|data|vbscript):[^"']*["']/gi;

        html = html.replace(DANGEROUS_TAG_PATTERN, "");
        html = html.replace(EVENT_HANDLER_ATTR_PATTERN, "");
        html = html.replace(DANGEROUS_URL_ATTR_PATTERN, "");
      }

      return { html, styles };
    },
    { shouldSanitize }
  );
}

