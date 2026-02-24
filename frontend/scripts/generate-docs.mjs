import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(frontendRoot, "..");
const outDir = path.join(frontendRoot, "src", "content");
const docsOutDir = path.join(outDir, "docs-generated");

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function stripFrontMatter(markdown) {
  if (!markdown.startsWith("---\n")) {
    return markdown;
  }

  const closingFence = markdown.indexOf("\n---\n", 4);
  if (closingFence === -1) {
    return markdown;
  }

  return markdown.slice(closingFence + 5).trimStart();
}

function renderInline(value) {
  const tokens = [];
  const toToken = (html) => `@@HTML_TOKEN_${tokens.push(html) - 1}@@`;
  let rendered = value;

  rendered = rendered.replace(/`([^`]+)`/gu, (_, code) => toToken(`<code>${escapeHtml(code)}</code>`));
  rendered = rendered.replace(/\[([^\]]+)\]\(([^)\s]+)\)/gu, (_, label, href) => {
    const attrs = /^https?:\/\//u.test(href) ? ' target="_blank" rel="noreferrer"' : "";
    return toToken(`<a href="${escapeHtml(href)}"${attrs}>${escapeHtml(label)}</a>`);
  });
  rendered = rendered.replace(/\*\*([^*]+)\*\*/gu, (_, strong) => toToken(`<strong>${escapeHtml(strong)}</strong>`));
  rendered = rendered.replace(/\*([^*]+)\*/gu, (_, em) => toToken(`<em>${escapeHtml(em)}</em>`));
  rendered = escapeHtml(rendered);

  return rendered.replace(/@@HTML_TOKEN_(\d+)@@/gu, (_, index) => tokens[Number(index)] ?? "");
}

function isTableDividerLine(line) {
  return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/u.test(line);
}

function splitTableRow(line) {
  const trimmed = line.trim().replace(/^\|/u, "").replace(/\|$/u, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

function markdownToHtml(markdown) {
  const lines = stripFrontMatter(markdown).replace(/\r\n/gu, "\n").split("\n");
  const out = [];
  let listType = null;
  let inCode = false;

  const closeList = () => {
    if (listType) {
      out.push(`</${listType}>`);
      listType = null;
    }
  };

  const openList = (nextType) => {
    if (listType === nextType) {
      return;
    }
    closeList();
    out.push(`<${nextType}>`);
    listType = nextType;
  };

  const closeCode = () => {
    if (inCode) {
      out.push("</code></pre>");
      inCode = false;
    }
  };

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index] ?? "";
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (trimmed.startsWith("```") && !inCode) {
      closeList();
      inCode = true;
      out.push("<pre><code>");
      continue;
    }
    if (trimmed.startsWith("```") && inCode) {
      closeCode();
      continue;
    }
    if (inCode) {
      out.push(`${escapeHtml(line)}\n`);
      continue;
    }

    if (trimmed === "---") {
      closeList();
      continue;
    }

    if (trimmed.length === 0) {
      const nextNonEmpty = lines.slice(index + 1).find((entry) => entry.trim().length > 0)?.trim() ?? "";
      if (!/^[-*]\s+/u.test(nextNonEmpty) && !/^\d+\.\s+/u.test(nextNonEmpty)) {
        closeList();
      }
      continue;
    }

    if (trimmed.startsWith("|")) {
      const divider = lines[index + 1]?.trim() ?? "";
      if (isTableDividerLine(divider)) {
        closeList();
        const headers = splitTableRow(trimmed);
        const rows = [];
        index += 2;
        while (index < lines.length) {
          const rowLine = lines[index]?.trim() ?? "";
          if (!rowLine.startsWith("|")) {
            index -= 1;
            break;
          }
          rows.push(splitTableRow(rowLine));
          index += 1;
        }

        out.push('<div class="docs-table-wrap"><table>');
        out.push("<thead><tr>");
        for (const header of headers) {
          out.push(`<th>${renderInline(header)}</th>`);
        }
        out.push("</tr></thead>");
        if (rows.length > 0) {
          out.push("<tbody>");
          for (const row of rows) {
            out.push("<tr>");
            for (const cell of row) {
              out.push(`<td>${renderInline(cell)}</td>`);
            }
            out.push("</tr>");
          }
          out.push("</tbody>");
        }
        out.push("</table></div>");
        continue;
      }
    }

    if (trimmed.startsWith("### ")) {
      closeList();
      out.push(`<h3>${renderInline(trimmed.slice(4))}</h3>`);
      continue;
    }
    if (trimmed.startsWith("## ")) {
      closeList();
      out.push(`<h2>${renderInline(trimmed.slice(3))}</h2>`);
      continue;
    }
    if (trimmed.startsWith("# ")) {
      closeList();
      out.push(`<h1>${renderInline(trimmed.slice(2))}</h1>`);
      continue;
    }

    const unordered = /^[-*]\s+(.+)$/u.exec(trimmed);
    if (unordered) {
      openList("ul");
      out.push(`<li>${renderInline(unordered[1])}</li>`);
      continue;
    }

    const ordered = /^\d+\.\s+(.+)$/u.exec(trimmed);
    if (ordered) {
      openList("ol");
      out.push(`<li>${renderInline(ordered[1])}</li>`);
      continue;
    }

    closeList();
    out.push(`<p>${renderInline(trimmed)}</p>`);
  }

  closeList();
  closeCode();
  return out.join("\n");
}

