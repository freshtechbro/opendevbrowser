import type { DomCapture } from "./dom-capture";

export type ReactExport = {
  component: string;
  css: string;
};

export function emitReactComponent(capture: DomCapture, css: string): ReactExport {
  const component = `import "./opendevbrowser.css";

export default function OpenDevBrowserComponent() {
  return (
    <div className="opendevbrowser-root" dangerouslySetInnerHTML={{ __html: ${JSON.stringify(capture.html)} }} />
  );
}`;

  return { component, css };
}
