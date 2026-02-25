#!/usr/bin/env node

import { promises as fs } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SITE_ROOT = path.join(ROOT, "docs", "landing-prototypes", "concept1-site");
const OUT_ROOT = path.join(SITE_ROOT, "docs");
const CSS_PATH = path.join(SITE_ROOT, "assets", "docs-template.css");
const MANIFEST_PATH = path.join(SITE_ROOT, "docs-manifest.json");
const EDIT_BASE = "https://github.com/freshtechbro/opendevbrowser/edit/main/";

const CLI_SECTION_TITLES = {
  install: ["Install (default)"],
  update: ["Update"],
  uninstall: ["Uninstall"],
  help: ["Help / Version"],
  version: ["Help / Version"],
  serve: ["Serve (daemon)"],
  daemon: ["Daemon auto-start"],
  native: ["Native messaging host"],
  run: ["Run (single-shot script)"],
  artifacts: ["Artifact lifecycle cleanup"],
  launch: ["Launch"],
  connect: ["Connect"],
  disconnect: ["Disconnect"],
  status: ["Status"],
  "cookie-import": ["Cookie import"],
  "macro-resolve": ["Macro resolve"],
  goto: ["Goto"],
  wait: ["Wait"],
  snapshot: ["Snapshot"],
  click: ["Click"],
  hover: ["Hover"],
  press: ["Press"],
  check: ["Check / Uncheck"],
  uncheck: ["Check / Uncheck"],
  type: ["Type"],
  select: ["Select"],
  scroll: ["Scroll"],
  "scroll-into-view": ["Scroll into view"],
  "targets-list": ["Targets list"],
  "target-use": ["Target use"],
  "target-new": ["Target new"],
  "target-close": ["Target close"],
  page: ["Page open"],
  pages: ["Pages list"],
  "page-close": ["Page close"],
  "dom-html": ["DOM HTML"],
  "dom-text": ["DOM Text"],
  "dom-attr": ["DOM Attribute"],
  "dom-value": ["DOM Value"],
  "dom-visible": ["DOM State Checks"],
  "dom-enabled": ["DOM State Checks"],
  "dom-checked": ["DOM State Checks"],
  "clone-page": ["Clone page"],
  "clone-component": ["Clone component"],
  perf: ["Performance metrics"],
  screenshot: ["Screenshot"],
  "console-poll": ["Console poll"],
  "network-poll": ["Network poll"],
  "debug-trace-snapshot": ["Debug trace snapshot"],
  research: ["Research (`research run`)"],
  shopping: ["Shopping (`shopping run`)"],
  "product-video": ["Product presentation asset (`product-video run`)"],
  rpc: ["RPC (power-user, internal)"]
};