function stripMarkdown(markdown) {
  return stripFrontMatter(markdown)
    .replace(/```[\s\S]*?```/gu, " ")
    .replace(/\|/gu, " ")
    .replace(/^\s*:?-{3,}:?\s*$/gmu, " ")
    .replace(/`([^`]+)`/gu, "$1")
    .replace(/^#{1,6}\s+/gmu, "")
    .replace(/\[([^\]]+)\]\([^\)]+\)/gu, "$1")
    .replace(/\*\*([^*]+)\*\*/gu, "$1")
    .replace(/\*([^*]+)\*/gu, "$1")
    .replace(/\s+/gu, " ")
    .trim();
}

function stripInlineMarkdown(value) {
  return value
    .replace(/`([^`]+)`/gu, "$1")
    .replace(/\[([^\]]+)\]\([^\)]+\)/gu, "$1")
    .replace(/\*\*([^*]+)\*\*/gu, "$1")
    .replace(/\*([^*]+)\*/gu, "$1")
    .replace(/<[^>]+>/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function excerpt(markdown, max = 210) {
  const plain = stripMarkdown(markdown);
  if (plain.length <= max) return plain;
  return plain.slice(0, max).trimEnd();
}

function firstSentence(value, max = 220) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const sentenceMatch = trimmed.match(/^(.+?[.!?])(?:\s|$)/u);
  const sentence = sentenceMatch ? sentenceMatch[1].trim() : trimmed;
  if (sentence.length <= max) {
    return sentence;
  }
  return sentence.slice(0, max).trimEnd();
}

function firstParagraph(markdown, max = 220) {
  const lines = stripFrontMatter(markdown).replace(/\r\n/gu, "\n").split("\n");
  const paragraphLines = [];
  let inCode = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      continue;
    }
    if (!trimmed) {
      if (paragraphLines.length > 0) break;
      continue;
    }
    if (
      trimmed === "---"
      || /^#{1,6}\s+/u.test(trimmed)
      || /^[-*]\s+/u.test(trimmed)
      || /^\d+\.\s+/u.test(trimmed)
      || trimmed.startsWith("|")
      || isTableDividerLine(trimmed)
    ) {
      if (paragraphLines.length > 0) break;
      continue;
    }

    paragraphLines.push(trimmed);
  }

  const plain = stripInlineMarkdown(paragraphLines.join(" "));
  if (!plain) {
    return excerpt(markdown, max);
  }
  return firstSentence(plain, max);
}

function sectionByHeading(markdown, heading) {
  const safe = heading.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const pattern = new RegExp(`(?:^|\\n)##\\s+${safe}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`, "u");
  const match = pattern.exec(markdown);
  return match ? match[1].trim() : "";
}

function sectionByHeadingPrefix(markdown, prefix) {
  const safe = prefix.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const pattern = new RegExp(`(?:^|\\n)##\\s+${safe}(?:\\s*\\([^\\n]*\\))?\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`, "u");
  const match = pattern.exec(markdown);
  return match ? match[1].trim() : "";
}

async function readText(relativePath) {
  return readFile(path.join(repoRoot, relativePath), "utf8");
}

function buildEditUrl(sourcePath) {
  return `https://github.com/freshtechbro/opendevbrowser/edit/main/${sourcePath}`;
}

