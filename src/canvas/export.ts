import { resolveCanvasLibraryPolicy } from "./document-store";
import { CANVAS_SURFACE_TOKENS, CANVAS_SURFACE_TOKEN_VARIABLES } from "./surface-palette";
import {
  collectCanvasTokenDefinitions,
  readCanvasTokenPath,
  stringifyTokenCssValue,
  tokenPathToCssVar
} from "./token-references";
import type { CanvasBinding, CanvasDocument, CanvasNode, CanvasPage, CanvasParityArtifact, CanvasRect } from "./types";

type RenderElement = {
  tag: string;
  classNames?: string[];
  attributes?: Record<string, string>;
  style?: Record<string, string | number>;
  text?: string;
  children?: RenderElement[];
  selfClosing?: boolean;
};

type RenderContext = {
  bindingById: Map<string, CanvasBinding>;
  nodeById: Map<string, CanvasNode>;
  tailwindEnabled: boolean;
};

type RenderHtmlOptions = {
  pageIds?: string[];
  baseHref?: string | null;
  rootAttributes?: Record<string, string>;
};

type ResolvedBinding = {
  componentName: string | null;
  sourceKind: string | null;
};

type ComponentKind = "badge" | "button" | "card" | "dialog" | "motion" | "tabs";

type IconDescriptor = {
  componentRef: string | null;
  identifier: string;
  role: string | null;
  sourceLibrary: string;
};

type MediaKind = "image" | "video" | "audio";

type MediaDescriptor = {
  kind: MediaKind;
  tagName: "img" | "video" | "audio";
  src: string | null;
  poster: string | null;
  alt: string | null;
  controls: boolean;
  autoPlay: boolean;
  loop: boolean;
  muted: boolean;
  playsInline: boolean;
  preload: string | null;
};

const TAILWIND_STYLING_LIBRARY = "tailwindcss";

const UNIT_LESS_STYLES = new Set([
  "flex",
  "flexGrow",
  "flexShrink",
  "fontWeight",
  "lineHeight",
  "opacity",
  "order",
  "scale",
  "zIndex"
]);

const SVG_HTML_ATTRIBUTE_MAP: Record<string, string> = {
  strokeWidth: "stroke-width",
  strokeLinecap: "stroke-linecap",
  strokeLinejoin: "stroke-linejoin",
  autoPlay: "autoplay",
  playsInline: "playsinline",
  srcSet: "srcset",
  controlsList: "controlslist",
  crossOrigin: "crossorigin",
  referrerPolicy: "referrerpolicy"
};

const renderSurfaceTokenStyles = (): string => [
  `:root {`,
  `  ${CANVAS_SURFACE_TOKEN_VARIABLES.background}: ${CANVAS_SURFACE_TOKENS.background};`,
  `  ${CANVAS_SURFACE_TOKEN_VARIABLES.text}: ${CANVAS_SURFACE_TOKENS.text};`,
  `  ${CANVAS_SURFACE_TOKEN_VARIABLES.grid}: ${CANVAS_SURFACE_TOKENS.grid};`,
  `  ${CANVAS_SURFACE_TOKEN_VARIABLES.accent}: ${CANVAS_SURFACE_TOKENS.accent};`,
  `  ${CANVAS_SURFACE_TOKEN_VARIABLES.accentStrong}: ${CANVAS_SURFACE_TOKENS.accentStrong};`,
  `}`
].join(" ");

const renderDocumentTokenStyles = (document: CanvasDocument): string => {
  const definitions = collectCanvasTokenDefinitions(document.tokens);
  const lines = [
    renderSurfaceTokenStyles()
  ];
  if (definitions.base.length > 0) {
    lines.push(
      [
        ":root {",
        ...definitions.base.flatMap((entry) => {
          const cssValue = stringifyTokenCssValue(entry.value);
          return cssValue ? [`  ${entry.cssCustomProperty}: ${cssValue};`] : [];
        }),
        "}"
      ].join("\n")
    );
  }
  for (const [modeId, entries] of definitions.byMode.entries()) {
    const declarations = entries.flatMap((entry) => {
      const cssValue = stringifyTokenCssValue(entry.value);
      return cssValue ? [`  ${entry.cssCustomProperty}: ${cssValue};`] : [];
    });
    if (declarations.length === 0) {
      continue;
    }
    lines.push(
      [
        `[data-token-mode~="${modeId}"], [data-theme="${modeId}"] {`,
        ...declarations,
        "}"
      ].join("\n")
    );
  }
  return lines.join("\n");
};

const escapeHtml = (value: string): string => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

const slugify = (value: string): string => value
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/(^-|-$)/g, "");

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

const readString = (value: unknown): string | null => typeof value === "string" && value.trim().length > 0 ? value : null;

const readActiveTokenModeId = (document: CanvasDocument): string | null => readString(document.tokens.metadata.activeModeId);

const readBoolean = (value: unknown): boolean | null => {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    if (value === "true") {
      return true;
    }
    if (value === "false") {
      return false;
    }
  }
  return null;
};

const readNodeText = (node: CanvasNode): string => {
  const raw = node.props.text ?? node.metadata.text;
  if (raw !== undefined && raw !== null) {
    return typeof raw === "string" ? raw : String(raw);
  }
  return node.kind === "text" || node.kind === "note" || node.kind === "component-instance"
    ? node.name
    : "";
};

const parseNumericStyle = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const formatCssValue = (key: string, value: string | number): string => {
  if (typeof value === "number" && !UNIT_LESS_STYLES.has(key)) {
    return `${value}px`;
  }
  return String(value);
};

const toHtmlAttributeName = (key: string): string => SVG_HTML_ATTRIBUTE_MAP[key] ?? key;

const appendUtilityClasses = (classNames: Array<string | undefined>, enabled: boolean, utilityClasses: string[]): string[] => {
  const values = classNames.filter((entry): entry is string => Boolean(entry));
  return enabled ? [...values, ...utilityClasses] : values;
};

const toHtmlStyle = (style: Record<string, string | number> | undefined): string => {
  if (!style) {
    return "";
  }
  const pairs = Object.entries(style)
    .filter(([, value]) => typeof value === "string" || typeof value === "number")
    .map(([key, value]) => `${key.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)}:${escapeHtml(formatCssValue(key, value))}`);
  return pairs.length > 0 ? ` style="${pairs.join(";")}"` : "";
};