function asPosix(value) {
  return value.replace(/\\/g, "/");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&");
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function inlineMd(value) {
  let out = escapeHtml(value);
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  return out;
}

function markdownToHtml(markdown) {
  const lines = markdown.split(/\r?\n/);
  const html = [];
  let inCode = false;
  let codeLang = "";
  let codeLines = [];
  let list = null;

  const flushList = () => {
    if (!list) return;
    html.push(list === "ul" ? "</ul>" : "</ol>");
    list = null;
  };

  const flushCode = () => {
    const lang = codeLang ? ` class="language-${escapeHtml(codeLang)}"` : "";
    html.push(`<pre><code${lang}>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
    codeLang = "";
    codeLines = [];
  };

  for (const line of lines) {
    const fence = line.match(/^```([a-zA-Z0-9_-]*)\s*$/);
    if (fence) {
      if (inCode) {
        flushCode();
        inCode = false;
      } else {
        flushList();
        inCode = true;
        codeLang = fence[1] || "";
      }
      continue;
    }

    if (inCode) {
      codeLines.push(line);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushList();
      const level = heading[1].length;
      html.push(`<h${level}>${inlineMd(heading[2].trim())}</h${level}>`);
      continue;
    }

    const ul = line.match(/^[-*]\s+(.+)$/);
    if (ul) {
      if (list !== "ul") {
        flushList();
        html.push("<ul>");
        list = "ul";
      }
      html.push(`<li>${inlineMd(ul[1])}</li>`);
      continue;
    }

    const ol = line.match(/^\d+\.\s+(.+)$/);
    if (ol) {
      if (list !== "ol") {
        flushList();
        html.push("<ol>");
        list = "ol";
      }
      html.push(`<li>${inlineMd(ol[1])}</li>`);
      continue;
    }

    if (!line.trim()) {
      flushList();
      continue;
    }

    flushList();
    if (line.startsWith("|")) {
      html.push(`<pre><code>${escapeHtml(line)}</code></pre>`);
      continue;
    }
    html.push(`<p>${inlineMd(line.trim())}</p>`);
  }

  if (inCode) flushCode();
  flushList();
  return html.join("\n");
}

function parseSections(markdown) {
  const lines = markdown.split(/\r?\n/);
  const headings = [];
  let inCode = false;

  for (let i = 0; i < lines.length; i += 1) {
    if (/^```/.test(lines[i].trim())) {
      inCode = !inCode;
      continue;
    }
    if (inCode) continue;
    const m = lines[i].match(/^(#{1,6})\s+(.+)$/);
    if (!m) continue;
    headings.push({ level: m[1].length, title: m[2].trim(), start: i });
  }

  return headings.map((h, idx) => {
    let end = lines.length;
    for (let j = idx + 1; j < headings.length; j += 1) {
      if (headings[j].level <= h.level) {
        end = headings[j].start;
        break;
      }
    }
    const body = lines.slice(h.start + 1, end);
    return {
      ...h,
      end,
      markdown: [`${"#".repeat(h.level)} ${h.title}`, ...body].join("\n").trim(),
      content: body.join("\n").trim()
    };
  });
}

function findSection(sections, title, level) {
  return sections.find((s) => s.title === title && (level == null || s.level === level));
}

function findSectionRegex(sections, regex, level) {
  return sections.find((s) => regex.test(s.title) && (level == null || s.level === level));
}

function codeBlocks(markdown) {
  const out = [];
  const re = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
  let m = re.exec(markdown);
  while (m) {
    out.push({ lang: m[1] || "", code: m[2].trimEnd() });
    m = re.exec(markdown);
  }
  return out;
}

function pickCode(markdown, langs = ["bash", "sh", "shell", "text"]) {
  const blocks = codeBlocks(markdown);
  for (const lang of langs) {
    const hit = blocks.find((b) => b.lang.toLowerCase() === lang && b.code.trim());
    if (hit) return hit.code;
  }
  return blocks.find((b) => b.code.trim())?.code || "";
}

function clip(markdown, maxLines = 160) {
  const lines = markdown.split(/\r?\n/);
  if (lines.length <= maxLines) return markdown.trim();
  const out = lines.slice(0, maxLines);
  const fences = out.filter((line) => /^```/.test(line.trim())).length;
  if (fences % 2 === 1) out.push("```");
  return out.join("\n").trim();
}

function parseFrontmatter(markdown) {
  if (!markdown.startsWith("---\n")) return { meta: {}, body: markdown };
  const end = markdown.indexOf("\n---\n", 4);
  if (end === -1) return { meta: {}, body: markdown };
  const raw = markdown.slice(4, end);
  const meta = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([a-zA-Z0-9_-]+)\s*:\s*(.+)$/);
    if (!m) continue;
    meta[m[1]] = m[2].replace(/^"|"$/g, "").replace(/^'|'$/g, "").trim();
  }
  return { meta, body: markdown.slice(end + 5).trimStart() };
}

