import type { CanvasDocument, CanvasNode, CanvasPage } from "./types";

const escapeHtml = (value: string): string => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

const nodeClassName = (node: CanvasNode): string => {
  const safeName = node.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return ["odb-canvas-node", `odb-canvas-${node.kind}`, safeName || undefined].filter(Boolean).join(" ");
};

const renderTextContent = (node: CanvasNode): string => {
  const raw = node.props.text ?? node.metadata.text ?? node.name;
  /* c8 ignore next -- normalized canvas nodes always provide a string fallback name */
  return escapeHtml(typeof raw === "string" ? raw : String(raw ?? ""));
};

const inlineStyle = (node: CanvasNode): string => {
  const pairs = Object.entries(node.style)
    .filter(([, value]) => typeof value === "string" || typeof value === "number")
    .map(([key, value]) => `${key.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)}:${String(value)}`);
  return pairs.length > 0 ? ` style="${pairs.join(";")}"` : "";
};

const renderNodeHtml = (page: CanvasPage, nodeId: string): string => {
  const node = page.nodes.find((entry) => entry.id === nodeId);
  if (!node) return "";
  const children = node.childIds.map((childId) => renderNodeHtml(page, childId)).join("");
  const attrs = ` class="${nodeClassName(node)}" data-node-id="${escapeHtml(node.id)}"${inlineStyle(node)}`;

  switch (node.kind) {
    case "text":
      return `<p${attrs}>${renderTextContent(node)}</p>`;
    case "note":
      return `<aside${attrs}>${renderTextContent(node)}${children}</aside>`;
    case "connector":
      return `<hr${attrs} />`;
    case "shape":
      return `<div${attrs}>${children}</div>`;
    default:
      return `<div${attrs}>${children || renderTextContent(node)}</div>`;
  }
};

const renderPageHtml = (page: CanvasPage): string => {
  const body = page.rootNodeId ? renderNodeHtml(page, page.rootNodeId) : "";
  return `<section class="odb-canvas-page" data-page-id="${escapeHtml(page.id)}">${body}</section>`;
};

const renderNodeTsx = (page: CanvasPage, nodeId: string, depth: number): string => {
  const node = page.nodes.find((entry) => entry.id === nodeId);
  if (!node) return "";
  const indent = "  ".repeat(depth);
  const children = node.childIds.map((childId) => renderNodeTsx(page, childId, depth + 1)).filter(Boolean);
  const props: string[] = [`data-node-id="${node.id}"`, `className="${nodeClassName(node)}"`];
  if (Object.keys(node.style).length > 0) {
    const styleEntries = Object.entries(node.style)
      .filter(([, value]) => typeof value === "string" || typeof value === "number")
      .map(([key, value]) => `${JSON.stringify(key)}: ${JSON.stringify(value)}`)
      .join(", ");
    if (styleEntries) {
      props.push(`style={{ ${styleEntries} }}`);
    }
  }

  const tag = node.kind === "text" ? "p" : node.kind === "note" ? "aside" : "div";
  const text = renderTextContent(node);
  if (children.length === 0) {
    return `${indent}<${tag} ${props.join(" ")}>${text}</${tag}>`;
  }
  return [
    `${indent}<${tag} ${props.join(" ")}>`,
    text ? `${indent}  ${text}` : "",
    ...children,
    `${indent}</${tag}>`
  ].filter(Boolean).join("\n");
};

const renderPageTsx = (page: CanvasPage): string => {
  const body = page.rootNodeId ? renderNodeTsx(page, page.rootNodeId, 2) : "    <div />";
  return [
    `  <section className="odb-canvas-page" data-page-id="${page.id}">`,
    body,
    "  </section>"
  ].join("\n");
};

export function renderCanvasDocumentHtml(document: CanvasDocument): string {
  const pages = document.pages.map((page) => renderPageHtml(page)).join("\n");
  return [
    "<!doctype html>",
    "<html lang=\"en\">",
    "<head>",
    "  <meta charset=\"utf-8\" />",
    "  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />",
    `  <title>${escapeHtml(document.title)}</title>`,
    "  <style>",
    "    body { margin: 0; font-family: 'Segoe UI', sans-serif; background: #07111d; color: #f3f6fb; }",
    "    .odb-canvas-root { display: grid; gap: 24px; padding: 24px; }",
    "    .odb-canvas-page { border: 1px solid rgba(255,255,255,0.12); border-radius: 20px; padding: 24px; background: rgba(12,20,33,0.84); }",
    "    .odb-canvas-node { display: block; }",
    "    .odb-canvas-text { font-size: 1rem; line-height: 1.5; }",
    "    .odb-canvas-note { border-left: 3px solid #20d5c6; padding-left: 12px; color: #9aa6bd; }",
    "  </style>",
    "</head>",
    "<body>",
    `  <main class="odb-canvas-root" data-document-id="${escapeHtml(document.documentId)}">`,
    pages,
    "  </main>",
    "</body>",
    "</html>"
  ].join("\n");
}

export function renderCanvasDocumentComponent(document: CanvasDocument): string {
  const body = document.pages.map((page) => renderPageTsx(page)).join("\n");
  return [
    "export function OpenDevBrowserCanvasDocument() {",
    "  return (",
    `    <main className="odb-canvas-root" data-document-id="${document.documentId}">`,
    body,
    "    </main>",
    "  );",
    "}",
    ""
  ].join("\n");
}
