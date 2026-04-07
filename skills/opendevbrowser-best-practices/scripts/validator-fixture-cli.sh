#!/usr/bin/env bash
set -euo pipefail

node - "$@" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const args = process.argv.slice(2);

function fail(message) {
  console.error(message);
  process.exit(2);
}

function parseFlags(argv) {
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      flags[key] = true;
      continue;
    }
    flags[key] = next;
    index += 1;
  }
  return flags;
}

function emitText(lines) {
  process.stdout.write(`${lines.join("\n")}\n`);
}

function emitJson(payload) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function buildShoppingOffers(query) {
  return [
    {
      provider: "provider-a",
      title: `${query} Starter Pack`,
      url: "https://example.com/provider-a",
      price: { amount: 49.99, currency: "USD" },
      shipping: { amount: 0 },
      deal_score: 9,
      retrieved_at: "2026-03-23T00:00:00.000Z",
      attributes: {
        list_price: { amount: 79.99 },
        captured_at: "2026-03-23T00:00:00.000Z"
      }
    },
    {
      provider: "provider-b",
      title: `${query} Pro Bundle`,
      url: "https://example.com/provider-b",
      price: { amount: 54.5, currency: "USD" },
      shipping: { amount: 3.5 },
      deal_score: 7,
      retrieved_at: "2026-03-23T00:05:00.000Z",
      attributes: {
        list_price: { amount: 89.99 },
        captured_at: "2026-03-23T00:05:00.000Z"
      }
    },
    {
      provider: "provider-c",
      title: `${query} Everyday Kit`,
      url: "https://example.com/provider-c",
      price: { amount: 58, currency: "USD" },
      shipping: { amount: 0 },
      deal_score: 6,
      retrieved_at: "2026-03-23T00:10:00.000Z",
      attributes: {
        list_price: { amount: 72 },
        captured_at: "2026-03-23T00:10:00.000Z"
      }
    }
  ];
}

const [domain, command, ...rest] = args;
if (!domain || !command) {
  fail("Usage: validator-fixture-cli.sh <research|shopping> run [flags]");
}

const flags = parseFlags(rest);

if (domain === "research" && command === "run") {
  const topic = String(flags.topic || "fixture topic");
  const days = String(flags.days || "30");
  const mode = String(flags.mode || "context");
  const outputDir = typeof flags.outputDir === "string" ? flags.outputDir : "";
  const sourceSelection = String(flags.sourceSelection || "auto");
  const sources = String(flags.sources || "web,docs");

  if (mode === "path") {
    if (!outputDir) {
      fail("research run --mode path requires --output-dir");
    }
    const bundleDir = path.join(outputDir, "research-bundle");
    fs.mkdirSync(bundleDir, { recursive: true });
    fs.writeFileSync(
      path.join(bundleDir, "bundle-manifest.json"),
      JSON.stringify(
        {
          topic,
          days: Number(days),
          mode,
          sourceSelection,
          sources
        },
        null,
        2
      )
    );
    fs.writeFileSync(
      path.join(bundleDir, "report.md"),
      `# Research Report\n\n- Topic: ${topic}\n- Days: ${days}\n- Source selection: ${sourceSelection}\n- Sources: ${sources}\n`
    );
    fs.writeFileSync(
      path.join(bundleDir, "compact.md"),
      `# Compact Summary\n\n- Topic: ${topic}\n- Focus: ISSUE-09 pagination/result drift across sources\n`
    );
    fs.writeFileSync(
      path.join(bundleDir, "context.json"),
      JSON.stringify(
        {
          topic,
          days: Number(days),
          signals: ["ISSUE-09", "fixture-mode"]
        },
        null,
        2
      )
    );
    emitJson({ data: { path: bundleDir } });
    process.exit(0);
  }

  if (mode === "report") {
    emitText([
      "# Research Report",
      "",
      `- Topic: ${topic}`,
      `- Days: ${days}`,
      `- Source selection: ${sourceSelection}`,
      `- Sources: ${sources}`,
      "- Finding: ISSUE-09 pagination/result drift across sources"
    ]);
    process.exit(0);
  }

  if (mode === "compact") {
    emitText([
      "# Compact Summary",
      "",
      `- Topic: ${topic}`,
      "- Focus: ISSUE-09 pagination/result drift across sources"
    ]);
    process.exit(0);
  }

  emitText([
    "# Research Context",
    "",
    `- Topic: ${topic}`,
    `- Days: ${days}`,
    `- Source selection: ${sourceSelection}`,
    `- Sources: ${sources}`,
    "- Focus: ISSUE-09 pagination/result drift across sources",
    "- Last 30 days fixture response"
  ]);
  process.exit(0);
}

if (domain === "shopping" && command === "run") {
  const query = String(flags.query || "fixture query");
  const mode = String(flags.mode || "context");
  const sort = String(flags.sort || "best_deal");
  const providers = String(flags.providers || "provider-a,provider-b,provider-c");
  const payload = {
    query,
    sort,
    providers,
    offers: buildShoppingOffers(query)
  };

  if (mode === "json" || flags.outputFormat === "json") {
    emitJson(payload);
    process.exit(0);
  }

  emitText([
    "# Shopping Context",
    "",
    `- Query: ${query}`,
    `- Sort: ${sort}`,
    `- Providers: ${providers}`,
    "- Best deal: provider-a"
  ]);
  process.exit(0);
}

fail(`Unsupported fixture command: ${domain} ${command}`);
NODE