const toTsxStyle = (style: Record<string, string | number> | undefined): string => {
  if (!style) {
    return "";
  }
  const pairs = Object.entries(style)
    .filter(([, value]) => typeof value === "string" || typeof value === "number")
    .map(([key, value]) => `${JSON.stringify(key)}: ${JSON.stringify(formatCssValue(key, value))}`);
  return pairs.length > 0 ? ` style={{ ${pairs.join(", ")} }}` : "";
};

const renderHtmlAttributes = (element: RenderElement): string => {
  const attrs: string[] = [];
  if (element.classNames && element.classNames.length > 0) {
    attrs.push(` class="${escapeHtml(element.classNames.join(" "))}"`);
  }
  if (element.attributes) {
    for (const [key, value] of Object.entries(element.attributes)) {
      attrs.push(` ${toHtmlAttributeName(key)}="${escapeHtml(value)}"`);
    }
  }
  return `${attrs.join("")}${toHtmlStyle(element.style)}`;
};

const renderTsxAttributes = (element: RenderElement): string => {
  const attrs: string[] = [];
  if (element.classNames && element.classNames.length > 0) {
    attrs.push(` className="${escapeHtml(element.classNames.join(" "))}"`);
  }
  if (element.attributes) {
    for (const [key, value] of Object.entries(element.attributes)) {
      attrs.push(` ${key}="${escapeHtml(value)}"`);
    }
  }
  return `${attrs.join("")}${toTsxStyle(element.style)}`;
};

const emitHtml = (element: RenderElement): string => {
  const attrs = renderHtmlAttributes(element);
  if (element.selfClosing) {
    return `<${element.tag}${attrs} />`;
  }
  const children = element.children?.map((child) => emitHtml(child)).join("") ?? "";
  const text = typeof element.text === "string" ? escapeHtml(element.text) : "";
  return `<${element.tag}${attrs}>${text}${children}</${element.tag}>`;
};

const emitTsx = (element: RenderElement, depth: number): string => {
  const indent = "  ".repeat(depth);
  const attrs = renderTsxAttributes(element);
  if (element.selfClosing) {
    return `${indent}<${element.tag}${attrs} />`;
  }
  const childLines: string[] = [];
  if (typeof element.text === "string") {
    childLines.push(`${indent}  {${JSON.stringify(element.text)}}`);
  }
  if (element.children) {
    for (const child of element.children) {
      childLines.push(emitTsx(child, depth + 1));
    }
  }
  if (childLines.length === 0) {
    return `${indent}<${element.tag}${attrs}></${element.tag}>`;
  }
  return [
    `${indent}<${element.tag}${attrs}>`,
    ...childLines,
    `${indent}</${element.tag}>`
  ].join("\n");
};

const buildContext = (document: CanvasDocument, page: CanvasPage): RenderContext => {
  const policy = resolveCanvasLibraryPolicy(document);
  return {
    bindingById: new Map(document.bindings.map((binding) => [binding.id, binding])),
    nodeById: new Map(page.nodes.map((node) => [node.id, node])),
    tailwindEnabled: policy.styling.includes(TAILWIND_STYLING_LIBRARY)
  };
};

const readNodeAttributes = (node: CanvasNode): Record<string, unknown> => {
  return isRecord(node.props.attributes) ? node.props.attributes : {};
};

const resolveNodeTagName = (node: CanvasNode): string | null => {
  const propTag = readString(node.props.tagName);
  if (propTag) {
    return propTag.toLowerCase();
  }
  const codeSync = isRecord(node.metadata.codeSync) ? node.metadata.codeSync : null;
  return readString(codeSync?.tagName)?.toLowerCase() ?? null;
};

const resolvePrimaryAsset = (document: CanvasDocument, node: CanvasNode): CanvasDocument["assets"][number] | null => {
  const assetIds = Array.isArray(node.metadata.assetIds)
    ? node.metadata.assetIds.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
  const firstAssetId = assetIds[0];
  if (!firstAssetId) {
    return null;
  }
  return document.assets.find((asset) => asset.id === firstAssetId) ?? null;
};

const resolveMediaDescriptor = (document: CanvasDocument, node: CanvasNode): MediaDescriptor | null => {
  const tagName = resolveNodeTagName(node);
  const asset = resolvePrimaryAsset(document, node);
  const assetKind = readString(asset?.kind)?.toLowerCase();
  const assetMime = readString(asset?.mime)?.toLowerCase();
  const attributes = readNodeAttributes(node);
  const src = readString(node.props.src)
    ?? readString(attributes.src)
    ?? readString(asset?.url)
    ?? readString(asset?.repoPath);
  const poster = readString(node.props.poster) ?? readString(attributes.poster);
  const alt = readString(node.props.alt)
    ?? readString(attributes.alt)
    ?? readString(isRecord(asset?.metadata) ? asset?.metadata.alt : null)
    ?? readString(node.name);
  const controls = readBoolean(node.props.controls) ?? readBoolean(attributes.controls) ?? true;
  const autoPlay = readBoolean(node.props.autoPlay) ?? readBoolean(attributes.autoPlay) ?? false;
  const loop = readBoolean(node.props.loop) ?? readBoolean(attributes.loop) ?? false;
  const muted = readBoolean(node.props.muted) ?? readBoolean(attributes.muted) ?? (tagName === "video");
  const playsInline = readBoolean(node.props.playsInline) ?? readBoolean(attributes.playsInline) ?? (tagName === "video");
  const preload = readString(node.props.preload) ?? readString(attributes.preload);
  if (tagName === "img" || assetKind === "image" || assetMime?.startsWith("image/")) {
    return {
      kind: "image",
      tagName: "img",
      src,
      poster: null,
      alt,
      controls: false,
      autoPlay: false,
      loop: false,
      muted: true,
      playsInline: false,
      preload: null
    };
  }
  if (tagName === "video" || assetKind === "video" || assetMime?.startsWith("video/")) {
    return {
      kind: "video",
      tagName: "video",
      src,
      poster,
      alt,
      controls,
      autoPlay,
      loop,
      muted,
      playsInline,
      preload
    };
  }
  if (tagName === "audio" || assetKind === "audio" || assetMime?.startsWith("audio/")) {
    return {
      kind: "audio",
      tagName: "audio",
      src,
      poster: null,
      alt,
      controls,
      autoPlay,
      loop,
      muted,
      playsInline: false,
      preload
    };
  }
  return null;
};

