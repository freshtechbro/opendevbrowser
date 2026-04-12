#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { localChromeCandidates } from "./chrome-binary.mjs";
import {
  STORE_ASSET_SPECS,
  sortExtensionCaptureCandidates
} from "./store-assets-shared.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "extension/store-assets");
const EXTENSION_DIR = path.join(ROOT, "extension");
const ICON_PATH = path.join(ROOT, "extension/icons/icon128.png");
const CAPTURE_VIEWPORT = { width: 1440, height: 1000 };
const COMPOSITION_DELAY_MS = 1400;
const EXTENSION_WAIT_MS = 15000;
const STATUS_SELECTOR = "#status";
const TOGGLE_SELECTOR = "#toggle";
const CANVAS_TITLE = "OpenDevBrowser Canvas";

const COLORS = {
  bgDeep: "#060910",
  bgSurface: "#0b1220",
  panel: "rgba(12, 20, 33, 0.74)",
  panelStrong: "rgba(15, 24, 40, 0.86)",
  stroke: "rgba(255, 255, 255, 0.12)",
  strokeStrong: "rgba(255, 255, 255, 0.2)",
  text: "#e8edf6",
  muted: "#9aa6bd",
  accent: "#20d5c6",
  accentBright: "#6ee7ff",
  accentSoft: "rgba(32, 213, 198, 0.22)",
  success: "#18c39b",
  warn: "#f2c45d",
  off: "#6c7b90",
  danger: "#f16b4e"
};

const FONT_STACK = "\"Space Grotesk\", \"Manrope\", \"Sora\", \"Avenir Next\", \"Segoe UI\", sans-serif";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}

function base64DataUri(filePath, mimeType = "image/png") {
  const data = fs.readFileSync(filePath).toString("base64");
  return `data:${mimeType};base64,${data}`;
}

function iconDataUri() {
  return base64DataUri(ICON_PATH);
}

function isEntryPoint(metaUrl) {
  return metaUrl === `file://${process.argv[1]}`;
}

function captureBinary() {
  const candidate = sortExtensionCaptureCandidates(localChromeCandidates())
    .find((entry) => fs.existsSync(entry));
  if (!candidate) {
    throw new Error("Chrome for Testing or Chromium is required to regenerate store assets.");
  }
  return candidate;
}

function removeIfPresent(targetPath) {
  if (targetPath && fs.existsSync(targetPath)) {
    fs.rmSync(targetPath, { force: true, recursive: true });
  }
}

function tempPath(name, extension) {
  return path.join(os.tmpdir(), `odb-store-${process.pid}-${Date.now()}-${name}.${extension}`);
}

function writeTempHtml(name, html) {
  const filePath = tempPath(name, "html");
  fs.writeFileSync(filePath, html);
  return filePath;
}

async function renderHtmlPng(browser, filename, width, height, html) {
  const tempHtml = writeTempHtml(filename.replaceAll(".", "-"), html);
  const outputPath = path.join(OUT_DIR, filename);
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1
  });
  const page = await context.newPage();
  try {
    await page.goto(`file://${tempHtml}`, { waitUntil: "domcontentloaded" });
    await sleep(COMPOSITION_DELAY_MS);
    await page.screenshot({ path: outputPath, type: "png" });
  } finally {
    await context.close();
    removeIfPresent(tempHtml);
  }
}

