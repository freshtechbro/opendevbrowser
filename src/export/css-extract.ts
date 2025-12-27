import type { DomCapture } from "./dom-capture";

export function extractCss(capture: DomCapture): string {
  const lines: string[] = [];
  lines.push(".opendevbrowser-root {");
  for (const [key, value] of Object.entries(capture.styles)) {
    lines.push(`  ${key}: ${value};`);
  }
  lines.push("}");
  return lines.join("\n");
}