const resolvePrimaryBinding = (context: RenderContext, node: CanvasNode): ResolvedBinding | null => {
  const bindingId = typeof node.bindingRefs.primary === "string" ? node.bindingRefs.primary : null;
  if (!bindingId) {
    return null;
  }
  const binding = context.bindingById.get(bindingId);
  if (!binding) {
    return null;
  }
  const metadata = isRecord(binding.metadata) ? binding.metadata : {};
  return {
    componentName: readString(binding.componentName) ?? readString(metadata.exportName),
    sourceKind: readString(metadata.sourceKind)
  };
};

const resolveComponentKind = (node: CanvasNode, binding: ResolvedBinding | null, text: string): ComponentKind | null => {
  const componentName = binding?.componentName?.toLowerCase() ?? "";
  if (componentName.includes("button")) {
    return "button";
  }
  if (componentName.includes("badge")) {
    return "badge";
  }
  if (componentName.includes("tabs")) {
    return "tabs";
  }
  if (componentName.includes("card")) {
    return "card";
  }
  if (componentName.includes("dialog")) {
    return "dialog";
  }
  if (componentName.includes("motion")) {
    return "motion";
  }
  if (node.kind !== "component-instance") {
    return null;
  }
  const lineCount = text.split("\n").filter((entry) => entry.trim().length > 0).length;
  if (lineCount > 1 || node.rect.height >= 96) {
    return "card";
  }
  if (node.rect.height <= 56) {
    return "badge";
  }
  return "button";
};

const readNodeIcons = (node: CanvasNode): IconDescriptor[] => {
  const refs = Array.isArray(node.metadata.iconRefs)
    ? node.metadata.iconRefs
    : node.metadata.iconRef
      ? [node.metadata.iconRef]
      : [];
  return refs.flatMap((entry) => {
    if (!isRecord(entry)) {
      return [];
    }
    const sourceLibrary = readString(entry.sourceLibrary);
    if (!sourceLibrary) {
      return [];
    }
    return [{
      componentRef: readString(entry.componentRef),
      identifier: readString(entry.identifier) ?? "generic",
      role: readString(entry.role),
      sourceLibrary
    }];
  });
};

const buildNodeStyle = (
  node: CanvasNode,
  parentRect: CanvasRect | null,
  isRootSurface: boolean,
  componentKind: ComponentKind | null,
  text: string
): Record<string, string | number> => {
  const style = Object.entries(node.style).reduce<Record<string, string | number>>((acc, [key, value]) => {
    if (typeof value === "string" || typeof value === "number") {
      acc[key] = value;
    }
    return acc;
  }, {});
  for (const [property, tokenRef] of Object.entries(node.tokenRefs)) {
    const tokenPath = readCanvasTokenPath(tokenRef);
    if (tokenPath) {
      style[property] = tokenPathToCssVar(tokenPath);
    }
  }
  if (text.includes("\n") && style.whiteSpace === undefined) {
    style.whiteSpace = "pre-line";
  }
  if (isRootSurface) {
    style.position = "relative";
    style.width = node.rect.width;
    style.minHeight = node.rect.height;
    style.overflow ??= "hidden";
    return style;
  }
  const baseRect = parentRect as CanvasRect;
  style.position = "absolute";
  style.left = node.rect.x - baseRect.x;
  style.top = node.rect.y - baseRect.y;
  style.width = Math.max(node.rect.width, 40);
  style.minHeight = Math.max(node.rect.height, node.kind === "connector" ? 2 : componentKind === "badge" ? 32 : 44);
  return style;
};

const buildNodeClassNames = (
  node: CanvasNode,
  binding: ResolvedBinding | null,
  componentKind: ComponentKind | null,
  isRootSurface: boolean,
  tailwindEnabled: boolean
): string[] => {
  return appendUtilityClasses([
    "odb-canvas-node",
    `odb-canvas-${slugify(node.kind)}`,
    slugify(node.name) ? `odb-node-${slugify(node.name)}` : undefined,
    isRootSurface ? "odb-canvas-surface" : undefined,
    componentKind ? `odb-canvas-component-${componentKind}` : undefined,
    binding?.sourceKind ? `odb-source-${slugify(binding.sourceKind)}` : undefined,
    binding?.componentName ? `odb-binding-${slugify(binding.componentName)}` : undefined
  ], tailwindEnabled, [
    "box-border",
    ...(isRootSurface ? ["relative", "isolate", "overflow-hidden"] : ["absolute"]),
    ...(componentKind === "button" ? ["inline-flex", "items-center", "justify-center", "gap-3", "rounded-full", "font-semibold", "shadow-2xl"] : []),
    ...(componentKind === "badge" ? ["inline-flex", "items-center", "gap-2", "rounded-full", "font-semibold"] : []),
    ...(componentKind === "tabs" ? ["inline-flex", "items-center", "rounded-full", "p-1", "shadow-2xl"] : []),
    ...(componentKind === "card" || componentKind === "dialog" || componentKind === "motion"
      ? ["grid", "content-start", "gap-4", "rounded-3xl", "shadow-2xl"]
      : []),
    ...(node.kind === "note" ? ["rounded-2xl"] : []),
    ...(node.kind === "connector" ? ["h-px", "w-full"] : [])
  ]);
};

const buildNodeAttributes = (node: CanvasNode, binding: ResolvedBinding | null, icons: IconDescriptor[]): Record<string, string> => {
  const attrs: Record<string, string> = {
    "data-node-id": node.id
  };
  const primaryBindingId = typeof node.bindingRefs.primary === "string" ? node.bindingRefs.primary : null;
  if (primaryBindingId) {
    attrs["data-binding-id"] = primaryBindingId;
  }
  if (binding?.componentName) {
    attrs["data-component-name"] = binding.componentName;
  }
  if (binding?.sourceKind) {
    attrs["data-source-kind"] = binding.sourceKind;
  }
  if (icons.length > 0) {
    attrs["data-icon-library"] = [...new Set(icons.map((icon) => icon.sourceLibrary))].join(",");
  }
  return attrs;
};

const splitInlineItems = (text: string): string[] => {
  const items = text.split(/\s{2,}/).map((entry) => entry.trim()).filter(Boolean);
  return items.length > 1 ? items : [];
};

const resolveTextTag = (node: CanvasNode): string => {
  const fontSize = parseNumericStyle(node.style.fontSize);
  const name = node.name.toLowerCase();
  if (name.includes("title") || (fontSize !== null && fontSize >= 48)) {
    return "h1";
  }
  if (name.includes("section") || (fontSize !== null && fontSize >= 28)) {
    return "h2";
  }
  if (name.includes("brand") || name.includes("nav") || name.includes("logos")) {
    return "div";
  }
  return "p";
};