function assetCss(width, height) {
  return `
    :root {
      color-scheme: dark;
      --bg-deep: ${COLORS.bgDeep};
      --bg-surface: ${COLORS.bgSurface};
      --panel: ${COLORS.panel};
      --panel-strong: ${COLORS.panelStrong};
      --stroke: ${COLORS.stroke};
      --stroke-strong: ${COLORS.strokeStrong};
      --text: ${COLORS.text};
      --muted: ${COLORS.muted};
      --accent: ${COLORS.accent};
      --accent-2: ${COLORS.accentBright};
      --accent-soft: ${COLORS.accentSoft};
      --success: ${COLORS.success};
      --warn: ${COLORS.warn};
      --off: ${COLORS.off};
      --danger: ${COLORS.danger};
      --font-sans: ${FONT_STACK};
    }

    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      width: ${width}px;
      height: ${height}px;
      overflow: hidden;
      background: var(--bg-deep);
      color: var(--text);
      font-family: var(--font-sans);
    }

    body {
      position: relative;
      background:
        radial-gradient(circle at 14% 16%, rgba(32, 213, 198, 0.16), transparent 28%),
        radial-gradient(circle at 88% 4%, rgba(110, 231, 255, 0.18), transparent 30%),
        linear-gradient(160deg, var(--bg-deep) 0%, var(--bg-surface) 100%);
    }

    body::before {
      content: "";
      position: absolute;
      inset: 0;
      background:
        linear-gradient(115deg, rgba(255, 255, 255, 0.03) 0%, transparent 36%),
        linear-gradient(300deg, rgba(32, 213, 198, 0.08) 0%, transparent 40%);
      pointer-events: none;
    }

    .asset {
      position: relative;
      width: 100%;
      height: 100%;
      padding: 40px;
      overflow: hidden;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 14px;
    }

    .brand img {
      width: 38px;
      height: 38px;
      display: block;
      filter: drop-shadow(0 0 14px rgba(32, 213, 198, 0.35));
    }

    .brand-copy {
      display: grid;
      gap: 4px;
    }

    .brand-title {
      font-size: 15px;
      letter-spacing: 0.24em;
      color: var(--muted);
      text-transform: uppercase;
    }

    .brand-subtitle {
      font-size: 34px;
      font-weight: 700;
      line-height: 1;
    }

    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      padding: 10px 16px;
      border-radius: 999px;
      border: 1px solid var(--stroke-strong);
      background: rgba(255, 255, 255, 0.06);
      font-size: 14px;
      color: var(--muted);
    }

    .status-badge::before {
      content: "";
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: var(--danger);
      box-shadow: 0 0 10px rgba(241, 107, 78, 0.4);
    }

    .status-badge.connected {
      color: var(--text);
      border-color: rgba(32, 213, 198, 0.55);
      background: rgba(32, 213, 198, 0.15);
    }

    .status-badge.connected::before {
      background: var(--accent);
      box-shadow: 0 0 14px rgba(32, 213, 198, 0.55);
    }

    .eyebrow {
      margin: 0;
      font-size: 13px;
      letter-spacing: 0.24em;
      color: var(--muted);
      text-transform: uppercase;
    }

    .hero-title {
      margin: 0;
      font-size: 54px;
      line-height: 1.02;
      letter-spacing: -0.04em;
    }

    .hero-copy {
      margin: 0;
      font-size: 19px;
      line-height: 1.55;
      color: var(--muted);
      max-width: 520px;
    }

    .surface-grid {
      display: grid;
      gap: 24px;
      align-items: center;
    }

    .surface-grid.two-col {
      grid-template-columns: minmax(0, 640px) minmax(0, 1fr);
    }

    .surface-grid.demo-col {
      grid-template-columns: minmax(0, 420px) minmax(0, 1fr);
    }

    .copy-stack {
      display: grid;
      gap: 18px;
    }

    .card {
      position: relative;
      border-radius: 30px;
      border: 1px solid var(--stroke);
      background: var(--panel);
      box-shadow: 0 24px 60px rgba(3, 8, 18, 0.42);
      backdrop-filter: blur(18px) saturate(120%);
      overflow: hidden;
    }

    .card::before {
      content: "";
      position: absolute;
      inset: 0;
      border-radius: inherit;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12);
      pointer-events: none;
    }

    .browser-shell {
      position: relative;
      padding: 22px 22px 24px;
      background: rgba(4, 8, 16, 0.42);
    }

    .browser-topbar {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 16px;
    }

    .browser-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.16);
    }

    .browser-address {
      flex: 1 1 auto;
      height: 36px;
      border-radius: 999px;
      border: 1px solid var(--stroke);
      background: rgba(255, 255, 255, 0.05);
      color: var(--muted);
      font-size: 13px;
      display: flex;
      align-items: center;
      padding: 0 16px;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }

    .shot {
      width: 100%;
      display: block;
      border-radius: 20px;
      border: 1px solid rgba(255, 255, 255, 0.08);
      background: rgba(255, 255, 255, 0.04);
    }

    .shot-popup {
      max-height: 620px;
      object-fit: contain;
    }

    .shot-canvas {
      height: 476px;
      object-fit: cover;
      object-position: top center;
    }

    .panel-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 16px;
    }

    .info-panel {
      padding: 18px 20px;
      border-radius: 22px;
      border: 1px solid var(--stroke);
      background: rgba(255, 255, 255, 0.04);
      display: grid;
      gap: 10px;
    }

    .info-title {
      margin: 0;
      font-size: 15px;
      letter-spacing: 0.16em;
      color: var(--muted);
      text-transform: uppercase;
    }

    .info-copy {
      margin: 0;
      font-size: 16px;
      line-height: 1.45;
      color: var(--text);
    }

    .chip-row {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
    }

    .chip {
      padding: 10px 14px;
      border-radius: 999px;
      border: 1px solid var(--stroke);
      background: rgba(255, 255, 255, 0.04);
      font-size: 13px;
      color: var(--text);
    }

    .ghost-surface {
      position: absolute;
      inset: auto auto 28px -60px;
      width: 420px;
      opacity: 0.18;
      filter: blur(8px);
      transform: rotate(-6deg);
      pointer-events: none;
    }

    .ghost-surface.right {
      inset: 92px -110px auto auto;
      width: 500px;
      transform: rotate(8deg);
    }

    .floating-popup {
      position: absolute;
      right: 34px;
      bottom: 34px;
      width: 420px;
      padding: 16px;
      border-radius: 26px;
      border: 1px solid rgba(32, 213, 198, 0.24);
      background: rgba(4, 12, 22, 0.76);
      box-shadow: 0 26px 54px rgba(3, 8, 18, 0.5);
      backdrop-filter: blur(18px);
    }

    .floating-popup .shot {
      max-height: 420px;
      object-fit: contain;
    }

    .compact {
      padding: 28px;
      display: grid;
      gap: 18px;
    }

    .compact .brand-title {
      font-size: 11px;
    }

    .compact .brand-subtitle {
      font-size: 25px;
    }

    .compact .hero-copy {
      font-size: 14px;
      max-width: none;
    }

    .compact-media {
      position: relative;
      min-height: 118px;
      border-radius: 22px;
      overflow: hidden;
      border: 1px solid var(--stroke);
      background: rgba(255, 255, 255, 0.03);
    }

    .compact-media img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      object-position: top center;
      display: block;
    }
  `;
}