async function collectTools() {
  const indexText = await readText("src/tools/index.ts");
  const toolNames = [...indexText.matchAll(/\b(opendevbrowser_[a-z0-9_]+)\s*:/gu)].map((match) => match[1]);
  const uniqueNames = [...new Set(toolNames)];

  const entries = [];
  for (const tool of uniqueNames) {
    const fileGuess = `src/tools/${tool.replace("opendevbrowser_", "")}.ts`;
    let sourcePath = fileGuess;
    let sourceText = "";
    try {
      sourceText = await readText(fileGuess);
    } catch {
      sourcePath = "src/tools/index.ts";
      sourceText = indexText;
    }

    const descMatch = sourceText.match(/description:\s*"([^"]+)"/u);
    const description = descMatch ? descMatch[1] : `Tool reference for ${tool}.`;
    const cliCommand = tool.replace("opendevbrowser_", "").replaceAll("_", "-");
    const isGetAttr = tool === "opendevbrowser_get_attr";

    const contentBlocks = isGetAttr
      ? [
          "## Overview",
          description,
          "## How to run",
          "1. Start a session and navigate to the target page.",
          "2. Capture a snapshot and pick the element `ref`.",
          "3. Read the attribute with either tool or CLI command.",
          "## Runtime mapping",
          `- Tool id: ${tool}`,
          `- Source: ${sourcePath}`,
          "- CLI command: `dom-attr`",
          "## Common attributes",
          [
            "| Attribute | Why it is useful |",
            "| --- | --- |",
            "| `href` | Verify destination URLs before clicking. |",
            "| `aria-label` | Confirm accessibility labels and screen-reader semantics. |",
            "| `aria-invalid` | Validate form error state after submit. |",
            "| `data-*` | Inspect app-specific state markers. |"
          ].join("\n"),
          "## Tool example",
          "```text",
          'opendevbrowser_get_attr sessionId="<session-id>" ref="r12" name="aria-label"',
          "```",
          "## CLI example",
          "```bash",
          "npx opendevbrowser launch --no-extension",
          "npx opendevbrowser goto --session-id <session-id> --url https://example.com/form",
          "npx opendevbrowser snapshot --session-id <session-id>",
          "npx opendevbrowser dom-attr --session-id <session-id> --ref r12 --attr aria-invalid",
          "```"
        ]
      : [
          "## Overview",
          description,
          "## Runtime mapping",
          `- Tool id: ${tool}`,
          `- Source: ${sourcePath}`,
          `- Suggested CLI surface: ${cliCommand}`,
          "## Example",
          "```bash",
          `npx opendevbrowser ${cliCommand} --help`,
          "```"
        ];

    entries.push({
      category: "tools",
      slug: tool,
      title: tool,
      summary: description,
      sourcePath,
      editUrl: buildEditUrl(sourcePath),
      contentHtml: markdownToHtml(contentBlocks.join("\n\n")),
      codeSample: isGetAttr
        ? `npx opendevbrowser dom-attr --session-id <session-id> --ref r12 --attr aria-label`
        : `npx opendevbrowser ${cliCommand} --help`
    });
  }

  return entries;
}

async function collectCliCommands() {
  const surface = await readText("docs/SURFACE_REFERENCE.md");
  const cliBlock = sectionByHeadingPrefix(surface, "CLI Command Inventory");
  const commands = [...cliBlock.matchAll(/-\s+`([^`]+)`/gu)].map((match) => match[1]);
  const uniqueCommands = [...new Set(commands)];
  const cliDoc = await readText("docs/CLI.md");

  const entries = [];
  for (const command of uniqueCommands) {
    const headingPattern = new RegExp(`^###\\s+[^\\n]*\\b${command.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}[^\\n]*$`, "gmi");
    const headingMatch = headingPattern.exec(cliDoc);
    let detail = `Command reference for ${command}.`;
    if (headingMatch) {
      const sectionPattern = new RegExp(`${headingMatch[0].replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}([\\s\\S]*?)(?=^###\\s+|^##\\s+|$)`, "gmi");
      const section = sectionPattern.exec(cliDoc);
      if (section?.[1]) {
        detail = firstParagraph(section[1], 360);
      }
    }

    entries.push({
      category: "cli",
      slug: command,
      title: command,
      summary: detail,
      sourcePath: "docs/CLI.md",
      editUrl: buildEditUrl("docs/CLI.md"),
      contentHtml: markdownToHtml([
        "## Overview",
        detail,
        "## Command",
        `- Name: ${command}`,
        "- Source: docs/CLI.md",
        "## Example",
        "```bash",
        `npx opendevbrowser ${command} --help`,
        "```"
      ].join("\n\n")),
      codeSample: `npx opendevbrowser ${command} --help`
    });
  }

  return entries;
}

