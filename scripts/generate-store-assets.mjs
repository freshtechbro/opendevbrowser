#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "extension/store-assets");
const ICON_PATH = path.join(ROOT, "extension/icons/icon128.png");
const ICON_DATA_URI = `data:image/png;base64,${fs.readFileSync(ICON_PATH).toString("base64")}`;

const FONT_SANS = "'Avenir Next', 'SF Pro Display', 'Space Grotesk', 'Segoe UI', sans-serif";
const FONT_MONO = "'SFMono-Regular', 'JetBrains Mono', 'Menlo', monospace";

const colors = {
  bgA: "#06101a",
  bgB: "#0b1825",
  bgC: "#102536",
  panel: "#0d1825",
  panelAlt: "#101f30",
  panelSoft: "#132335",
  ink: "#ebf2fa",
  muted: "#a7b6c8",
  accent: "#22d4c7",
  accentBright: "#6ee7ff",
  accentSoft: "rgba(34, 212, 199, 0.17)",
  stroke: "rgba(255, 255, 255, 0.12)",
  strokeStrong: "rgba(255, 255, 255, 0.2)",
  success: "#18c39b",
  warn: "#f2c45d",
  off: "#6c7b90",
  danger: "#f17158"
};

const writeSvgPng = (filename, width, height, content) => {
  const svg = buildSvg(width, height, content);
  const tempSvg = path.join(os.tmpdir(), `odb-store-${process.pid}-${filename}.svg`);
  fs.writeFileSync(tempSvg, svg);
  execFileSync("sips", ["-s", "format", "png", tempSvg, "--out", path.join(OUT_DIR, filename)], {
    stdio: "ignore"
  });
  fs.unlinkSync(tempSvg);
};

const chromeBinary = () => {
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium"
  ];
  const match = candidates.find((candidate) => fs.existsSync(candidate));
  if (!match) {
    throw new Error("Chrome executable not found for popup screenshot generation.");
  }
  return match;
};

const renderHtmlPng = (filename, html, width = 1280, height = 800) => {
  const tempHtml = path.join(os.tmpdir(), `odb-store-${process.pid}-${filename}.html`);
  fs.writeFileSync(tempHtml, html);
  execFileSync(chromeBinary(), [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--allow-file-access-from-files",
    "--run-all-compositor-stages-before-draw",
    "--virtual-time-budget=1500",
    `--window-size=${width},${height}`,
    `--screenshot=${path.join(OUT_DIR, filename)}`,
    `file://${tempHtml}`
  ], { stdio: "ignore" });
  fs.unlinkSync(tempHtml);
};

const renderTempHtmlPng = (html, width, height) => {
  const base = `odb-store-preview-${process.pid}-${Date.now()}`;
  const tempHtml = path.join(os.tmpdir(), `${base}.html`);
  const tempPng = path.join(os.tmpdir(), `${base}.png`);
  fs.writeFileSync(tempHtml, html);
  execFileSync(chromeBinary(), [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--allow-file-access-from-files",
    "--run-all-compositor-stages-before-draw",
    "--virtual-time-budget=1500",
    `--window-size=${width},${height}`,
    `--screenshot=${tempPng}`,
    `file://${tempHtml}`
  ], { stdio: "ignore" });
  fs.unlinkSync(tempHtml);
  return tempPng;
};