function parseToolRegistry(indexSource) {
  const imports = new Map();
  for (const m of indexSource.matchAll(/import\s+\{\s*(create[A-Za-z0-9]+Tool)\s*\}\s+from\s+"(\.\/[^"]+)";/g)) {
    imports.set(m[1], `${m[2]}.ts`);
  }
  const tools = [];
  for (const m of indexSource.matchAll(/(opendevbrowser_[a-z0-9_]+)\s*:\s*wrap\((create[A-Za-z0-9]+Tool)\(deps\)\)/g)) {
    const file = imports.get(m[2]);
    if (!file) throw new Error(`Missing import for ${m[2]}`);
    tools.push({
      name: m[1],
      sourcePath: asPosix(path.join("src", "tools", file.replace(/^\.\//, "")))
    });
  }
  return tools;
}

function parseToolMeta(source) {
  const desc = source.match(/description:\s*(['"`])([\s\S]*?)\1\s*,/);
  if (!desc) throw new Error("Tool description missing");
  const argsBlock = source.match(/args:\s*\{([\s\S]*?)\n\s*},\s*async execute/)?.[1] || "";
  const args = [];
  for (const m of argsBlock.matchAll(/\b([a-zA-Z0-9_]+)\s*:\s*([\s\S]*?)\.describe\((['"`])([\s\S]*?)\3\)/g)) {
    const expr = m[2];
    let type = "value";
    if (/z\.array/.test(expr)) type = "array";
    else if (/z\.string/.test(expr)) type = "string";
    else if (/z\.boolean/.test(expr)) type = "boolean";
    else if (/z\.number/.test(expr)) type = "number";
    args.push({ name: m[1], type, description: m[4].trim() });
  }
  return { description: desc[2].trim(), args };
}

function parseCliInventory(surface) {
  const lines = surface.split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith("## CLI Command Inventory"));
  const end = lines.findIndex((l, i) => i > start && l.startsWith("## Tool Inventory"));
  if (start < 0 || end < 0) throw new Error("CLI inventory parse failed");
  const commands = [];
  let category = "";
  for (let i = start + 1; i < end; i += 1) {
    const head = lines[i].match(/^###\s+(.+?)\s+\(\d+\)$/);
    if (head) {
      category = head[1].trim();
      continue;
    }
    const entry = lines[i].match(/^-\s+`([^`]+)`/);
    if (entry) commands.push({ name: entry[1], category });
  }
  return commands;
}

function commandLineMatcher(command) {
  if (command === "install") return /^npx\s+opendevbrowser(?:\s+--[^\s]+(?:\s+[^\s]+)*)?$/;
  if (command === "update") return /\bnpx\s+opendevbrowser\b.*\s--update\b/;
  if (command === "uninstall") return /\bnpx\s+opendevbrowser\b.*\s--uninstall\b/;
  if (command === "help") return /\bnpx\s+opendevbrowser\b.*\s(--help|-h)\b/;
  if (command === "version") return /\bnpx\s+opendevbrowser\b.*\s(--version|-v)\b/;
  return new RegExp(`\\bnpx\\s+opendevbrowser\\s+${escapeRegExp(command)}(?:\\s|$)`);
}

function sampleArgValue(name, type) {
  const k = name.toLowerCase();
  if (type === "boolean") return "true";
  if (type === "number") return k.includes("timeout") ? "30000" : k.includes("port") ? "8787" : "1";
  if (type === "array") return "item-a,item-b";
  if (k.includes("session")) return "session-1";
  if (k.includes("target")) return "target-1";
  if (k.includes("ref")) return "r12";
  if (k.includes("url")) return "https://example.com";
  if (k.includes("profile")) return "default";
  if (k.includes("path") || k.includes("dir") || k.includes("file")) return "/tmp/output";
  if (k.includes("token")) return "token-123";
  return "value";
}

function uniqLines(value) {
  return [...new Set(value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean))].join("\n");
}

function breadcrumb(route) {
  return route.replace(/^\/+/, "").split("/").filter(Boolean).join(" / ");
}

function outputPath(route) {
  return path.join(SITE_ROOT, route.replace(/^\/+/, ""), "index.html");
}

function editLink(sourcePath) {
  return `${EDIT_BASE}${encodeURI(sourcePath)}`;
}

function ensurePage(page) {
  if (!page.summaryMarkdown?.trim()) throw new Error(`Missing summary for ${page.route}`);
  if (!page.terminalCode?.trim()) throw new Error(`Missing terminal section for ${page.route}`);
  if (!page.sourcePaths?.length) throw new Error(`Missing sources for ${page.route}`);
}

function renderPage(page, outFile) {
  const relCss = asPosix(path.relative(path.dirname(outFile), CSS_PATH));
  const sourceLinks = page.sourcePaths
    .map((src) => `<li><a href="${editLink(src)}">${escapeHtml(src)}</a></li>`)
    .join("\n");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(page.title)} | OpenDevBrowser Docs</title>
    <link rel="stylesheet" href="${escapeHtml(relCss)}" />
  </head>
  <body>
    <main class="docs-shell">
      <header class="docs-header">
        <p class="docs-route">${escapeHtml(breadcrumb(page.route))}</p>
        <h1>${escapeHtml(page.title)}</h1>
        <a class="docs-edit" href="${editLink(page.editPath)}">Edit on GitHub</a>
      </header>
      <section class="docs-section">${markdownToHtml(page.summaryMarkdown)}</section>
      <section class="docs-section">
        <h2>Terminal</h2>
        <div class="terminal-block">
          <div class="terminal-bar"><span></span><span></span><span></span></div>
          <pre><code class="language-bash">${escapeHtml(page.terminalCode.trim())}</code></pre>
        </div>
      </section>
      <section class="docs-section">
        <h2>Sources</h2>
        <ul>${sourceLinks}</ul>
      </section>
    </main>
  </body>
</html>`;
}

async function writeCss() {
  const css = `:root { color-scheme: light; --bg: #0b1020; --panel: #101a30; --text: #dbe4ff; --muted: #a8b7d7; --link: #7dd3fc; --line: #273655; }
* { box-sizing: border-box; }
body { margin: 0; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; background: radial-gradient(circle at top, #1d2745 0%, var(--bg) 55%); color: var(--text); }
.docs-shell { max-width: 940px; margin: 0 auto; padding: 32px 20px 48px; }
.docs-header { margin-bottom: 20px; }
.docs-route { margin: 0 0 8px; color: var(--muted); font-size: 0.92rem; }
.docs-header h1 { margin: 0 0 12px; font-size: 2rem; }
.docs-edit, .docs-section a { color: var(--link); text-decoration: none; }
.docs-edit:hover, .docs-section a:hover { text-decoration: underline; }
.docs-section { margin-bottom: 16px; border: 1px solid var(--line); border-radius: 12px; background: color-mix(in oklab, var(--panel) 94%, black 6%); padding: 20px; }
.docs-section code { background: rgba(125,211,252,0.08); border: 1px solid rgba(125,211,252,0.2); border-radius: 6px; padding: 1px 6px; }
.docs-section pre { margin: 10px 0; overflow-x: auto; }
.docs-section pre code { display: block; border: 1px solid var(--line); background: #091121; border-radius: 8px; padding: 12px; }
.terminal-block { border: 1px solid var(--line); border-radius: 10px; overflow: hidden; background: #050915; }
.terminal-bar { display: flex; gap: 6px; padding: 8px 10px; border-bottom: 1px solid var(--line); background: #0f1a31; }
.terminal-bar span { width: 10px; height: 10px; border-radius: 50%; }
.terminal-bar span:nth-child(1) { background: #ef4444; }
.terminal-bar span:nth-child(2) { background: #f59e0b; }
.terminal-bar span:nth-child(3) { background: #22c55e; }
.terminal-block pre { margin: 0; }
.terminal-block code { border: 0; border-radius: 0; background: transparent; }`;
  await fs.mkdir(path.dirname(CSS_PATH), { recursive: true });
  await fs.writeFile(CSS_PATH, css, "utf8");
}

async function loadSkills() {
  const root = path.join(ROOT, "skills");
  const entries = await fs.readdir(root, { withFileTypes: true });
  const skills = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const rel = asPosix(path.join("skills", entry.name, "SKILL.md"));
    const full = path.join(ROOT, rel);
    try {
      const raw = await fs.readFile(full, "utf8");
      const { meta, body } = parseFrontmatter(raw);
      skills.push({
        name: meta.name || entry.name,
        description: meta.description || "",
        version: meta.version || "",
        sourcePath: rel,
        body,
        sections: parseSections(body),
        firstCode: pickCode(body)
      });
    } catch {
      // ignore folders without SKILL.md
    }
  }
  skills.sort((a, b) => a.name.localeCompare(b.name));
  return skills;
}

async function main() {
  const [
    readme,
    changelog,
    cliDoc,
    architecture,
    extensionDoc,
    surface,
    toolIndex,
    workflowSource,
    relayProtocol,
    skills
  ] = await Promise.all([
    fs.readFile(path.join(ROOT, "README.md"), "utf8"),
    fs.readFile(path.join(ROOT, "CHANGELOG.md"), "utf8"),
    fs.readFile(path.join(ROOT, "docs", "CLI.md"), "utf8"),
    fs.readFile(path.join(ROOT, "docs", "ARCHITECTURE.md"), "utf8"),
    fs.readFile(path.join(ROOT, "docs", "EXTENSION.md"), "utf8"),
    fs.readFile(path.join(ROOT, "docs", "SURFACE_REFERENCE.md"), "utf8"),
    fs.readFile(path.join(ROOT, "src", "tools", "index.ts"), "utf8"),
    fs.readFile(path.join(ROOT, "src", "providers", "workflows.ts"), "utf8"),
    fs.readFile(path.join(ROOT, "src", "relay", "protocol.ts"), "utf8"),
    loadSkills()
  ]);

  const readmeSections = parseSections(readme);
  const cliSections = parseSections(cliDoc);
  const architectureSections = parseSections(architecture);
  const extensionSections = parseSections(extensionDoc);
  const surfaceSections = parseSections(surface);

  const tools = parseToolRegistry(toolIndex);
  const commands = parseCliInventory(surface);
  const workflowSections = parseSections(workflowSource);

  const pages = [];
  const add = (page) => {
    ensurePage(page);
    pages.push(page);
  };

  const quickstart = findSection(readmeSections, "Quick Start", 2)?.markdown || "";
  const installation = findSection(readmeSections, "Installation", 2)?.markdown || "";
  const cliInstallation = findSection(cliSections, "Installation", 2)?.markdown || "";

  add({
    route: "/docs/quickstart",
    title: "Quickstart",
    summaryMarkdown: quickstart,
    terminalCode: pickCode(quickstart) || pickCode(cliInstallation) || "npx opendevbrowser --global",
    sourcePaths: ["README.md"],
    editPath: "README.md"
  });

  add({
    route: "/docs/installation",
    title: "Installation",
    summaryMarkdown: [clip(installation, 220), clip(cliInstallation, 140)].filter(Boolean).join("\n\n---\n\n"),
    terminalCode: pickCode([installation, cliInstallation].join("\n")) || "npx opendevbrowser --global",
    sourcePaths: ["README.md", "docs/CLI.md"],
    editPath: "docs/CLI.md"
  });

  add({
    route: "/docs/concepts/session-modes",
    title: "Concepts: Session Modes",
    summaryMarkdown: clip(findSection(architectureSections, "Session modes", 3)?.markdown || "", 180),
    terminalCode: "npx opendevbrowser launch --extension-only --wait-for-extension\nnpx opendevbrowser launch --no-extension\nnpx opendevbrowser connect --cdp-port 9222",
    sourcePaths: ["docs/ARCHITECTURE.md", "README.md"],
    editPath: "docs/ARCHITECTURE.md"
  });

  add({
    route: "/docs/concepts/snapshot-refs",
    title: "Concepts: Snapshot and Refs",
    summaryMarkdown: [
      clip(findSection(readmeSections, "Quick Start", 2)?.markdown || "", 150),
      clip(findSection(architectureSections, "Runtime flows", 2)?.markdown || "", 110)
    ].join("\n\n---\n\n"),
    terminalCode: "npx opendevbrowser snapshot --session-id session-1\nnpx opendevbrowser click --session-id session-1 --ref r12\nnpx opendevbrowser dom-text --session-id session-1 --ref r12",
    sourcePaths: ["README.md", "docs/ARCHITECTURE.md"],
    editPath: "README.md"
  });

  add({
    route: "/docs/concepts/security-model",
    title: "Concepts: Security Model",
    summaryMarkdown: clip(findSection(architectureSections, "Security controls", 2)?.markdown || "", 220),
    terminalCode: "npx opendevbrowser serve --port 8787 --token token-123\nnpx opendevbrowser status --session-id session-1 --output-format json",
    sourcePaths: ["docs/ARCHITECTURE.md", "docs/CLI.md"],
    editPath: "docs/ARCHITECTURE.md"
  });

  const toolInventory = (() => {
    const start = surface.indexOf("## Tool Inventory");
    const end = surface.indexOf("## Relay Channel Inventory");
    return surface.slice(start, end).trim();
  })();
  add({
    route: "/docs/tools/index",
    title: "Tools Index",
    summaryMarkdown: clip(toolInventory, 260),
    terminalCode: "npx opendevbrowser --help",
    sourcePaths: ["docs/SURFACE_REFERENCE.md", "src/tools/index.ts"],
    editPath: "docs/SURFACE_REFERENCE.md"
  });

  for (const tool of tools) {
    const source = await fs.readFile(path.join(ROOT, tool.sourcePath), "utf8");
    const meta = parseToolMeta(source);
    const args = meta.args.map((a) => `- \`${a.name}\` (${a.type}): ${a.description}`).join("\n");
    const sample = meta.args.slice(0, 4).map((a) => `${a.name}=${sampleArgValue(a.name, a.type)}`).join(" ");
    add({
      route: `/docs/tools/${tool.name}`,
      title: `Tool: ${tool.name}`,
      summaryMarkdown: [`# ${tool.name}`, "", meta.description, "", "## Arguments", args || "- This tool defines no runtime arguments."].join("\n"),
      terminalCode: `${tool.name}${sample ? ` ${sample}` : ""}`,
      sourcePaths: ["src/tools/index.ts", tool.sourcePath],
      editPath: tool.sourcePath
    });
  }

  const cliInventory = (() => {
    const start = surface.indexOf("## CLI Command Inventory");
    const end = surface.indexOf("## Tool Inventory");
    return surface.slice(start, end).trim();
  })();
  add({
    route: "/docs/cli/index",
    title: "CLI Index",
    summaryMarkdown: clip(cliInventory, 260),
    terminalCode: "npx opendevbrowser --help",
    sourcePaths: ["docs/SURFACE_REFERENCE.md", "docs/CLI.md"],
    editPath: "docs/SURFACE_REFERENCE.md"
  });

  const cliBlocks = codeBlocks(cliDoc);
  for (const command of commands) {
    const matcher = commandLineMatcher(command.name);
    const lines = [];
    for (const block of cliBlocks) {
      for (const line of block.code.split(/\r?\n/)) {
        const t = line.trim();
        if (!t || t.startsWith("#")) continue;
        if (matcher.test(t)) lines.push(t);
      }
    }
    const unique = [...new Set(lines)];
    const expected = CLI_SECTION_TITLES[command.name] || [];
    const section = expected.map((title) => findSection(cliSections, title, 3)).find(Boolean)
      || findSectionRegex(cliSections, new RegExp(escapeRegExp(command.name.replace(/-/g, " ")), "i"), 3);
    const summary = [`# ${command.name}`, "", `- Category: ${command.category}`];
    if (section) {
      summary.push("", clip(section.markdown, 190));
    } else {
      summary.push("", `- Source inventory entry: \`${command.name}\` in \`${command.category}\` from docs/SURFACE_REFERENCE.md.`);
      if (unique.length) {
        summary.push("", "## Extracted examples", ...unique.slice(0, 3).map((line) => `- \`${line}\``));
      }
    }
    add({
      route: `/docs/cli/${command.name}`,
      title: `CLI: ${command.name}`,
      summaryMarkdown: summary.join("\n"),
      terminalCode: unique.length ? uniqLines(unique.slice(0, 4).join("\n")) : `npx opendevbrowser ${command.name} --help`,
      sourcePaths: ["docs/SURFACE_REFERENCE.md", "docs/CLI.md"],
      editPath: section ? "docs/CLI.md" : "docs/SURFACE_REFERENCE.md"
    });
  }

  const extWhat = findSection(extensionSections, "What it does", 2)?.markdown || "";
  const extInstall = findSection(extensionSections, "Installation", 2)?.markdown || "";
  const extPair = findSection(extensionSections, "Auto-pair flow", 2)?.markdown || "";
  add({
    route: "/docs/extension/setup",
    title: "Extension Setup",
    summaryMarkdown: [clip(extWhat, 90), clip(extInstall, 140), clip(extPair, 100)].filter(Boolean).join("\n\n---\n\n"),
    terminalCode: pickCode(extInstall) || "npx opendevbrowser --full",
    sourcePaths: ["docs/EXTENSION.md"],
    editPath: "docs/EXTENSION.md"
  });

  const ops = findSection(surfaceSections, "`/ops` command names (36)", 3)?.markdown || "";
  const cdp = findSection(surfaceSections, "`/cdp` channel contract (legacy)", 3)?.markdown || "";
  const constants = [...relayProtocol.matchAll(/export const ([A-Z0-9_]+) = ([^;]+);/g)]
    .map((m) => `- \`${m[1]}\`: \`${m[2].trim()}\``)
    .join("\n");
  const envelopeRaw = relayProtocol.match(/export type OpsEnvelope =([\s\S]*?);/)?.[1] || "";
  const envelope = envelopeRaw
    .split("\n")
    .map((l) => l.replace("|", "").trim())
    .filter(Boolean)
    .map((n) => `- \`${n}\``)
    .join("\n");
  add({
    route: "/docs/extension/relay-protocol",
    title: "Extension Relay Protocol",
    summaryMarkdown: ["# Relay Protocol", "", "## Protocol constants", constants, "", "## Ops envelope types", envelope, "", clip(ops, 160), "", clip(cdp, 140)].join("\n"),
    terminalCode: "npx opendevbrowser connect --ws-endpoint ws://127.0.0.1:8787\nnpx opendevbrowser launch --extension-legacy\nnpx opendevbrowser status --output-format json",
    sourcePaths: ["src/relay/protocol.ts", "docs/SURFACE_REFERENCE.md", "docs/CLI.md"],
    editPath: "src/relay/protocol.ts"
  });

  const autoPlatform = findSection(architectureSections, "Automation platform surfaces", 3)?.markdown || "";
  const wfResearch = findSection(cliSections, "Research (`research run`)", 4)?.markdown || "";
  const wfShopping = findSection(cliSections, "Shopping (`shopping run`)", 4)?.markdown || "";
  const wfProduct = findSection(cliSections, "Product presentation asset (`product-video run`)", 4)?.markdown || "";
  const productInput = findSection(workflowSections, "ProductVideoRunInput", 3)?.markdown || "";

  add({
    route: "/docs/workflows/research",
    title: "Workflow: Research",
    summaryMarkdown: [clip(autoPlatform, 110), clip(wfResearch, 160)].filter(Boolean).join("\n\n---\n\n"),
    terminalCode: pickCode(wfResearch) || "npx opendevbrowser research run --topic \"browser automation\" --days 30 --mode compact",
    sourcePaths: ["docs/CLI.md", "docs/ARCHITECTURE.md", "src/providers/workflows.ts"],
    editPath: "docs/CLI.md"
  });

  add({
    route: "/docs/workflows/shopping",
    title: "Workflow: Shopping",
    summaryMarkdown: [clip(autoPlatform, 110), clip(wfShopping, 160)].filter(Boolean).join("\n\n---\n\n"),
    terminalCode: pickCode(wfShopping) || "npx opendevbrowser shopping run --query \"usb microphone\" --mode compact",
    sourcePaths: ["docs/CLI.md", "docs/ARCHITECTURE.md", "src/providers/workflows.ts"],
    editPath: "docs/CLI.md"
  });

  add({
    route: "/docs/workflows/product-video",
    title: "Workflow: Product Video",
    summaryMarkdown: [clip(autoPlatform, 110), clip(wfProduct, 160), clip(productInput, 80)].filter(Boolean).join("\n\n---\n\n"),
    terminalCode: pickCode(wfProduct) || "npx opendevbrowser product-video run --product-url \"https://example.com/p/1\" --include-screenshots",
    sourcePaths: ["docs/CLI.md", "docs/ARCHITECTURE.md", "src/providers/workflows.ts", "skills/opendevbrowser-product-presentation-asset/SKILL.md"],
    editPath: "docs/CLI.md"
  });

  add({
    route: "/docs/skills/overview",
    title: "Skills Overview",
    summaryMarkdown: [
      "# Skill Packs",
      "",
      ...skills.map((s) => `- \`${s.name}\` (${s.version || "version not declared"}) - ${s.description}`)
    ].join("\n"),
    terminalCode: skills.find((s) => s.firstCode)?.firstCode || "./skills/opendevbrowser-best-practices/scripts/validate-skill-assets.sh",
    sourcePaths: skills.map((s) => s.sourcePath),
    editPath: skills[0]?.sourcePath || "skills/opendevbrowser-best-practices/SKILL.md"
  });

  for (const skill of skills) {
    add({
      route: `/docs/skills/${skill.name}`,
      title: `Skill: ${skill.name}`,
      summaryMarkdown: clip(skill.body, 260),
      terminalCode: skill.firstCode || "npx opendevbrowser --help",
      sourcePaths: [skill.sourcePath],
      editPath: skill.sourcePath
    });
  }

  const best = skills.find((s) => s.name === "opendevbrowser-best-practices");
  const extractionSkill = skills.find((s) => s.name === "opendevbrowser-data-extraction");
  const loginSkill = skills.find((s) => s.name === "opendevbrowser-login-automation");
  const formSkill = skills.find((s) => s.name === "opendevbrowser-form-testing");

  const bestSections = best ? best.sections : [];
  const extractionSections = extractionSkill ? extractionSkill.sections : [];
  const loginSections = loginSkill ? loginSkill.sections : [];
  const formSections = formSkill ? formSkill.sections : [];

  add({
    route: "/docs/guides/qa-loop",
    title: "Guide: QA Loop",
    summaryMarkdown: [
      clip(findSection(bestSections, "QA Debug Workflow", 3)?.markdown || "", 130),
      clip(findSection(bestSections, "Diagnostics and Traceability", 2)?.markdown || "", 120)
    ].filter(Boolean).join("\n\n---\n\n"),
    terminalCode: pickCode(findSection(bestSections, "QA Debug Workflow", 3)?.markdown || "") || "opendevbrowser_debug_trace_snapshot sessionId=session-1",
    sourcePaths: ["skills/opendevbrowser-best-practices/SKILL.md"],
    editPath: "skills/opendevbrowser-best-practices/SKILL.md"
  });

  add({
    route: "/docs/guides/data-extraction",
    title: "Guide: Data Extraction",
    summaryMarkdown: [
      clip(findSection(extractionSections, "Extraction Planning", 2)?.markdown || "", 130),
      clip(findSection(extractionSections, "Pagination Patterns", 2)?.markdown || "", 150),
      clip(findSection(extractionSections, "Quality Gates", 2)?.markdown || "", 120)
    ].filter(Boolean).join("\n\n---\n\n"),
    terminalCode: extractionSkill?.firstCode || "./skills/opendevbrowser-data-extraction/scripts/run-extraction-workflow.sh list",
    sourcePaths: ["skills/opendevbrowser-data-extraction/SKILL.md"],
    editPath: "skills/opendevbrowser-data-extraction/SKILL.md"
  });

  add({
    route: "/docs/guides/auth-automation",
    title: "Guide: Auth Automation",
    summaryMarkdown: [
      clip(findSection(loginSections, "Challenge-Aware Flow", 2)?.markdown || "", 150),
      clip(findSection(loginSections, "MFA Pattern", 2)?.markdown || "", 120),
      clip(findSection(loginSections, "Validation Signals", 2)?.markdown || "", 100)
    ].filter(Boolean).join("\n\n---\n\n"),
    terminalCode: loginSkill?.firstCode || "./skills/opendevbrowser-login-automation/scripts/run-login-workflow.sh password",
    sourcePaths: ["skills/opendevbrowser-login-automation/SKILL.md"],
    editPath: "skills/opendevbrowser-login-automation/SKILL.md"
  });

  add({
    route: "/docs/guides/visual-qa",
    title: "Guide: Visual QA",
    summaryMarkdown: [
      clip(findSection(formSections, "Canonical Validation Flow", 2)?.markdown || "", 130),
      clip(findSection(formSections, "Accessibility Assertions", 2)?.markdown || "", 150),
      clip(findSection(formSections, "Network Correlation", 2)?.markdown || "", 120)
    ].filter(Boolean).join("\n\n---\n\n"),
    terminalCode: formSkill?.firstCode || "./skills/opendevbrowser-form-testing/scripts/run-form-workflow.sh validation",
    sourcePaths: ["skills/opendevbrowser-form-testing/SKILL.md"],
    editPath: "skills/opendevbrowser-form-testing/SKILL.md"
  });

  const cloneTool = tools.find((t) => t.name === "opendevbrowser_clone_component");
  const cloneMeta = cloneTool
    ? parseToolMeta(await fs.readFile(path.join(ROOT, cloneTool.sourcePath), "utf8"))
    : null;
  const cloneSection = findSection(cliSections, "Clone component", 3)?.markdown || "";
  add({
    route: "/docs/guides/ui-component-extraction",
    title: "Guide: UI Component Extraction",
    summaryMarkdown: ["# UI Component Extraction", "", cloneMeta ? `- ${cloneMeta.description}` : "", "", clip(cloneSection, 140)].filter(Boolean).join("\n"),
    terminalCode: pickCode(cloneSection) || "npx opendevbrowser clone-component --session-id session-1 --ref r12",
    sourcePaths: ["src/tools/clone_component.ts", "docs/CLI.md"],
    editPath: "src/tools/clone_component.ts"
  });

  add({
    route: "/docs/guides/ops-monitoring",
    title: "Guide: Ops Monitoring",
    summaryMarkdown: [
      clip(findSection(architectureSections, "Diagnostics and Traceability", 2)?.markdown || "", 130),
      clip(findSection(cliSections, "Status", 3)?.markdown || "", 90),
      clip(findSection(cliSections, "Console poll", 3)?.markdown || "", 90),
      clip(findSection(cliSections, "Network poll", 3)?.markdown || "", 90),
      clip(findSection(cliSections, "Debug trace snapshot", 3)?.markdown || "", 110)
    ].filter(Boolean).join("\n\n---\n\n"),
    terminalCode: "npx opendevbrowser status --session-id session-1 --output-format json\nnpx opendevbrowser console-poll --session-id session-1 --since-seq 0 --max 50\nnpx opendevbrowser network-poll --session-id session-1 --since-seq 0 --max 50\nnpx opendevbrowser debug-trace-snapshot --session-id session-1",
    sourcePaths: ["docs/ARCHITECTURE.md", "docs/CLI.md"],
    editPath: "docs/CLI.md"
  });

  add({
    route: "/docs/changelog",
    title: "Changelog",
    summaryMarkdown: clip(changelog, 360),
    terminalCode: pickCode(findSection(cliSections, "Update", 3)?.markdown || "") || "npx opendevbrowser --update",
    sourcePaths: ["CHANGELOG.md", "docs/CLI.md"],
    editPath: "CHANGELOG.md"
  });

  await fs.rm(OUT_ROOT, { recursive: true, force: true });
  await fs.mkdir(OUT_ROOT, { recursive: true });
  await writeCss();

  const generated = [];
  for (const page of pages) {
    const outFile = outputPath(page.route);
    await fs.mkdir(path.dirname(outFile), { recursive: true });
    await fs.writeFile(outFile, renderPage(page, outFile), "utf8");
    generated.push(asPosix(path.relative(ROOT, outFile)));
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    root: "/docs",
    sections: [
      { title: "Quickstart", route: "/docs/quickstart" },
      { title: "Installation", route: "/docs/installation" },
      {
        title: "Concepts",
        route: "/docs/concepts",
        children: [
          { title: "Session Modes", route: "/docs/concepts/session-modes" },
          { title: "Snapshot and Refs", route: "/docs/concepts/snapshot-refs" },
          { title: "Security Model", route: "/docs/concepts/security-model" }
        ]
      },
      { title: "Tools", route: "/docs/tools/index", children: tools.map((t) => ({ title: t.name, route: `/docs/tools/${t.name}` })) },
      { title: "CLI", route: "/docs/cli/index", children: commands.map((c) => ({ title: c.name, route: `/docs/cli/${c.name}` })) },
      {
        title: "Extension",
        route: "/docs/extension",
        children: [
          { title: "Setup", route: "/docs/extension/setup" },
          { title: "Relay Protocol", route: "/docs/extension/relay-protocol" }
        ]
      },
      {
        title: "Workflows",
        route: "/docs/workflows",
        children: [
          { title: "Research", route: "/docs/workflows/research" },
          { title: "Shopping", route: "/docs/workflows/shopping" },
          { title: "Product Video", route: "/docs/workflows/product-video" }
        ]
      },
      { title: "Skills", route: "/docs/skills/overview", children: skills.map((s) => ({ title: s.name, route: `/docs/skills/${s.name}` })) },
      {
        title: "Guides",
        route: "/docs/guides",
        children: [
          { title: "QA Loop", route: "/docs/guides/qa-loop" },
          { title: "Data Extraction", route: "/docs/guides/data-extraction" },
          { title: "Auth Automation", route: "/docs/guides/auth-automation" },
          { title: "Visual QA", route: "/docs/guides/visual-qa" },
          { title: "UI Component Extraction", route: "/docs/guides/ui-component-extraction" },
          { title: "Ops Monitoring", route: "/docs/guides/ops-monitoring" }
        ]
      },
      { title: "Changelog", route: "/docs/changelog" }
    ]
  };

  await fs.writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const relCss = asPosix(path.relative(ROOT, CSS_PATH));
  const relManifest = asPosix(path.relative(ROOT, MANIFEST_PATH));
  const files = [relCss, relManifest, ...generated].sort((a, b) => a.localeCompare(b));

  console.log(`Generated ${generated.length} docs pages.`);
  console.log(`Manifest: ${relManifest}`);
  console.log(`Template: ${relCss}`);
  console.log("Files:");
  for (const file of files) {
    console.log(`- ${file}`);
  }
}

main().catch((error) => {
  console.error(`docs generation failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