async function collectSkills() {
  const skillsRoot = path.join(repoRoot, "skills");
  const names = await readdir(skillsRoot, { withFileTypes: true });
  const entries = [];

  for (const entry of names) {
    if (!entry.isDirectory()) continue;
    const skillPath = path.join("skills", entry.name, "SKILL.md");
    try {
      const skillText = await readText(skillPath);
      const summary = firstParagraph(skillText, 220);
      entries.push({
        category: "skills",
        slug: entry.name,
        title: entry.name,
        summary,
        sourcePath: skillPath,
        editUrl: buildEditUrl(skillPath),
        contentHtml: markdownToHtml(skillText),
        codeSample: `# Skill source\ncat ${skillPath}`
      });
    } catch {
      // ignore folders without SKILL.md
    }
  }

  return entries.sort((a, b) => a.slug.localeCompare(b.slug));
}

async function collectConcepts() {
  const architecture = await readText("docs/ARCHITECTURE.md");
  const concepts = [
    {
      slug: "session-modes",
      title: "Session Modes",
      heading: "Session Modes"
    },
    {
      slug: "snapshot-refs",
      title: "Snapshot and Refs",
      heading: "Data Flow"
    },
    {
      slug: "security-model",
      title: "Security Model",
      heading: "Security"
    }
  ];

  return concepts.map((concept) => {
    const section = sectionByHeading(architecture, concept.heading) || architecture;
    return {
      category: "concepts",
      slug: concept.slug,
      title: concept.title,
      summary: excerpt(section, 220),
      sourcePath: "docs/ARCHITECTURE.md",
      editUrl: buildEditUrl("docs/ARCHITECTURE.md"),
      contentHtml: markdownToHtml(section),
      codeSample: "npx opendevbrowser status"
    };
  });
}

async function collectExtensionPages() {
  const extension = await readText("docs/EXTENSION.md");
  const setup = sectionByHeading(extension, "What it does") || extension;
  const relay = sectionByHeading(extension, "Auto-pair flow") || extension;

  return [
    {
      category: "extension",
      slug: "setup",
      title: "Extension Setup",
      summary: excerpt(setup, 220),
      sourcePath: "docs/EXTENSION.md",
      editUrl: buildEditUrl("docs/EXTENSION.md"),
      contentHtml: markdownToHtml(setup),
      codeSample: "npx opendevbrowser serve"
    },
    {
      category: "extension",
      slug: "relay-protocol",
      title: "Relay Protocol",
      summary: excerpt(relay, 220),
      sourcePath: "docs/EXTENSION.md",
      editUrl: buildEditUrl("docs/EXTENSION.md"),
      contentHtml: markdownToHtml(relay),
      codeSample: "npx opendevbrowser status --daemon --output-format json"
    }
  ];
}

async function collectWorkflowPages() {
  const cli = await readText("docs/CLI.md");
  const items = [
    { slug: "research", title: "Research Workflow", marker: "Research (`research run`)" },
    { slug: "shopping", title: "Shopping Workflow", marker: "Shopping (`shopping run`)" },
    {
      slug: "product-video",
      title: "Product Video Workflow",
      marker: "Product presentation asset (`product-video run`)"
    }
  ];

  return items.map((item) => {
    const block = sectionByHeading(cli, item.marker) || cli;
    return {
      category: "workflows",
      slug: item.slug,
      title: item.title,
      summary: excerpt(block, 220),
      sourcePath: "docs/CLI.md",
      editUrl: buildEditUrl("docs/CLI.md"),
      contentHtml: markdownToHtml(block),
      codeSample: `npx opendevbrowser ${item.slug === "product-video" ? "product-video run" : `${item.slug} run`} --help`
    };
  });
}