const createSvgIcon = (classNames: string[], children: RenderElement[]): RenderElement => ({
  tag: "span",
  classNames,
  attributes: { "aria-hidden": "true" },
  children: [{
    tag: "svg",
    attributes: {
      viewBox: "0 0 24 24",
      fill: "none",
      xmlns: "http://www.w3.org/2000/svg"
    },
    children
  }]
});

const createOutlinePath = (attributes: Record<string, string>): RenderElement => ({
  tag: "path",
  selfClosing: true,
  attributes: {
    stroke: "currentColor",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeWidth: "1.85",
    ...attributes
  }
});

const buildTablerIcon = (icon: IconDescriptor): RenderElement => {
  switch (icon.identifier) {
    case "arrow-right":
      return createSvgIcon(["odb-canvas-icon", "odb-canvas-icon-tabler"], [
        createOutlinePath({ d: "M5 12h14" }),
        createOutlinePath({ d: "m12 5 7 7-7 7" })
      ]);
    case "rocket":
      return createSvgIcon(["odb-canvas-icon", "odb-canvas-icon-tabler"], [
        createOutlinePath({ d: "M5 19c2.5-6.5 7.5-11.5 14-14-2.5 6.5-7.5 11.5-14 14Z" }),
        createOutlinePath({ d: "m9 15-4 4" }),
        {
          tag: "circle",
          selfClosing: true,
          attributes: {
            cx: "14.5",
            cy: "9.5",
            r: "1.75",
            stroke: "currentColor",
            strokeWidth: "1.85"
          }
        }
      ]);
    case "components":
      return createSvgIcon(["odb-canvas-icon", "odb-canvas-icon-tabler"], [
        { tag: "rect", selfClosing: true, attributes: { x: "4", y: "4", width: "7", height: "7", rx: "2", stroke: "currentColor", strokeWidth: "1.85" } },
        { tag: "rect", selfClosing: true, attributes: { x: "13", y: "4", width: "7", height: "7", rx: "2", stroke: "currentColor", strokeWidth: "1.85" } },
        { tag: "rect", selfClosing: true, attributes: { x: "8.5", y: "13", width: "7", height: "7", rx: "2", stroke: "currentColor", strokeWidth: "1.85" } }
      ]);
    case "layout-dashboard":
      return createSvgIcon(["odb-canvas-icon", "odb-canvas-icon-tabler"], [
        { tag: "rect", selfClosing: true, attributes: { x: "4", y: "4", width: "7", height: "7", rx: "2", stroke: "currentColor", strokeWidth: "1.85" } },
        { tag: "rect", selfClosing: true, attributes: { x: "13", y: "4", width: "7", height: "5", rx: "2", stroke: "currentColor", strokeWidth: "1.85" } },
        { tag: "rect", selfClosing: true, attributes: { x: "13", y: "11", width: "7", height: "9", rx: "2", stroke: "currentColor", strokeWidth: "1.85" } },
        { tag: "rect", selfClosing: true, attributes: { x: "4", y: "13", width: "7", height: "7", rx: "2", stroke: "currentColor", strokeWidth: "1.85" } }
      ]);
    default:
      return createSvgIcon(["odb-canvas-icon", "odb-canvas-icon-tabler"], [
        { tag: "circle", selfClosing: true, attributes: { cx: "12", cy: "12", r: "7", stroke: "currentColor", strokeWidth: "1.85" } },
        createOutlinePath({ d: "M12 9v6" }),
        createOutlinePath({ d: "M9 12h6" })
      ]);
  }
};

const buildFluentIcon = (icon: IconDescriptor): RenderElement => {
  switch (icon.identifier) {
    case "grid-dots-24":
      return createSvgIcon(["odb-canvas-icon", "odb-canvas-icon-fluent"], Array.from({ length: 9 }, (_, index) => {
        const x = 7 + (index % 3) * 5;
        const y = 7 + Math.floor(index / 3) * 5;
        return {
          tag: "circle",
          selfClosing: true,
          attributes: { cx: String(x), cy: String(y), r: "1.4", fill: "currentColor" }
        };
      }));
    case "chat-bubbles-24":
      return createSvgIcon(["odb-canvas-icon", "odb-canvas-icon-fluent"], [
        {
          tag: "path",
          selfClosing: true,
          attributes: {
            d: "M5.5 8.5a3.5 3.5 0 0 1 3.5-3.5h8a3.5 3.5 0 0 1 3.5 3.5v4A3.5 3.5 0 0 1 17 16H11l-4.5 3v-3.1A3.49 3.49 0 0 1 5.5 12.5v-4Z",
            stroke: "currentColor",
            strokeWidth: "1.8"
          }
        },
        {
          tag: "path",
          selfClosing: true,
          attributes: {
            d: "M8 9.75h7M8 12.75h4.5",
            stroke: "currentColor",
            strokeLinecap: "round",
            strokeWidth: "1.8"
          }
        }
      ]);
    case "branch-24":
      return createSvgIcon(["odb-canvas-icon", "odb-canvas-icon-fluent"], [
        createOutlinePath({ d: "M8 7.5v9" }),
        createOutlinePath({ d: "M8 12.5h7" }),
        createOutlinePath({ d: "M15 12.5V7.5" }),
        { tag: "circle", selfClosing: true, attributes: { cx: "8", cy: "6", r: "2", fill: "currentColor" } },
        { tag: "circle", selfClosing: true, attributes: { cx: "15", cy: "6", r: "2", fill: "currentColor" } },
        { tag: "circle", selfClosing: true, attributes: { cx: "15", cy: "18", r: "2", fill: "currentColor" } }
      ]);
    case "sparkle-24":
    default:
      return createSvgIcon(["odb-canvas-icon", "odb-canvas-icon-fluent"], [
        {
          tag: "path",
          selfClosing: true,
          attributes: {
            d: "M12 3.5 14.4 9l5.6 2.4-5.6 2.4L12 19.5l-2.4-5.7L4 11.4 9.6 9 12 3.5Z",
            fill: "currentColor"
          }
        }
      ]);
  }
};

const buildDecorativeIcon = (icon: IconDescriptor): RenderElement => {
  if (icon.sourceLibrary === "3dicons") {
    return {
      tag: "span",
      classNames: ["odb-canvas-icon", "odb-canvas-icon-3d"],
      attributes: { "aria-hidden": "true" },
      children: [{ tag: "span", classNames: ["odb-canvas-icon-orb"] }]
    };
  }
  const emoji = icon.identifier.includes("party") ? "🎉" : "✨";
  return {
    tag: "span",
    classNames: ["odb-canvas-icon", "odb-canvas-icon-emoji"],
    attributes: { "aria-hidden": "true" },
    text: emoji
  };
};