function assetDocument(width, height, title, content) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="dark" />
    <title>${escapeHtml(title)}</title>
    <style>${assetCss(width, height)}</style>
  </head>
  <body>${content}</body>
</html>`;
}

function brandHeader(subtitle, connectedLabel) {
  const badgeClass = connectedLabel === "Connected" ? "status-badge connected" : "status-badge";
  return `
    <div class="brand">
      <img src="${iconDataUri()}" alt="OpenDevBrowser logo" />
      <div class="brand-copy">
        <div class="brand-title">Chrome Extension</div>
        <div class="brand-subtitle">${escapeHtml(subtitle)}</div>
      </div>
    </div>
    <div class="${badgeClass}">${escapeHtml(connectedLabel)}</div>
  `;
}

function browserShell(imageSrc, address, shotClass) {
  return `
    <div class="card browser-shell">
      <div class="browser-topbar">
        <span class="browser-dot"></span>
        <span class="browser-dot"></span>
        <span class="browser-dot"></span>
        <div class="browser-address">${escapeHtml(address)}</div>
      </div>
      <img class="shot ${shotClass}" src="${imageSrc}" alt="" />
    </div>
  `;
}

function infoPanel(title, copy) {
  return `
    <section class="info-panel">
      <p class="info-title">${escapeHtml(title)}</p>
      <p class="info-copy">${escapeHtml(copy)}</p>
    </section>
  `;
}

function popupShowcaseHtml(popupSrc, connected) {
  const heading = connected ? "Live popup, current connected state." : "Live popup, current disconnected state.";
  const copy = connected
    ? "Captured from the built unpacked extension while the relay is active. Settings, diagnostics, annotation controls, and the current action button all stay visible."
    : "Captured from the same unpacked extension after a real disconnect action. The reconnect path, default settings, diagnostics, and annotation panel remain visible."
  ;
  const checklist = connected
    ? [
      ["Relay path", "Connected to the local relay on 127.0.0.1."],
      ["Current controls", "The shipped settings and diagnostics layout is shown as-is."],
      ["Action state", "The primary CTA reflects the live connected flow."]
    ]
    : [
      ["Reconnect flow", "The popup shows the real disconnected state and connect CTA."],
      ["Default setup", "Relay port and pairing controls remain visible for review."],
      ["Current layout", "Diagnostics and annotation surfaces stay visible without stale mock content."]
    ]
  ;

  return assetDocument(1280, 800, connected ? "Popup connected" : "Popup disconnected", `
    <main class="asset">
      <img class="ghost-surface" src="${popupSrc}" alt="" />
      <section class="surface-grid two-col">
        <div class="copy-stack">
          <header style="display:flex;align-items:flex-start;justify-content:space-between;gap:18px;">
            ${brandHeader("OpenDevBrowser Relay", connected ? "Connected" : "Disconnected")}
          </header>
          <p class="eyebrow">${connected ? "Current popup" : "Current reconnect flow"}</p>
          <h1 class="hero-title">${escapeHtml(heading)}</h1>
          <p class="hero-copy">${escapeHtml(copy)}</p>
          <div class="panel-grid">
            ${checklist.map(([title, panelCopy]) => infoPanel(title, panelCopy)).join("")}
          </div>
        </div>
        ${browserShell(popupSrc, connected ? "chrome-extension://.../popup.html · relay live" : "chrome-extension://.../popup.html · relay offline", "shot-popup")}
      </section>
    </main>
  `);
}

function automationShowcaseHtml(canvasSrc, popupSrc) {
  return assetDocument(1280, 800, "Extension surfaces", `
    <main class="asset">
      <img class="ghost-surface right" src="${canvasSrc}" alt="" />
      <section class="surface-grid demo-col">
        <div class="copy-stack">
          <header style="display:flex;align-items:flex-start;justify-content:space-between;gap:18px;">
            ${brandHeader("OpenDevBrowser Relay", "Connected")}
          </header>
          <p class="eyebrow">Live browser proof</p>
          <h1 class="hero-title">Current popup and extension page, captured in Chrome.</h1>
          <p class="hero-copy">This store shot uses the real built extension running in Chrome for Testing. The canvas page shows the shipped full-page surface, with the live connected popup layered in to show the relay workflow.</p>
          <div class="chip-row">
            <span class="chip">Local relay</span>
            <span class="chip">Current popup</span>
            <span class="chip">Current canvas page</span>
            <span class="chip">No fabricated mock state</span>
          </div>
        </div>
        <section class="card" style="padding:26px;min-height:720px;">
          ${browserShell(canvasSrc, "chrome-extension://.../canvas.html", "shot-canvas")}
          <div class="floating-popup">
            <img class="shot" src="${popupSrc}" alt="" />
          </div>
        </section>
      </section>
    </main>
  `);
}

function canvasShowcaseHtml(canvasSrc) {
  return assetDocument(1280, 800, "Canvas surface", `
    <main class="asset">
      <header style="display:flex;align-items:flex-start;justify-content:space-between;gap:18px;margin-bottom:26px;">
        ${brandHeader("OpenDevBrowser Canvas", "Connected")}
      </header>
      <section class="surface-grid two-col" style="grid-template-columns:minmax(0, 1fr) 320px;">
        ${browserShell(canvasSrc, "chrome-extension://.../canvas.html", "shot-canvas")}
        <div class="copy-stack">
          <p class="eyebrow">Full extension page</p>
          <h1 class="hero-title" style="font-size:42px;">Canvas runs as a real extension page in-browser.</h1>
          <p class="hero-copy" style="font-size:18px;">This shot shows the shipped canvas surface in a normal Chrome tab so store reviewers and users can see the broader extension workspace beyond the popup.</p>
          ${infoPanel("Current state", "Session summary, annotations, history, properties, typography, and preview panes are all shown from the live page capture.")}
          ${infoPanel("Design parity", "The screenshot keeps the same dark gradient, panel surfaces, and accent tokens used by the popup and annotate UI.")}
        </div>
      </section>
    </main>
  `);
}

function promoSmallHtml(popupSrc) {
  return assetDocument(440, 280, "Promo small", `
    <main class="asset compact">
      ${brandHeader("OpenDevBrowser Relay", "Connected")}
      <h1 class="hero-title" style="font-size:34px;">Attach to your current Chrome tabs.</h1>
      <p class="hero-copy">Real popup capture. Local relay. Current shipped UI.</p>
      <div class="compact-media">
        <img src="${popupSrc}" alt="" />
      </div>
    </main>
  `);
}

function promoMarqueeHtml(canvasSrc, popupSrc) {
  return assetDocument(1400, 560, "Promo marquee", `
    <main class="asset" style="padding:32px 40px;">
      <section class="surface-grid demo-col" style="grid-template-columns:minmax(0, 520px) minmax(0, 1fr);gap:28px;">
        <div class="copy-stack" style="padding-top:10px;">
          ${brandHeader("OpenDevBrowser Relay", "Connected")}
          <p class="eyebrow">Chrome extension screenshots</p>
          <h1 class="hero-title" style="font-size:60px;">Current popup and canvas surfaces, captured live.</h1>
          <p class="hero-copy">The extension reuses the local relay, current tabs, and current design tokens. These store assets come from the live built extension instead of staged mock panels.</p>
          <div class="chip-row">
            <span class="chip">Live popup</span>
            <span class="chip">Live canvas page</span>
            <span class="chip">Current icon set</span>
          </div>
        </div>
        <section class="card" style="padding:24px;min-height:496px;">
          ${browserShell(canvasSrc, "chrome-extension://.../canvas.html", "shot-canvas")}
          <div class="floating-popup" style="width:360px;bottom:26px;right:26px;">
            <img class="shot" src="${popupSrc}" alt="" />
          </div>
        </section>
      </section>
    </main>
  `);
}

function popupState(state) {
  return state === "Connected" ? "connected" : "disconnected";
}

function tempPngPath(name) {
  return tempPath(name, "png");
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function chromiumRuntime() {
  const runtime = await import("playwright-core");
  return runtime.chromium;
}

async function compositionBrowser() {
  const chromium = await chromiumRuntime();
  return chromium.launch({
    executablePath: captureBinary(),
    headless: true,
    args: ["--hide-scrollbars", "--force-device-scale-factor=1"]
  });
}

async function waitForExtensionId(context) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const serviceWorker = context.serviceWorkers()
      .find((worker) => worker.url().startsWith("chrome-extension://"));
    if (serviceWorker) {
      return serviceWorker.url().split("/")[2];
    }
    await sleep(500);
  }
  throw new Error("Extension service worker did not start. Rebuild the extension and retry.");
}

async function waitForStatus(page, expected) {
  await page.waitForFunction(
    ([selector, value]) => document.querySelector(selector)?.textContent?.trim() === value,
    [STATUS_SELECTOR, expected],
    { timeout: EXTENSION_WAIT_MS }
  );
}

async function ensureConnected(page) {
  await sleep(1600);
  const status = await page.locator(STATUS_SELECTOR).textContent();
  if (status?.trim() !== "Connected") {
    await page.locator(TOGGLE_SELECTOR).click();
  }
  try {
    await waitForStatus(page, "Connected");
  } catch {
    throw new Error("Popup never reached Connected. Start `npx opendevbrowser serve` before regenerating store assets.");
  }
}

async function capturePopupStates(context, extensionId) {
  const popupPage = await context.newPage();
  const popupUrl = `chrome-extension://${extensionId}/popup.html`;
  await popupPage.goto(popupUrl);
  await ensureConnected(popupPage);
  await sleep(1200);

  const connectedPath = tempPngPath("popup-connected");
  await popupPage.screenshot({ path: connectedPath, fullPage: true, type: "png" });

  await popupPage.locator(TOGGLE_SELECTOR).click();
  await waitForStatus(popupPage, "Disconnected");
  await sleep(1000);

  const disconnectedPath = tempPngPath("popup-disconnected");
  await popupPage.screenshot({ path: disconnectedPath, fullPage: true, type: "png" });
  await popupPage.close();

  return { connectedPath, disconnectedPath };
}