async function collectGuides() {
  const sourcePath = "docs/LANDING_PAGE_CONCEPT1_SPEC.md";
  const lanes = [
    {
      slug: "qa-loop",
      title: "QA Loop",
      summary: "Run repeatable browser checks with trace-backed pass/fail evidence.",
      mode: "Use managed mode for deterministic baselines, then replay in extension mode when login state affects behavior.",
      steps: [
        "Launch or connect a session and open the target page.",
        "Capture a baseline snapshot, then execute the interaction sequence by refs.",
        "Collect diagnostics with status, console, network, and trace snapshots.",
        "Capture screenshots for before/after comparison and close the session."
      ],
      verification: [
        "Every critical step reports success/failure with explicit diagnostics.",
        "Console and network logs confirm no hidden runtime regressions.",
        "Artifacts include enough evidence for independent replay."
      ],
      surfaces: [
        "`launch`, `connect`, `snapshot`, `click`, `type`, `press`",
        "`status`, `console-poll`, `network-poll`, `debug-trace-snapshot`, `perf`",
        "`screenshot`, `disconnect`"
      ],
      command: "npx opendevbrowser launch --no-extension"
    },
    {
      slug: "data-extraction",
      title: "Data Extraction",
      summary: "Extract structured page intelligence from DOM and workflow outputs.",
      mode: "Use managed mode for open pages and extension mode when extraction requires an authenticated profile.",
      steps: [
        "Navigate to the source page and capture a snapshot for stable references.",
        "Extract key values with DOM inspection commands or a workflow wrapper.",
        "Normalize outputs into JSON/markdown artifacts for downstream systems.",
        "Persist artifacts with source references for auditability."
      ],
      verification: [
        "Extracted fields are tied to deterministic refs or documented selectors.",
        "Outputs include URL/source provenance and execution metadata.",
        "Missing fields are explicit and not silently dropped."
      ],
      surfaces: [
        "`dom-html`, `dom-text`, `dom-attr`, `dom-value`",
        "`research run`, `shopping run`, `product-video run`",
        "`artifacts cleanup`"
      ],
      command: "npx opendevbrowser dom-text --help"
    },
    {
      slug: "auth-automation",
      title: "Auth Automation",
      summary: "Operate safely in logged-in sessions using extension relay controls and explicit cookie policy behavior.",
      mode: "Use extension mode for real profiles. Choose cookie policy `off|auto|required` per run based on auth requirements.",
      steps: [
        "Start in extension mode and verify relay + handshake readiness.",
        "Optionally import cookies or inspect active cookies before navigation.",
        "Run actions/workflows with `--cookie-policy` and `--use-cookies` settings that match the task.",
        "Handle `auth_required` failures deterministically and re-run after session correction."
      ],
      verification: [
        "Auth-required workflows fail fast with `reasonCode=auth_required` when policy is `required`.",
        "Cookie diagnostics expose injected/rejected/verified session details.",
        "No-auth runs keep cookie injection disabled for deterministic behavior."
      ],
      surfaces: [
        "`status`, `cookie-import`, `cookie-list`",
        "`research run`, `shopping run`, `product-video run` with cookie overrides",
        "workflow metrics: `cookie_diagnostics` / `cookieDiagnostics`"
      ],
      command: "npx opendevbrowser shopping run --query \"wireless earbuds\" --cookie-policy auto"
    },
    {
      slug: "visual-qa",
      title: "Visual QA",
      summary: "Capture screenshots and annotations for fast UI review cycles.",
      mode: "Use managed mode for public UI checks and extension mode when page state depends on an authenticated account.",
      steps: [
        "Open the target route and capture baseline screenshots.",
        "Use annotation flow to attach comments to exact elements.",
        "Export screenshots and annotation payloads for implementation handoff.",
        "Re-run after fixes and compare artifacts."
      ],
      verification: [
        "Annotations map to concrete elements and not free-form text only.",
        "Screenshot artifacts are timestamped and reproducible.",
        "Handoff includes both notes and visual evidence."
      ],
      surfaces: [
        "`screenshot`, `annotate`",
        "`snapshot`, `scroll`, `scroll-into-view`",
        "annotation docs and extension setup guides"
      ],
      command: "npx opendevbrowser annotate --help"
    },
    {
      slug: "ui-component-extraction",
      title: "UI Component Extraction",
      summary: "Clone pages/components into reusable frontend artifacts quickly.",
      mode: "Use managed mode for stable extraction. Use extension mode when component state is only available after login.",
      steps: [
        "Navigate to the component state you need and snapshot the page.",
        "Extract page or component artifacts with clone commands.",
        "Review generated output for structure, semantics, and style fidelity.",
        "Store artifacts with source route/context metadata."
      ],
      verification: [
        "Component extraction is tied to an explicit state and route.",
        "Generated output captures expected structure and key properties.",
        "Artifacts include enough context for reuse without re-scraping."
      ],
      surfaces: [
        "`clone-page`, `clone-component`",
        "`snapshot`, `dom-html`",
        "frontend route and asset references"
      ],
      command: "npx opendevbrowser clone-component --help"
    },
    {
      slug: "ops-monitoring",
      title: "Ops Monitoring",
      summary: "Diagnose regressions early with status, console, network, and perf signals.",
      mode: "Run in the same mode used by production workflows so diagnostics match real execution conditions.",
      steps: [
        "Start with daemon/session readiness checks.",
        "Run target commands or workflows and collect telemetry.",
        "Capture performance, console, and network deltas during the run.",
        "Promote failures into reproducible incident notes with command traces."
      ],
      verification: [
        "Status outputs match expected mode and connectivity state.",
        "Perf and trace output contain measurable regression signals.",
        "Failure notes contain exact commands, timestamps, and evidence links."
      ],
      surfaces: [
        "`status`, `daemon status`",
        "`console-poll`, `network-poll`, `debug-trace-snapshot`, `perf`",
        "troubleshooting and release-gate docs"
      ],
      command: "npx opendevbrowser status --output-format json"
    }
  ];

  return lanes.map((lane) => ({
    category: "guides",
    slug: lane.slug,
    title: lane.title,
    summary: lane.summary,
    sourcePath,
    editUrl: buildEditUrl(sourcePath),
    contentHtml: markdownToHtml([
      "## What this guide covers",
      lane.summary,
      "## Mode selection",
      lane.mode,
      "## Recommended run sequence",
      lane.steps.map((step) => `- ${step}`).join("\n"),
      "## Verification checkpoints",
      lane.verification.map((step) => `- ${step}`).join("\n"),
      "## Related surfaces",
      lane.surfaces.map((surface) => `- ${surface}`).join("\n")
    ].join("\n\n")),
    codeSample: lane.command
  }));
}