const buildIconElement = (icon: IconDescriptor, tailwindEnabled: boolean): RenderElement => {
  const iconElement = icon.sourceLibrary === "tabler"
    ? buildTablerIcon(icon)
    : icon.sourceLibrary === "microsoft-fluent-ui-system-icons"
      ? buildFluentIcon(icon)
      : buildDecorativeIcon(icon);
  return {
    ...iconElement,
    classNames: appendUtilityClasses(iconElement.classNames!, tailwindEnabled, [
      "inline-flex",
      "items-center",
      "justify-center",
      "shrink-0",
      icon.sourceLibrary === "3dicons" || icon.sourceLibrary === "@lobehub/fluent-emoji-3d" ? "h-5" : "h-4",
      icon.sourceLibrary === "3dicons" || icon.sourceLibrary === "@lobehub/fluent-emoji-3d" ? "w-5" : "w-4"
    ])
  };
};

const buildIconStack = (icons: IconDescriptor[], tailwindEnabled: boolean): RenderElement | null => {
  if (icons.length === 0) {
    return null;
  }
  if (icons.length === 1) {
    return buildIconElement(icons[0] as IconDescriptor, tailwindEnabled);
  }
  return {
    tag: "span",
    classNames: appendUtilityClasses(["odb-canvas-icon-stack"], tailwindEnabled, ["inline-flex", "items-center", "gap-2"]),
    children: icons.map((icon) => buildIconElement(icon, tailwindEnabled))
  };
};

const buildButtonElement = (
  node: CanvasNode,
  classNames: string[],
  attributes: Record<string, string>,
  style: Record<string, string | number>,
  icons: IconDescriptor[],
  label: string,
  tailwindEnabled: boolean
): RenderElement => {
  const leading = icons.filter((icon) => !icon.identifier.includes("arrow"));
  const trailing = icons.filter((icon) => icon.identifier.includes("arrow"));
  return {
    tag: "button",
    classNames,
    attributes: { ...attributes, type: "button" },
    style,
    children: [
      ...leading.map((icon) => buildIconElement(icon, tailwindEnabled)),
      { tag: "span", classNames: appendUtilityClasses(["odb-canvas-label"], tailwindEnabled, ["leading-none"]), text: label },
      ...trailing.map((icon) => buildIconElement(icon, tailwindEnabled))
    ]
  };
};

const buildBadgeElement = (
  classNames: string[],
  attributes: Record<string, string>,
  style: Record<string, string | number>,
  icons: IconDescriptor[],
  label: string,
  tailwindEnabled: boolean
): RenderElement => ({
  tag: "span",
  classNames,
  attributes,
  style,
  children: [
    ...icons.map((icon) => buildIconElement(icon, tailwindEnabled)),
    { tag: "span", classNames: appendUtilityClasses(["odb-canvas-label"], tailwindEnabled, ["leading-none"]), text: label }
  ]
});

const buildTabsElement = (
  classNames: string[],
  attributes: Record<string, string>,
  style: Record<string, string | number>,
  icons: IconDescriptor[],
  label: string,
  tailwindEnabled: boolean
): RenderElement => ({
  tag: "div",
  classNames,
  attributes,
  style,
  children: [{
    tag: "button",
    classNames: appendUtilityClasses(["odb-canvas-tabs-trigger"], tailwindEnabled, ["inline-flex", "items-center", "justify-center", "gap-2", "w-full", "rounded-full", "leading-none"]),
    attributes: {
      type: "button",
      role: "tab",
      "aria-selected": "true"
    },
    children: [
      ...icons.map((icon) => buildIconElement(icon, tailwindEnabled)),
      { tag: "span", classNames: appendUtilityClasses(["odb-canvas-label"], tailwindEnabled, ["leading-none"]), text: label }
    ]
  }]
});

const buildCardElement = (
  classNames: string[],
  attributes: Record<string, string>,
  style: Record<string, string | number>,
  icons: IconDescriptor[],
  text: string,
  childNodes: RenderElement[],
  tailwindEnabled: boolean
): RenderElement => {
  const lines = text.split("\n").map((entry) => entry.trim()).filter(Boolean);
  const title = lines[0] ?? "Canvas Component";
  const bodyLines = lines.slice(1);
  const iconStack = buildIconStack(icons, tailwindEnabled);
  return {
    tag: "article",
    classNames,
    attributes,
    style,
    children: [
      {
        tag: "div",
        classNames: appendUtilityClasses(["odb-canvas-card-header"], tailwindEnabled, ["flex", "items-center", "justify-between", "gap-4"]),
        children: [
          {
            tag: "div",
            classNames: appendUtilityClasses(["odb-canvas-card-title-wrap"], tailwindEnabled, ["grid", "gap-2"]),
            children: [{ tag: "p", classNames: appendUtilityClasses(["odb-canvas-card-title"], tailwindEnabled, ["leading-none"]), text: title }]
          },
          ...(iconStack ? [iconStack] : [])
        ]
      },
      ...(bodyLines.length > 0
        ? [{
          tag: "div",
          classNames: appendUtilityClasses(["odb-canvas-card-copy"], tailwindEnabled, ["grid", "gap-2"]),
          children: bodyLines.map((line) => ({ tag: "p", text: line }))
        }]
        : []),
      ...childNodes
    ]
  };
};