function buildSvg(width, height, content) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="${width}" y2="${height}" gradientUnits="userSpaceOnUse">
      <stop stop-color="${colors.bgA}"/>
      <stop offset="0.5" stop-color="${colors.bgB}"/>
      <stop offset="1" stop-color="${colors.bgC}"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="${width}" y2="${height}" gradientUnits="userSpaceOnUse">
      <stop stop-color="${colors.accent}"/>
      <stop offset="1" stop-color="${colors.accentBright}"/>
    </linearGradient>
    <radialGradient id="orbA" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(${Math.round(width * 0.12)} ${Math.round(height * 0.18)}) rotate(45) scale(${Math.round(width * 0.32)} ${Math.round(height * 0.32)})">
      <stop stop-color="${colors.accent}" stop-opacity="0.24"/>
      <stop offset="1" stop-color="${colors.accent}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="orbB" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(${Math.round(width * 0.82)} ${Math.round(height * 0.08)}) rotate(45) scale(${Math.round(width * 0.28)} ${Math.round(height * 0.28)})">
      <stop stop-color="${colors.accentBright}" stop-opacity="0.18"/>
      <stop offset="1" stop-color="${colors.accentBright}" stop-opacity="0"/>
    </radialGradient>
    <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="18" stdDeviation="18" flood-color="#030812" flood-opacity="0.5"/>
    </filter>
    <filter id="iconGlow" x="-60%" y="-60%" width="220%" height="220%">
      <feDropShadow dx="0" dy="0" stdDeviation="10" flood-color="${colors.accent}" flood-opacity="0.38"/>
    </filter>
  </defs>
  <style>
    text { fill: ${colors.ink}; font-family: ${FONT_SANS}; }
    .eyebrow { font-size: 14px; letter-spacing: 0.28em; text-transform: uppercase; fill: ${colors.muted}; }
    .title { font-size: 30px; font-weight: 700; }
    .title-large { font-size: 48px; font-weight: 700; }
    .subtitle { font-size: 24px; fill: ${colors.muted}; }
    .copy { font-size: 18px; fill: ${colors.muted}; }
    .small { font-size: 15px; fill: ${colors.muted}; }
    .label { font-size: 13px; fill: ${colors.muted}; }
    .value { font-size: 18px; font-weight: 600; }
    .mono { font-size: 18px; font-family: ${FONT_MONO}; font-weight: 600; }
    .mono-small { font-size: 16px; font-family: ${FONT_MONO}; }
    .tiny { font-size: 12px; fill: ${colors.muted}; }
    .chip { font-size: 15px; fill: ${colors.ink}; }
    .card-title { font-size: 20px; font-weight: 600; }
    .card-copy { font-size: 15px; fill: ${colors.muted}; }
  </style>
  <rect width="${width}" height="${height}" rx="0" fill="url(#bg)"/>
  <rect width="${width}" height="${height}" fill="url(#orbA)"/>
  <rect width="${width}" height="${height}" fill="url(#orbB)"/>
  ${content}
</svg>`;
}

const esc = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll("\"", "&quot;");

const lines = (items, x, y, lineHeight, className) => items.map((item, index) => (
  `<text class="${className}" x="${x}" y="${y + (index * lineHeight)}">${esc(item)}</text>`
)).join("");

const panel = (x, y, width, height, inner, rx = 26) => (
  `<g filter="url(#softShadow)">
    <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${rx}" fill="${colors.panel}" stroke="${colors.strokeStrong}"/>
    ${inner}
  </g>`
);

const pill = (x, y, label, tone) => {
  const toneMap = {
    success: { fill: "rgba(24, 195, 155, 0.14)", stroke: "rgba(24, 195, 155, 0.45)", dot: colors.success },
    warn: { fill: "rgba(242, 196, 93, 0.14)", stroke: "rgba(242, 196, 93, 0.45)", dot: colors.warn },
    off: { fill: "rgba(108, 123, 144, 0.14)", stroke: colors.strokeStrong, dot: colors.off }
  };
  const palette = toneMap[tone];
  const width = Math.max(120, 34 + (label.length * 9));
  return `<g>
    <rect x="${x}" y="${y}" width="${width}" height="34" rx="17" fill="${palette.fill}" stroke="${palette.stroke}"/>
    <circle cx="${x + 18}" cy="${y + 17}" r="5" fill="${palette.dot}"/>
    <text x="${x + 31}" y="${y + 22}" class="small" fill="${colors.ink}">${esc(label)}</text>
  </g>`;
};

const chip = (x, y, label, width) => (
  `<g>
    <rect x="${x}" y="${y}" width="${width}" height="34" rx="17" fill="rgba(255,255,255,0.04)" stroke="${colors.stroke}"/>
    <text class="chip" x="${x + 16}" y="${y + 22}">${esc(label)}</text>
  </g>`
);

const brand = (x, y, markSize, subtitle) => `
  <g>
    <image x="${x}" y="${y}" width="${markSize}" height="${markSize}" href="${ICON_DATA_URI}" filter="url(#iconGlow)"/>
    <text class="eyebrow" x="${x + markSize + 20}" y="${y + 18}">OpenDevBrowser</text>
    <text class="small" x="${x + markSize + 20}" y="${y + 42}">${esc(subtitle)}</text>
  </g>