async function collectRootDocsPages() {
  const cli = await readText("docs/CLI.md");
  const changelog = await readText("CHANGELOG.md");

  return [
    {
      category: "quickstart",
      slug: "index",
      title: "Quickstart",
      summary: firstParagraph(cli, 220),
      sourcePath: "docs/CLI.md",
      editUrl: buildEditUrl("docs/CLI.md"),
      contentHtml: markdownToHtml(sectionByHeading(cli, "Installation") || cli),
      codeSample: "npx opendevbrowser"
    },
    {
      category: "installation",
      slug: "index",
      title: "Installation",
      summary: firstParagraph(sectionByHeading(cli, "Installation") || cli, 220),
      sourcePath: "docs/CLI.md",
      editUrl: buildEditUrl("docs/CLI.md"),
      contentHtml: markdownToHtml(sectionByHeading(cli, "Installation") || cli),
      codeSample: "npm install -g opendevbrowser"
    },
    {
      category: "changelog",
      slug: "index",
      title: "Changelog",
      summary: firstParagraph(changelog, 220),
      sourcePath: "CHANGELOG.md",
      editUrl: buildEditUrl("CHANGELOG.md"),
      contentHtml: markdownToHtml(changelog),
      codeSample: "npx opendevbrowser version"
    },
    {
      category: "tools",
      slug: "index",
      title: "Tool Surface Overview",
      summary: "Grouped view of tool surfaces, organized by session, navigation, inspection, diagnostics, and workflow layers.",
      sourcePath: "docs/SURFACE_REFERENCE.md",
      editUrl: buildEditUrl("docs/SURFACE_REFERENCE.md"),
      contentHtml: markdownToHtml(sectionByHeadingPrefix(await readText("docs/SURFACE_REFERENCE.md"), "Tool Inventory") || ""),
      codeSample: "npx opendevbrowser run --help"
    },
    {
      category: "cli",
      slug: "index",
      title: "CLI Surface Overview",
      summary: "Grouped view of command families across installation, session control, navigation, diagnostics, and workflow wrappers.",
      sourcePath: "docs/SURFACE_REFERENCE.md",
      editUrl: buildEditUrl("docs/SURFACE_REFERENCE.md"),
      contentHtml: markdownToHtml(sectionByHeadingPrefix(await readText("docs/SURFACE_REFERENCE.md"), "CLI Command Inventory") || ""),
      codeSample: "npx opendevbrowser help"
    },
    {
      category: "skills",
      slug: "overview",
      title: "Skill Packs Overview",
      summary: "How skill packs are structured, validated, and applied to repeatable OpenDevBrowser workflows.",
      sourcePath: "docs/ARCHITECTURE.md",
      editUrl: buildEditUrl("docs/ARCHITECTURE.md"),
      contentHtml: markdownToHtml([
        "## Skill packs in practice",
        "OpenDevBrowser ships with curated skill packs for repeatable, high-frequency automation workflows.",
        "## How to evaluate a pack",
        "- Validate pack assets and helper scripts before use.",
        "- Confirm command examples map to current CLI/tool surfaces.",
        "- Keep pack outputs tied to reproducible artifact paths.",
        "## Source of truth",
        "- skills/*/SKILL.md",
        "- docs/ARCHITECTURE.md",
        "- docs/CLI.md"
      ].join("\n\n")),
      codeSample: "./skills/opendevbrowser-best-practices/scripts/validate-skill-assets.sh"
    }
  ];
}