const buildMediaElement = (
  classNames: string[],
  attributes: Record<string, string>,
  style: Record<string, string | number>,
  descriptor: MediaDescriptor,
  tailwindEnabled: boolean
): RenderElement => {
  const mediaClassNames = appendUtilityClasses([
    ...classNames,
    "odb-canvas-media-surface",
    `odb-canvas-media-${descriptor.kind}`
  ], tailwindEnabled, descriptor.kind === "audio" ? ["grid", "content-start"] : []);
  if (!descriptor.src) {
    return {
      tag: "div",
      classNames: mediaClassNames,
      attributes: {
        ...attributes,
        "data-media-missing": "true"
      },
      style,
      children: [{
        tag: "span",
        classNames: ["odb-canvas-media-placeholder"],
        text: `${descriptor.kind} source missing`
      }]
    };
  }
  const mediaAttributes: Record<string, string> = {
    ...attributes,
    src: descriptor.src
  };
  if (descriptor.tagName === "img") {
    mediaAttributes.alt = descriptor.alt ?? "Canvas media";
    mediaAttributes.loading = mediaAttributes.loading ?? "lazy";
    return {
      tag: "img",
      classNames: mediaClassNames,
      attributes: mediaAttributes,
      style: {
        ...style,
        objectFit: typeof style.objectFit === "string" ? style.objectFit : "cover"
      },
      selfClosing: true
    };
  }
  if (descriptor.poster) {
    mediaAttributes.poster = descriptor.poster;
  }
  if (descriptor.controls) {
    mediaAttributes.controls = "true";
  }
  if (descriptor.autoPlay) {
    mediaAttributes.autoPlay = "true";
  }
  if (descriptor.loop) {
    mediaAttributes.loop = "true";
  }
  if (descriptor.muted) {
    mediaAttributes.muted = "true";
  }
  if (descriptor.playsInline) {
    mediaAttributes.playsInline = "true";
  }
  if (descriptor.preload) {
    mediaAttributes.preload = descriptor.preload;
  }
  return {
    tag: descriptor.tagName,
    classNames: mediaClassNames,
    attributes: mediaAttributes,
    style: descriptor.kind === "audio"
      ? style
      : {
        ...style,
        objectFit: typeof style.objectFit === "string" ? style.objectFit : "cover"
      }
  };
};

const buildPlainTextElement = (
  node: CanvasNode,
  classNames: string[],
  attributes: Record<string, string>,
  style: Record<string, string | number>,
  text: string,
  tailwindEnabled: boolean
): RenderElement => {
  const inlineItems = splitInlineItems(text);
  return {
    tag: resolveTextTag(node),
    classNames: appendUtilityClasses([...classNames, inlineItems.length > 0 ? "odb-canvas-inline-list" : undefined], tailwindEnabled, inlineItems.length > 0 ? ["flex", "flex-wrap", "items-center", "gap-4"] : []),
    attributes,
    style,
    text: inlineItems.length === 0 ? text : undefined,
    children: inlineItems.length > 0
      ? inlineItems.map((item) => ({
        tag: "span",
        classNames: ["odb-canvas-inline-item"],
        text: item
      }))
      : undefined
  };
};

const buildGenericContainer = (
  node: CanvasNode,
  classNames: string[],
  attributes: Record<string, string>,
  style: Record<string, string | number>,
  text: string,
  childNodes: RenderElement[]
): RenderElement => {
  const tag = node.kind === "note" ? "aside" : node.kind === "connector" ? "div" : "div";
  return {
    tag,
    classNames: [...classNames, node.kind === "connector" ? "odb-canvas-connector" : ""].filter(Boolean),
    attributes: node.kind === "connector" ? { ...attributes, role: "separator" } : attributes,
    style,
    text: node.kind === "connector" || text.length === 0 ? undefined : text,
    children: childNodes
  };
};

const buildNodeElement = (
  document: CanvasDocument,
  context: RenderContext,
  nodeId: string,
  parentRect: CanvasRect | null,
  isRootSurface = false
): RenderElement | null => {
  const node = context.nodeById.get(nodeId);
  if (!node) {
    return null;
  }
  const text = readNodeText(node);
  const binding = resolvePrimaryBinding(context, node);
  const componentKind = resolveComponentKind(node, binding, text);
  const media = resolveMediaDescriptor(document, node);
  const icons = readNodeIcons(node);
  const style = buildNodeStyle(node, parentRect, isRootSurface, componentKind, text);
  const classNames = buildNodeClassNames(node, binding, componentKind, isRootSurface, context.tailwindEnabled);
  const attributes = buildNodeAttributes(node, binding, icons);
  const childNodes = node.childIds
    .map((childId) => buildNodeElement(document, context, childId, node.rect))
    .filter((entry): entry is RenderElement => Boolean(entry));

  if (media) {
    return buildMediaElement(classNames, attributes, style, media, context.tailwindEnabled);
  }
  if (componentKind === "button") {
    return buildButtonElement(node, classNames, attributes, style, icons, text || node.name, context.tailwindEnabled);
  }
  if (componentKind === "badge") {
    return buildBadgeElement(classNames, attributes, style, icons, text || node.name, context.tailwindEnabled);
  }
  if (componentKind === "tabs") {
    return buildTabsElement(classNames, attributes, style, icons, text || node.name, context.tailwindEnabled);
  }
  if (componentKind === "card" || componentKind === "dialog" || componentKind === "motion") {
    return buildCardElement(classNames, attributes, style, icons, text || node.name, childNodes, context.tailwindEnabled);
  }
  if (node.kind === "text") {
    return buildPlainTextElement(node, classNames, attributes, style, text || node.name, context.tailwindEnabled);
  }
  return buildGenericContainer(node, classNames, attributes, style, text, childNodes);
};

const computeBounds = (nodes: CanvasNode[]): CanvasRect => {
  if (nodes.length === 0) {
    return { x: 0, y: 0, width: 1200, height: 720 };
  }
  const minX = Math.min(...nodes.map((node) => node.rect.x));
  const minY = Math.min(...nodes.map((node) => node.rect.y));
  const maxX = Math.max(...nodes.map((node) => node.rect.x + node.rect.width));
  const maxY = Math.max(...nodes.map((node) => node.rect.y + node.rect.height));
  return {
    x: minX,
    y: minY,
    width: Math.max(maxX - minX, 320),
    height: Math.max(maxY - minY, 240)
  };
};

const buildPageElement = (document: CanvasDocument, page: CanvasPage): RenderElement => {
  const context = buildContext(document, page);
  if (page.rootNodeId) {
    const root = buildNodeElement(document, context, page.rootNodeId, null, true);
  return {
    tag: "section",
    classNames: appendUtilityClasses(["odb-canvas-page"], context.tailwindEnabled, ["w-full", "grid", "place-items-center"]),
    attributes: { "data-page-id": page.id },
    children: root ? [root] : []
  };
  }
  const bounds = computeBounds(page.nodes);
  const childNodes = page.nodes
    .filter((node) => node.parentId === null)
    .map((node) => buildNodeElement(document, context, node.id, bounds))
    .filter((entry): entry is RenderElement => Boolean(entry));
  return {
    tag: "section",
    classNames: appendUtilityClasses(["odb-canvas-page"], context.tailwindEnabled, ["w-full", "grid", "place-items-center"]),
    attributes: { "data-page-id": page.id },
    children: [{
      tag: "div",
      classNames: appendUtilityClasses(["odb-canvas-page-surface"], context.tailwindEnabled, ["relative", "isolate", "overflow-hidden", "mx-auto"]),
      style: {
        position: "relative",
        width: bounds.width,
        minHeight: bounds.height,
        overflow: "hidden"
      },
      children: childNodes
    }]
  };
};