`;

const toggle = (x, y, enabled) => `
  <g>
    <rect x="${x}" y="${y}" width="64" height="34" rx="17" fill="${enabled ? colors.accentSoft : "rgba(255,255,255,0.06)"}" stroke="${enabled ? "rgba(34, 212, 199, 0.48)" : colors.stroke}"/>
    <circle cx="${enabled ? x + 46 : x + 18}" cy="${y + 17}" r="12" fill="${enabled ? colors.accentBright : colors.off}"/>
  </g>
`;

const field = (x, y, width, labelText, valueText, monospace = false) => `
  <g>
    <text class="label" x="${x}" y="${y}">${esc(labelText)}</text>
    <rect x="${x}" y="${y + 10}" width="${width}" height="52" rx="16" fill="${colors.panelAlt}" stroke="${colors.stroke}"/>
    <text class="${monospace ? "mono-small" : "value"}" x="${x + 16}" y="${y + 42}">${esc(valueText)}</text>
  </g>
`;

const row = (x, y, titleText, subtitleText, enabled) => `
  <g>
    <text class="value" x="${x}" y="${y + 18}" font-size="17">${esc(titleText)}</text>
    <text class="tiny" x="${x}" y="${y + 39}">${esc(subtitleText)}</text>
    ${toggle(x + 286, y + 6, enabled)}
  </g>
`;

const healthItem = (x, y, labelText, valueText, tone) => `
  <g>
    <rect x="${x}" y="${y}" width="112" height="64" rx="18" fill="${colors.panelAlt}" stroke="${colors.stroke}"/>
    <text class="tiny" x="${x + 14}" y="${y + 22}">${esc(labelText)}</text>
    ${pill(x + 12, y + 28, valueText, tone)}
  </g>
