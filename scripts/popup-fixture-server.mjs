#!/usr/bin/env node
import http from "node:http";
import { pathToFileURL } from "node:url";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8124;

const HELP_TEXT = [
  "Usage: node scripts/popup-fixture-server.mjs [options]",
  "",
  "Options:",
  `  --host <host>              Host to bind (default: ${DEFAULT_HOST})`,
  `  --port <port>              Port to bind (default: ${DEFAULT_PORT})`,
  "  --output-format <format>   text | json (default: text)",
  "  --quiet                    Suppress startup/shutdown logs",
  "  --help                     Show help"
].join("\n");

function renderLayout(title, body) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>${title}</title>
    <style>
      :root {
        color-scheme: light;
        font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
      }
      body {
        margin: 0;
        background: #eef4fb;
        color: #0f172a;
      }
      main {
        max-width: 760px;
        margin: 0 auto;
        padding: 48px 24px 64px;
      }
      h1 {
        margin: 0 0 12px;
        font-size: 2rem;
      }
      p {
        line-height: 1.5;
      }
      a,
      button {
        font: inherit;
      }
      a.primary-link,
      button.primary-link {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 44px;
        padding: 0 18px;
        border: 0;
        border-radius: 999px;
        background: #0f62fe;
        color: #fff;
        text-decoration: none;
        font-weight: 700;
      }
      iframe.fixture-frame {
        width: 100%;
        min-height: 140px;
        margin-top: 24px;
        border: 1px solid #93a4b8;
        border-radius: 16px;
        background: #fff;
      }
      .card {
        margin-top: 18px;
        padding: 18px;
        border-radius: 18px;
        background: #fff;
        box-shadow: 0 12px 40px rgba(15, 23, 42, 0.08);
      }
    </style>
  </head>
  <body>
    <main>
      ${body}
    </main>
  </body>
</html>`;
}

export function parseArgs(argv) {
  const options = {
    host: DEFAULT_HOST,
    port: DEFAULT_PORT,
    outputFormat: "text",
    quiet: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help") {
      console.log(HELP_TEXT);
      process.exit(0);
    }
    if (arg === "--quiet") {
      options.quiet = true;
      continue;
    }
    if (arg === "--host" || arg === "--port" || arg === "--output-format") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) {
        throw new Error(`${arg} requires a value.`);
      }
      if (arg === "--host") {
        options.host = next;
      } else if (arg === "--port") {
        const port = Number.parseInt(next, 10);
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          throw new Error(`Invalid --port value: ${next}`);
        }
        options.port = port;
      } else {
        if (next !== "text" && next !== "json") {
          throw new Error(`Unsupported --output-format value: ${next}`);
        }
        options.outputFormat = next;
      }
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

export function popupRootPage(baseUrl) {
  const frameUrl = new URL("/popup-frame.html", baseUrl);
  const popupUrl = new URL("/popup-child.html", baseUrl);
  return renderLayout(
    "Popup Root Anchor",
    `<h1>Popup Root Anchor</h1>
      <p>This fixture restores the original popup attach runbook path on a stable local host.</p>
      <a class="primary-link" id="open-popup-link" href="${popupUrl}" target="popup-window">Open Popup Window</a>
      <div class="card">
        <p>The page also keeps one iframe live so older extension builds still reveal the same frame-capture warning during diagnosis.</p>
      </div>
      <iframe class="fixture-frame" src="${frameUrl}" title="Popup Support Frame"></iframe>`
  );
}

export function popupChildPage() {
  return renderLayout(
    "Popup Child Window",
    `<h1>Popup Child Window</h1>
      <p>This is the popup target used by the extension attach and adoption runbook.</p>
      <button class="primary-link" id="close-popup" type="button">Close Popup Window</button>
      <script>
        document.getElementById("close-popup")?.addEventListener("click", () => {
          window.close();
        });
      </script>`
  );
}

export function popupFramePage() {
  return renderLayout(
    "Popup Support Frame",
    `<h1>Popup Support Frame</h1>
      <p>This iframe exists only to keep the original multi-frame diagnostic surface available.</p>`
  );
}

export function createPopupFixtureServer(options = {}) {
  const host = options.host ?? DEFAULT_HOST;
  const port = options.port ?? DEFAULT_PORT;
  const baseUrl = new URL(`http://${host}:${port}`);

  return http.createServer((request, response) => {
    const method = request.method ?? "GET";
    const url = new URL(request.url ?? "/", baseUrl);

    if (method !== "GET" && method !== "HEAD") {
      response.writeHead(405, { "content-type": "text/plain; charset=utf-8" });
      response.end("Method Not Allowed");
      return;
    }

    if (url.pathname === "/") {
      response.writeHead(302, { location: "/popup-root-anchor.html" });
      response.end();
      return;
    }

    let body;
    if (url.pathname === "/popup-root-anchor.html") {
      body = popupRootPage(baseUrl);
    } else if (url.pathname === "/popup-child.html") {
      body = popupChildPage();
    } else if (url.pathname === "/popup-frame.html") {
      body = popupFramePage();
    } else {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not Found");
      return;
    }

    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(method === "HEAD" ? undefined : body);
  });
}

function writeMessage(options, payload) {
  if (options.quiet) return;
  if (options.outputFormat === "json") {
    console.log(JSON.stringify(payload));
    return;
  }
  console.log(payload.message);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const server = createPopupFixtureServer(options);

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, resolve);
  });

  const baseUrl = `http://${options.host}:${options.port}`;
  writeMessage(options, {
    ok: true,
    host: options.host,
    port: options.port,
    baseUrl,
    message: `Popup fixture ready at ${baseUrl}/popup-root-anchor.html`
  });

  const shutdown = () => {
    server.close(() => {
      writeMessage(options, {
        ok: true,
        host: options.host,
        port: options.port,
        baseUrl,
        message: "Popup fixture stopped"
      });
      process.exit(0);
    });
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