const renderLibraryAttributes = (document: CanvasDocument): string => {
  const policy = resolveCanvasLibraryPolicy(document);
  const attrs = [
    ["data-component-libraries", policy.components.join(",")],
    ["data-icon-libraries", policy.icons.join(",")],
    ["data-styling-libraries", policy.styling.join(",")]
  ] as Array<[string, string]>;
  return attrs
    .flatMap(([key, value]) => value.length > 0 ? [` ${key}="${escapeHtml(value)}"`] : [])
    .join("");
};

const renderRootAttributes = (attributes: Record<string, string> | undefined): string => {
  if (!attributes) {
    return "";
  }
  return Object.entries(attributes)
    .flatMap(([key, value]) => key.trim().length > 0 ? [` ${key}="${escapeHtml(value)}"`] : [])
    .join("");
};

const renderTailwindUtilityStyles = (): string => [
  ".min-h-screen { min-height: 100vh; }",
  ".w-full { width: 100%; }",
  ".mx-auto { margin-left: auto; margin-right: auto; }",
  ".grid { display: grid; }",
  ".flex { display: flex; }",
  ".inline-flex { display: inline-flex; }",
  ".place-items-center { place-items: center; }",
  ".items-center { align-items: center; }",
  ".justify-center { justify-content: center; }",
  ".justify-between { justify-content: space-between; }",
  ".content-start { align-content: start; }",
  ".flex-wrap { flex-wrap: wrap; }",
  ".gap-2 { gap: 0.5rem; }",
  ".gap-3 { gap: 0.75rem; }",
  ".gap-4 { gap: 1rem; }",
  ".p-1 { padding: 0.25rem; }",
  ".rounded-2xl { border-radius: 1rem; }",
  ".rounded-3xl { border-radius: 1.5rem; }",
  ".rounded-full { border-radius: 9999px; }",
  ".font-semibold { font-weight: 600; }",
  ".leading-none { line-height: 1; }",
  ".absolute { position: absolute; }",
  ".relative { position: relative; }",
  ".isolate { isolation: isolate; }",
  ".overflow-hidden { overflow: hidden; }",
  ".box-border { box-sizing: border-box; }",
  ".h-px { height: 1px; }",
  ".h-4 { height: 1rem; }",
  ".w-4 { width: 1rem; }",
  ".h-5 { height: 1.25rem; }",
  ".w-5 { width: 1.25rem; }",
  ".shrink-0 { flex-shrink: 0; }",
  ".shadow-2xl { box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.42); }",
  ".antialiased { -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }",
  ".bg-white { background-color: #ffffff; }",
  ".text-slate-950 { color: #020617; }",
  ".bg-slate-950 { background-color: #020617; }",
  ".text-slate-100 { color: #f1f5f9; }"
].join("\n    ");

const renderDocumentStyles = (document: CanvasDocument, tailwindEnabled: boolean): string => [
  renderDocumentTokenStyles(document),
  "html, body { min-height: 100%; }",
  "html { scroll-behavior: smooth; }",
  "body { margin: 0; font-family: \"Segoe UI\", sans-serif; background: var(--surface-bg); color: var(--surface-text); }",
  ".odb-canvas-root { display: grid; gap: 32px; padding: 32px; place-items: center; }",
  ".odb-canvas-page { width: 100%; display: grid; place-items: center; }",
  ".odb-canvas-page-surface, .odb-canvas-surface { position: relative; overflow: hidden; isolation: isolate; }",
  ".odb-canvas-node { box-sizing: border-box; margin: 0; }",
  ".odb-canvas-component-button { display: inline-flex; align-items: center; justify-content: center; gap: 0.7rem; border: 0; cursor: pointer; text-align: center; }",
  ".odb-canvas-component-badge { display: inline-flex; align-items: center; gap: 0.6rem; }",
  ".odb-canvas-component-tabs { display: flex; align-items: center; padding: 4px; }",
  ".odb-canvas-tabs-trigger { display: inline-flex; align-items: center; justify-content: center; gap: 0.55rem; width: 100%; min-height: 100%; border: 0; border-radius: 999px; background: rgba(15,23,42,0.06); color: inherit; font: inherit; }",
  ".odb-canvas-component-card, .odb-canvas-component-dialog, .odb-canvas-component-motion { display: grid; gap: 0.95rem; align-content: start; }",
  ".odb-canvas-card-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.9rem; }",
  ".odb-canvas-card-title-wrap { display: grid; gap: 0.2rem; }",
  ".odb-canvas-card-title { margin: 0; font: inherit; }",
  ".odb-canvas-card-copy { display: grid; gap: 0.55rem; }",
  ".odb-canvas-card-copy p { margin: 0; font-size: 0.92em; color: inherit; opacity: 0.84; }",
  ".odb-canvas-inline-list { display: flex; flex-wrap: wrap; align-items: center; gap: 1rem; }",
  ".odb-canvas-inline-item { white-space: nowrap; }",
  ".odb-canvas-label { line-height: 1.1; }",
  ".odb-canvas-connector { border: 0; padding: 0; min-height: 2px; background: linear-gradient(90deg, transparent, rgba(15,23,42,0.24), transparent); }",
  ".odb-canvas-media-surface { display: block; border: 0; background: rgba(15,23,42,0.04); }",
  ".odb-canvas-media-image, .odb-canvas-media-video { width: 100%; height: 100%; object-fit: cover; }",
  ".odb-canvas-media-audio { width: 100%; min-height: 52px; }",
  ".odb-canvas-media-placeholder { display: inline-flex; align-items: center; justify-content: center; width: 100%; min-height: 100%; padding: 1rem; color: inherit; opacity: 0.7; font-size: 0.88rem; text-transform: capitalize; }",
  ".odb-canvas-component-button, .odb-canvas-component-card, .odb-canvas-component-dialog, .odb-canvas-component-motion, .odb-canvas-media-surface { transition: transform 160ms ease, box-shadow 160ms ease, filter 160ms ease; }",
  ".odb-canvas-component-button:hover, .odb-canvas-component-card:hover, .odb-canvas-component-dialog:hover, .odb-canvas-component-motion:hover, .odb-canvas-media-surface:hover { transform: translateY(-2px); filter: brightness(1.03); }",
  ".odb-canvas-icon { display: inline-flex; align-items: center; justify-content: center; width: 1.1rem; height: 1.1rem; flex: none; }",
  ".odb-canvas-icon svg { width: 100%; height: 100%; }",
  ".odb-canvas-icon-fluent { color: #dbeafe; }",
  ".odb-canvas-icon-3d { width: 1.2rem; height: 1.2rem; }",
  ".odb-canvas-icon-orb { width: 100%; height: 100%; border-radius: 50%; background: radial-gradient(circle at 30% 25%, rgba(255,255,255,0.92), rgba(255,255,255,0) 28%), linear-gradient(145deg, #7ef9e9 0%, #22c3ee 48%, #ff7aa2 100%); box-shadow: inset -8px -8px 14px rgba(7, 17, 29, 0.18), 0 6px 14px rgba(34, 195, 238, 0.32); }",
  ".odb-canvas-icon-emoji { font-size: 1rem; line-height: 1; }",
  ".odb-canvas-icon-stack { display: inline-flex; align-items: center; gap: 0.45rem; }",
  "@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } .odb-canvas-component-button, .odb-canvas-component-card, .odb-canvas-component-dialog, .odb-canvas-component-motion, .odb-canvas-media-surface { transition: none; } .odb-canvas-component-button:hover, .odb-canvas-component-card:hover, .odb-canvas-component-dialog:hover, .odb-canvas-component-motion:hover, .odb-canvas-media-surface:hover { transform: none; filter: none; } }",
  ...(tailwindEnabled ? [renderTailwindUtilityStyles()] : [])
].join("\n    ");