`;

const ctaButton = (x, y, width, labelText, primary = true) => `
  <g>
    <rect x="${x}" y="${y}" width="${width}" height="56" rx="18" fill="${primary ? "url(#accent)" : "rgba(255,255,255,0.04)"}" stroke="${primary ? "rgba(110, 231, 255, 0.25)" : colors.strokeStrong}"/>
    <text x="${x + (width / 2)}" y="${y + 35}" text-anchor="middle" font-size="18" font-weight="700" fill="${primary ? colors.bgA : colors.ink}" font-family="${FONT_SANS}">${esc(labelText)}</text>
  </g>
`;

const noteBlock = (x, y, width, items, accentLabel) => (
  panel(x, y, width, 184, `
    <text class="eyebrow" x="${x + 24}" y="${y + 30}">${esc(accentLabel)}</text>
    ${lines(items, x + 24, y + 70, 30, "title")}
  `, 24)
);

function automationScene() {
  return `
    ${brand(68, 48, 58, "Local relay automation in a real headed Chrome session")}
    <text class="title-large" x="68" y="176">Attach to current Chrome tabs.</text>
    <text class="subtitle" x="68" y="218">Run inspect, act, annotate, and debug loops without launching a separate browser.</text>

    ${panel(68, 266, 522, 456, `
      <text class="eyebrow" x="102" y="308">Terminal + runtime</text>
      <rect x="102" y="330" width="454" height="190" rx="22" fill="#07111c" stroke="${colors.stroke}"/>
      ${lines([
        "$ npx opendevbrowser serve",
        "Relay listening on 127.0.0.1:8787",
        "",
        "$ opendevbrowser snapshot --session-id relay-demo --format actionables",
        "Captured 412 nodes · 0 redactions",
        "Ready to click ref r12"
      ], 126, 372, 28, "mono-small")}
      ${panel(102, 548, 454, 142, `
        <text class="card-title" x="128" y="590">What the relay gives you</text>
        ${lines(["Reuse logged-in tabs", "Attach CDP over the local extension bridge", "Keep automation and annotations on-device"], 128, 620, 24, "card-copy")}
      `, 22)}
    `)}

    ${panel(634, 266, 578, 456, `
      <text class="eyebrow" x="668" y="308">Browser relay</text>
      <rect x="668" y="330" width="510" height="360" rx="24" fill="rgba(255,255,255,0.05)" stroke="${colors.stroke}"/>
      <rect x="702" y="362" width="440" height="42" rx="18" fill="rgba(255,255,255,0.08)"/>
      <text class="small" x="728" y="389">https://demo.local/dashboard</text>
      ${pill(702, 424, "Relay connected", "success")}
      ${panel(702, 468, 440, 96, `
        <text class="card-title" x="728" y="510">Session Automation</text>
        <text class="card-copy" x="728" y="540">Logged-in tab, controlled safely via local relay.</text>
      `, 18)}
      ${panel(702, 584, 440, 86, `
        <text class="card-copy" x="728" y="620">Ref r12 → Clicked “Generate Report”</text>
        <text class="small" x="728" y="646">Snapshot refreshed in 2.1s</text>
      `, 18)}
      ${ctaButton(702, 612, 440, "Run next action")}
    `)}

    ${chip(68, 740, "Local relay", 136)}
    ${chip(222, 740, "Logged-in sessions", 182)}
    ${chip(422, 740, "Annotation ready", 176)}
    ${chip(1050, 740, "opendevbrowser.dev", 190)}
  `;
}

function promoSmall() {
  return `
    ${brand(28, 28, 34, "Local Chrome relay")}
    <text class="title" x="28" y="118">Automate your</text>
    <text class="title" x="28" y="152">current Chrome tab</text>
    <text class="copy" x="28" y="186">Local relay. Secure pairing. Reuse current tabs.</text>
    ${chip(28, 222, "Local-first", 76)}
    ${chip(118, 222, "Secure pairing", 118)}
    ${chip(252, 222, "Lightning setup", 140)}
  `;
}

function promoMarquee() {
  return `
    ${brand(28, 28, 40, "Chrome extension")}
    <text class="title-large" x="28" y="254">Control your browser from OpenCode</text>
    <text class="subtitle" x="28" y="336">Attach to logged-in tabs, keep everything local, and run automation with confidence.</text>
    ${chip(28, 502, "Auto-connect", 100)}
    ${chip(138, 502, "Auto-pair tokens", 116)}
    ${chip(266, 502, "Local-only relay", 110)}
    ${chip(388, 502, "No telemetry", 94)}
  `;
}

function popupShowcaseSvg(connected, popupDataUri) {
  const eyebrow = connected ? "Connected popup" : "Disconnected popup";
  const title = connected ? ["Full live popup,", "current connected state."] : ["Current disconnected", "state, no stale shortcuts."];
  const copy = connected
    ? ["Settings, diagnostics, annotation controls,", "and the disconnect CTA all remain visible."]
    : ["Same full layout, default relay settings,", "and the connect path reviewers should see first."];
  const checklist = connected
    ? ["Status pill: Connected", "Relay note: 127.0.0.1", "Diagnostics and annotation visible"]
    : ["Status pill: Disconnected", "Default port: 8787", "Idle diagnostics still visible"];

  return `
    ${brand(58, 48, 50, "Chrome Web Store capture set")}
    ${panel(52, 132, 414, 620, `
      <image x="76" y="156" width="366" height="732" href="${popupDataUri}"/>
    `, 30)}
    ${panel(506, 132, 706, 264, `
      <text class="eyebrow" x="542" y="174">${esc(eyebrow)}</text>
      ${lines(title, 542, 238, 54, "title-large")}
      ${lines(copy, 542, 336, 38, "subtitle")}
    `, 28)}
    ${panel(506, 424, 214, 220, `
      <text class="eyebrow" x="538" y="464">Current UI</text>
      <text class="card-title" x="538" y="512">Settings panel</text>
      ${lines(["Relay port, auto-connect,", "native fallback, auto-pair,", "and token requirements."], 538, 548, 32, "card-copy")}
    `, 24)}
    ${panel(752, 424, 214, 220, `
      <text class="eyebrow" x="784" y="464">Current UI</text>
      <text class="card-title" x="784" y="512">Diagnostics</text>
      ${lines(["Relay, handshake,", "annotate, injected,", "CDP, pairing, native."], 784, 548, 32, "card-copy")}
    `, 24)}
    ${panel(998, 424, 214, 220, `
      <text class="eyebrow" x="1030" y="464">Current UI</text>
      <text class="card-title" x="1030" y="512">Annotation</text>
      ${lines(["Request field,", "annotate/copy/send,", "recent payload items."], 1030, 548, 32, "card-copy")}
    `, 24)}
    ${panel(506, 670, 706, 82, `
      <text class="eyebrow" x="542" y="710">Reviewer checklist</text>
      ${checklist.map((item, index) => (
        `<circle cx="${548 + (index * 228)}" cy="735" r="5" fill="${colors.accent}"/>
         <text class="small" x="${562 + (index * 228)}" y="740">${esc(item)}</text>`
      )).join("")}
    `, 24)}
  `;
}

function popupPreviewDocument(connected) {
  const popupHtml = fs.readFileSync(path.join(ROOT, "extension/popup.html"), "utf8");
  const styleMatch = popupHtml.match(/<style>([\s\S]*?)<\/style>/);
  const bodyMatch = popupHtml.match(/<body>([\s\S]*?)<script type="module" src="dist\/popup\.js"><\/script>\s*<\/body>/);
  if (!styleMatch || !bodyMatch) {
    throw new Error("Unable to extract popup template.");
  }

  const statusScript = connected ? `
    document.getElementById("status").textContent = "Connected";
    document.getElementById("toggle").textContent = "Disconnect";
    document.getElementById("statusIndicator").classList.add("connected");
    document.getElementById("statusPill").classList.add("connected");
    document.getElementById("statusNote").textContent = "Connected to 127.0.0.1:8787";
    document.getElementById("healthRelay").textContent = "Online";
    document.getElementById("healthRelay").dataset.tone = "ok";
    document.getElementById("healthHandshake").textContent = "Complete";
    document.getElementById("healthHandshake").dataset.tone = "ok";
    document.getElementById("healthAnnotation").textContent = "Idle";
    document.getElementById("healthAnnotation").dataset.tone = "off";
    document.getElementById("healthInjected").textContent = "Injected";
    document.getElementById("healthInjected").dataset.tone = "ok";
    document.getElementById("healthCdp").textContent = "Active";
    document.getElementById("healthCdp").dataset.tone = "ok";
    document.getElementById("healthPairing").textContent = "Required";
    document.getElementById("healthPairing").dataset.tone = "warn";
    document.getElementById("healthNative").textContent = "Disabled";
    document.getElementById("healthNative").dataset.tone = "off";
    document.getElementById("healthNote").textContent = "Relay health OK.";
    document.getElementById("annotationContext").value = "Review login handoff flow";
    document.getElementById("annotationNote").textContent = "Last annotation: 2 items on demo.local.";
    document.getElementById("annotationCopy").disabled = false;
    document.getElementById("annotationSend").disabled = false;
    document.getElementById("annotationItems").innerHTML = [
      '<div class="annotation-item"><div class="annotation-item-summary">Primary CTA button · 220x54</div><div class="annotation-item-meta">Action target on https://demo.local</div><div class="annotation-item-actions"><button class="secondary">Copy</button><button class="secondary">Send</button></div></div>',
      '<div class="annotation-item"><div class="annotation-item-summary">Sidebar account switcher · 180x72</div><div class="annotation-item-meta">State preserved in current tab</div><div class="annotation-item-actions"><button class="secondary">Copy</button><button class="secondary">Send</button></div></div>'
    ].join("");
  ` : `
    document.getElementById("status").textContent = "Disconnected";
    document.getElementById("toggle").textContent = "Connect";
    document.getElementById("statusIndicator").classList.remove("connected");
    document.getElementById("statusPill").classList.remove("connected");
    document.getElementById("statusNote").textContent = "Local relay only. Page data and tokens stay on-device.";
    document.getElementById("healthRelay").textContent = "Offline";
    document.getElementById("healthRelay").dataset.tone = "off";
    document.getElementById("healthHandshake").textContent = "Idle";
    document.getElementById("healthHandshake").dataset.tone = "off";
    document.getElementById("healthAnnotation").textContent = "Idle";
    document.getElementById("healthAnnotation").dataset.tone = "off";
    document.getElementById("healthInjected").textContent = "Unknown";
    document.getElementById("healthInjected").dataset.tone = "off";
    document.getElementById("healthCdp").textContent = "Idle";
    document.getElementById("healthCdp").dataset.tone = "off";
    document.getElementById("healthPairing").textContent = "Required";
    document.getElementById("healthPairing").dataset.tone = "warn";
    document.getElementById("healthNative").textContent = "Disabled";
    document.getElementById("healthNative").dataset.tone = "off";
    document.getElementById("healthNote").textContent = "Relay down. Start the daemon and retry.";
    document.getElementById("annotationContext").value = "";
    document.getElementById("annotationNote").textContent = "No annotations captured yet.";
    document.getElementById("annotationCopy").disabled = true;
    document.getElementById("annotationSend").disabled = true;
  `;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <style>
      ${styleMatch[1]}
      html, body {
        width: 430px;
        height: 1400px;
        overflow: hidden;
      }
      body {
        margin: 0;
        width: 430px;
        height: 1400px;
        overflow: hidden;
      }
      .app {
        transform: scale(0.56);
        transform-origin: top left;
        width: 650px;
      }
    </style>
  </head>
  <body>
    ${bodyMatch[1]}
    <script>
      document.getElementById("relayPort").value = "8787";
      document.getElementById("pairingToken").value = "";
      document.getElementById("autoConnect").checked = true;
      document.getElementById("autoPair").checked = true;
      document.getElementById("pairingEnabled").checked = true;
      document.getElementById("nativeEnabled").checked = false;
      ${statusScript}
    </script>
  </body>
</html>`;
}