async function captureCanvasSurface(context, extensionId) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/canvas.html`);
  await page.waitForFunction(
    (expectedTitle) => document.title === expectedTitle,
    CANVAS_TITLE,
    { timeout: EXTENSION_WAIT_MS }
  );
  await sleep(2200);
  const canvasPath = tempPngPath("canvas");
  await page.screenshot({ path: canvasPath, fullPage: true, type: "png" });
  await page.close();
  return canvasPath;
}

async function captureLiveSources() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "odb-store-profile-"));
  const chromium = await chromiumRuntime();
  const context = await chromium.launchPersistentContext(userDataDir, {
    executablePath: captureBinary(),
    headless: true,
    viewport: CAPTURE_VIEWPORT,
    deviceScaleFactor: 1,
    args: [
      `--disable-extensions-except=${EXTENSION_DIR}`,
      `--load-extension=${EXTENSION_DIR}`
    ]
  });

  try {
    const extensionId = await waitForExtensionId(context);
    const popupShots = await capturePopupStates(context, extensionId);
    const canvasPath = await captureCanvasSurface(context, extensionId);
    return { ...popupShots, canvasPath };
  } finally {
    await context.close();
    removeIfPresent(userDataDir);
  }
}

async function writeAssets(liveShots) {
  const popupConnected = base64DataUri(liveShots.connectedPath);
  const popupDisconnected = base64DataUri(liveShots.disconnectedPath);
  const canvasShot = base64DataUri(liveShots.canvasPath);
  const browser = await compositionBrowser();

  try {
    await renderHtmlPng(
      browser,
      "screenshot-popup-connected.png",
      1280,
      800,
      popupShowcaseHtml(popupConnected, true)
    );
    await renderHtmlPng(
      browser,
      "screenshot-popup-disconnected.png",
      1280,
      800,
      popupShowcaseHtml(popupDisconnected, false)
    );
    await renderHtmlPng(
      browser,
      "screenshot-automation-demo.png",
      1280,
      800,
      automationShowcaseHtml(canvasShot, popupConnected)
    );
    await renderHtmlPng(
      browser,
      "screenshot-canvas.png",
      1280,
      800,
      canvasShowcaseHtml(canvasShot)
    );
    await renderHtmlPng(
      browser,
      "promo-small-440x280.png",
      440,
      280,
      promoSmallHtml(popupConnected)
    );
    await renderHtmlPng(
      browser,
      "promo-marquee-1400x560.png",
      1400,
      560,
      promoMarqueeHtml(canvasShot, popupConnected)
    );
    fs.copyFileSync(ICON_PATH, path.join(OUT_DIR, "icon-store-128.png"));
  } finally {
    await browser.close();
  }
}

function cleanupShots(liveShots) {
  removeIfPresent(liveShots.connectedPath);
  removeIfPresent(liveShots.disconnectedPath);
  removeIfPresent(liveShots.canvasPath);
}

export async function generateStoreAssets() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const liveShots = await captureLiveSources();
  try {
    await writeAssets(liveShots);
  } finally {
    cleanupShots(liveShots);
  }

  return {
    ok: true,
    outputDir: "extension/store-assets",
    files: STORE_ASSET_SPECS.map((spec) => spec.filename)
  };
}

if (isEntryPoint(import.meta.url)) {
  generateStoreAssets()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(message);
      process.exitCode = 1;
    });
}