export function renderCanvasDocumentHtml(document: CanvasDocument, options: RenderHtmlOptions = {}): string {
  const tailwindEnabled = resolveCanvasLibraryPolicy(document).styling.includes(TAILWIND_STYLING_LIBRARY);
  const activeModeId = readActiveTokenModeId(document);
  const pageFilter = options.pageIds && options.pageIds.length > 0
    ? new Set(options.pageIds)
    : null;
  const pages = document.pages
    .filter((page) => !pageFilter || pageFilter.has(page.id))
    .map((page) => emitHtml(buildPageElement(document, page)))
    .join("\n");
  const libraryAttrs = renderLibraryAttributes(document);
  const rootAttrs = renderRootAttributes({
    ...(activeModeId ? { "data-token-mode": activeModeId, "data-theme": activeModeId } : {}),
    ...(options.rootAttributes ?? {})
  });
  const rootClasses = appendUtilityClasses(["odb-canvas-root"], tailwindEnabled, ["min-h-screen", "w-full", "bg-white", "text-slate-950", "antialiased"]).join(" ");
  return [
    "<!doctype html>",
    "<html lang=\"en\">",
    "<head>",
    "  <meta charset=\"utf-8\" />",
    "  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />",
    ...(options.baseHref ? [`  <base href="${escapeHtml(options.baseHref)}" />`] : []),
    `  <title>${escapeHtml(document.title)}</title>`,
    "  <style>",
    `    ${renderDocumentStyles(document, tailwindEnabled)}`,
    "  </style>",
    "</head>",
    "<body>",
    `  <main class=\"${rootClasses}\" data-document-id=\"${escapeHtml(document.documentId)}\"${libraryAttrs}${rootAttrs}>`,
    pages,
    "  </main>",
    "</body>",
    "</html>"
  ].join("\n");
}

export function renderCanvasDocumentComponent(document: CanvasDocument): string {
  const tailwindEnabled = resolveCanvasLibraryPolicy(document).styling.includes(TAILWIND_STYLING_LIBRARY);
  const activeModeId = readActiveTokenModeId(document);
  const pages = document.pages.map((page) => emitTsx(buildPageElement(document, page), 2)).join("\n");
  const libraryAttrs = renderLibraryAttributes(document);
  const tokenAttrs = activeModeId ? ` data-token-mode="${escapeHtml(activeModeId)}" data-theme="${escapeHtml(activeModeId)}"` : "";
  const rootClasses = appendUtilityClasses(["odb-canvas-root"], tailwindEnabled, ["min-h-screen", "w-full", "bg-white", "text-slate-950", "antialiased"]).join(" ");
  return [
    "export function OpenDevBrowserCanvasDocument() {",
    "  return (",
    `    <main className=\"${rootClasses}\" data-document-id=\"${escapeHtml(document.documentId)}\"${libraryAttrs}${tokenAttrs}>`,
    pages,
    "    </main>",
    "  );",
    "}",
    ""
  ].join("\n");
}

export function renderCanvasBindingHtml(document: CanvasDocument, bindingId: string): string | null {
  const binding = document.bindings.find((entry) => entry.id === bindingId);
  if (!binding) {
    return null;
  }
  const page = document.pages.find((entry) => entry.nodes.some((node) => node.id === binding.nodeId));
  if (!page) {
    return null;
  }
  const context = buildContext(document, page);
  const root = buildNodeElement(document, context, binding.nodeId, null, true);
  return emitHtml(root as RenderElement);
}

export function buildCanvasParityArtifact(
  document: CanvasDocument,
  bindingId: string,
  projection: CanvasParityArtifact["projection"]
): CanvasParityArtifact | null {
  const binding = document.bindings.find((entry) => entry.id === bindingId);
  if (!binding) {
    return null;
  }
  const nodeById = new Map(document.pages.flatMap((page) => page.nodes.map((node) => [node.id, node] as const)));
  const rootNode = nodeById.get(binding.nodeId);
  if (!rootNode) {
    return null;
  }
  const orderedNodes = collectBindingNodes(nodeById, rootNode.id);
  const nodes = orderedNodes.map((node) => ({
    nodeId: node.id,
    bindingId,
    text: readNodeText(node),
    childOrderHash: node.childIds.join("|"),
    attributes: {
      "data-node-id": node.id,
      ...(typeof node.bindingRefs.primary === "string" ? { "data-binding-id": node.bindingRefs.primary } : {})
    },
    styleProjection: Object.fromEntries(
      Object.entries(node.style)
        .filter(([, value]) => typeof value === "string" || typeof value === "number")
        .map(([key, value]) => [key, String(value)])
    )
  }));
  return {
    projection,
    rootBindingId: bindingId,
    capturedAt: new Date().toISOString(),
    hierarchyHash: orderedNodes.map((node) => `${node.id}:${node.childIds.join(",")}`).join("|"),
    nodes
  };
}

function collectBindingNodes(nodeById: Map<string, CanvasNode>, nodeId: string): CanvasNode[] {
  const node = nodeById.get(nodeId);
  if (!node) {
    return [];
  }
  return [node, ...node.childIds.flatMap((childId) => collectBindingNodes(nodeById, childId))];
}