function createAssets() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.copyFileSync(ICON_PATH, path.join(OUT_DIR, "icon-store-128.png"));
  const connectedPreviewPath = renderTempHtmlPng(popupPreviewDocument(true), 430, 1400);
  const disconnectedPreviewPath = renderTempHtmlPng(popupPreviewDocument(false), 430, 1400);
  const connectedPreview = `data:image/png;base64,${fs.readFileSync(connectedPreviewPath).toString("base64")}`;
  const disconnectedPreview = `data:image/png;base64,${fs.readFileSync(disconnectedPreviewPath).toString("base64")}`;
  fs.unlinkSync(connectedPreviewPath);
  fs.unlinkSync(disconnectedPreviewPath);
  writeSvgPng("screenshot-popup-connected.png", 1280, 800, popupShowcaseSvg(true, connectedPreview));
  writeSvgPng("screenshot-popup-disconnected.png", 1280, 800, popupShowcaseSvg(false, disconnectedPreview));
  writeSvgPng("screenshot-automation-demo.png", 1280, 800, automationScene());
  writeSvgPng("promo-small-440x280.png", 440, 280, promoSmall());
  writeSvgPng("promo-marquee-1400x560.png", 1400, 560, promoMarquee());
}

createAssets();
console.log(JSON.stringify({
  ok: true,
  outputDir: "extension/store-assets",
  files: [
    "icon-store-128.png",
    "promo-marquee-1400x560.png",
    "promo-small-440x280.png",
    "screenshot-automation-demo.png",
    "screenshot-popup-connected.png",
    "screenshot-popup-disconnected.png"
  ]
}, null, 2));
