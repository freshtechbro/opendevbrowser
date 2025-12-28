import type { DomCapture } from "./dom-capture";

export type ReactExport = {
  component: string;
  css: string;
  warnings?: string[];
};

export type ReactEmitterOptions = {
  allowUnsafeExport?: boolean;
};

export function emitReactComponent(capture: DomCapture, css: string, options: ReactEmitterOptions = {}): ReactExport {
  const warnings = [...(capture.warnings ?? [])];
  if (options.allowUnsafeExport) {
    warnings.push("Unsafe export enabled: HTML sanitization disabled.");
  }

  const warningComment = options.allowUnsafeExport
    ? "// WARNING: Unsafe export enabled. HTML sanitization disabled.\n"
    : "";

  const component = `${warningComment}import "./opendevbrowser.css";

export default function OpenDevBrowserComponent() {
  return (
    <div className="opendevbrowser-root" dangerouslySetInnerHTML={{ __html: ${JSON.stringify(capture.html)} }} />
  );
}`;

  return { component, css, warnings: warnings.length > 0 ? warnings : undefined };
}