function buildManifest(pages) {
  const categoryMap = new Map();
  for (const page of pages) {
    if (!categoryMap.has(page.category)) {
      categoryMap.set(page.category, []);
    }
    categoryMap.get(page.category).push(page);
  }

  const categories = [...categoryMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([slug, entries]) => ({
      slug,
      title: slug.replace(/-/gu, " ").replace(/\b\w/gu, (char) => char.toUpperCase()),
      pages: entries
        .sort((a, b) => a.slug.localeCompare(b.slug))
        .map((entry) => ({
          slug: entry.slug,
          title: entry.title,
          route: entry.slug === "index" ? `/docs/${entry.category}` : `/docs/${entry.category}/${entry.slug}`,
          sourcePath: entry.sourcePath
        }))
    }));

  return {
    generatedAt: new Date().toISOString(),
    categories
  };
}

async function writeJson(filePath, data) {
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function main() {
  await mkdir(docsOutDir, { recursive: true });

  const [tools, cli, skills, concepts, extensionPages, workflowPages, guides, rootPages] = await Promise.all([
    collectTools(),
    collectCliCommands(),
    collectSkills(),
    collectConcepts(),
    collectExtensionPages(),
    collectWorkflowPages(),
    collectGuides(),
    collectRootDocsPages()
  ]);

  const pages = [...rootPages, ...concepts, ...tools, ...cli, ...extensionPages, ...workflowPages, ...skills, ...guides];

  const manifest = buildManifest(pages);
  const pageMap = Object.fromEntries(
    pages.map((page) => [`${page.category}/${page.slug}`, page])
  );

  const metricsDoc = await readText("docs/LANDING_METRICS_SOURCE_OF_TRUTH.md");
  const metricsRows = [...metricsDoc.matchAll(/\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|/gu)]
    .map((match) => ({
      label: match[1].trim(),
      value: match[2].trim(),
      as_of_utc: match[3].trim(),
      source_command_or_file: match[4].trim(),
      verification_owner: match[5].trim(),
      verification_status: match[6].trim(),
      verification_evidence_ref: match[7].trim()
    }))
    .filter((row) => row.label.toLowerCase() !== "label" && row.verification_status.toLowerCase() === "verified");

  const roadmapDoc = await readText("docs/OPEN_SOURCE_ROADMAP.md");
  const roadmapMilestones = [...roadmapDoc.matchAll(/\|\s*(M\d+)\s*\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|/gu)].map((match) => ({
    milestone: match[1].trim(),
    window: match[2].trim(),
    goal: match[3].trim(),
    owner: match[4].trim(),
    status: match[5].trim()
  }));

  await writeJson(path.join(docsOutDir, "pages.json"), {
    generatedAt: new Date().toISOString(),
    pages: pageMap
  });
  await writeJson(path.join(outDir, "docs-manifest.json"), manifest);
  await writeJson(path.join(outDir, "metrics.json"), { generatedAt: new Date().toISOString(), metrics: metricsRows });
  await writeJson(path.join(outDir, "roadmap.json"), { generatedAt: new Date().toISOString(), milestones: roadmapMilestones });

  console.log(`Generated ${pages.length} docs pages across ${manifest.categories.length} categories.`);
}

main().catch((error) => {
  console.error("Docs generation failed", error);
  process.exitCode = 1;
});
