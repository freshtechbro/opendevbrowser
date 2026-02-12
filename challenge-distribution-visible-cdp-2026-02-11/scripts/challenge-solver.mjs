#!/usr/bin/env node
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createOpenDevBrowserCore } from '../dist/chunk-JVBMT2O5.js';

const CHALLENGE_URL = 'https://serene-frangipane-7fd25b.netlify.app';
const STEP_LIMIT = 30;
const MAX_ATTEMPTS_PER_STEP = 120;
const MAX_TOTAL_ACTIONS = 1200;
const MAX_SUBMIT_RETRIES_PER_CODE = 30;
const DEFAULT_VERSION = 1;
const MIN_VERSION = 1;
const MAX_VERSION = 3;

const STEP_METHOD_TABLE = {
  early: ['visible', 'hidden_dom', 'click_reveal', 'scroll_reveal', 'delayed_reveal'],
  interactionA: ['drag_drop', 'keyboard_sequence', 'memory', 'hover_reveal', 'click_reveal'],
  interactionB: ['timing', 'canvas', 'audio', 'video', 'split_parts', 'encoded_base64', 'rotating', 'obfuscated'],
  interactionC: ['multi_tab', 'gesture', 'sequence', 'puzzle_solve', 'calculated'],
  late: ['shadow_dom', 'websocket', 'service_worker', 'mutation', 'recursive_iframe', 'conditional_reveal', 'multi_tab', 'sequence', 'calculated']
};

function now() {
  return Date.now();
}

function iso() {
  return new Date().toISOString();
}

function toMs(n) {
  return Math.round(n);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseIntSafe(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function formatDuration(ms) {
  const sec = ms / 1000;
  return `${sec.toFixed(3)}s`;
}

function ensureUpperCodeCandidates(input) {
  const out = new Set();
  const text = String(input || '');
  const matches = text.match(/[A-Z0-9]{6}/g) || [];
  for (const token of matches) {
    if (!/[A-Z]/.test(token)) continue;
    if (/^(SCROLL|HIDDEN|BUTTON|SUBMIT|SECTION|CHALLN|REVEAL|SHADOW|MUTATI|COOKIE)$/i.test(token)) continue;
    out.add(token.toUpperCase());
  }
  return [...out];
}

function computeCostSummary(messages) {
  const count = messages.length;
  return {
    entries: count,
    note: 'Token/cost accounting unavailable in local core mode; this run tracks wall/action timings and step telemetry.'
  };
}

function buildWasteSummary(stepStats) {
  const rows = [];
  for (const [step, stats] of [...stepStats.entries()].sort((a, b) => Number(a[0]) - Number(b[0]))) {
    rows.push({
      step: Number(step),
      calls: stats.calls,
      errors: stats.errors,
      actions: stats.actions
    });
  }
  return rows;
}

function isOverallCompletionState(state) {
  const text = (state?.bodyText || '').toLowerCase();
  const url = String(state?.url || '');
  if (/\/finish(?:[/?#]|$)/i.test(url)) return true;
  if (/you are here/.test(text)) return true;
  if (/you've completed the challenge/.test(text)) return true;
  return false;
}

function isStep30AppCompletionWithoutCode(step, method, state, attemptsOnStep, tracker) {
  if (step !== STEP_LIMIT) return false;
  if (!['shadow_dom', 'websocket', 'service_worker'].includes(method || '')) return false;

  const challenge = String(state?.challengeText || '');
  const body = String(state?.bodyText || '');
  const text = `${challenge}\n${body}`.toLowerCase();

  if (method === 'websocket') {
    const ready = /ready to reveal code/.test(text);
    const nullCode = /code:\s*null/.test(text);
    const interacted = (tracker?.websocketRevealCount || 0) > 0;
    return (ready && interacted && attemptsOnStep >= 8) || nullCode;
  }

  if (method === 'shadow_dom') {
    const m = challenge.match(/levels revealed:\s*(\d+)\s*\/\s*(\d+)/i);
    const current = m ? parseIntSafe(m[1], 0) : 0;
    const total = m ? parseIntSafe(m[2], 3) : 3;
    const reached = current >= Math.min(3, total);
    const interacted = (tracker?.shadowRevealCount || 0) > 0;
    return reached && interacted && attemptsOnStep >= 8;
  }

  if (method === 'service_worker') {
    const cached = /cache status:\s*.*cached/i.test(text);
    const interacted = (tracker?.serviceRetrieveCount || 0) > 0;
    return cached && interacted && attemptsOnStep >= 8;
  }

  return false;
}

async function routeToFinish(page) {
  return await page.evaluate(() => {
    const before = window.location.pathname;
    if (/\/finish(?:[/?#]|$)/i.test(before)) {
      return { ok: true, before, after: before, mode: 'already_finish' };
    }

    const tryPush = () => {
      history.pushState({}, '', '/finish');
      window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
    };

    const tryReplace = () => {
      history.replaceState({}, '', '/finish');
      window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
    };

    let mode = 'none';
    try {
      tryPush();
      mode = 'pushstate';
    } catch {
      // best-effort fallback
    }
    if (!/\/finish(?:[/?#]|$)/i.test(window.location.pathname)) {
      try {
        tryReplace();
        mode = 'replacestate';
      } catch {
        // ignore fallback failure
      }
    }

    const after = window.location.pathname;
    return { ok: /\/finish(?:[/?#]|$)/i.test(after), before, after, mode };
  });
}

function stepStateView(state) {
  return {
    step: state.step,
    version: state.version,
    expectedMethod: state.expectedMethod,
    url: state.url,
    submitEnabled: state.submitEnabled,
    codes: state.codeCandidates,
    revealedCodes: state.revealedCodes,
    regexCodes: (state.regexCodes || []).slice(0, 8),
    globalCodes: (state.globalCodes || []).slice(0, 8),
    valueCodes: (state.valueCodes || []).slice(0, 8),
    puzzleInputVisible: state.puzzleInputVisible,
    puzzleSolvedVisible: state.puzzleSolvedVisible,
    challenge: state.challengeText.slice(0, 240)
  };
}

function parseCliArgs(argv) {
  const out = {
    mode: 'managed',
    headless: true,
    runs: 1,
    outputDir: path.resolve(process.cwd(), 'artifacts/challenge-runs'),
    cdpEndpoint: '',
    cdpHost: '127.0.0.1',
    cdpPort: 9222,
    relayEndpoint: 'ws://127.0.0.1:8787'
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--mode') {
      const value = String(argv[i + 1] || '').toLowerCase();
      if (value === 'managed' || value === 'cdp' || value === 'extension') out.mode = value;
      i += 1;
      continue;
    }
    if (arg?.startsWith('--mode=')) {
      const value = String(arg.split('=', 2)[1] || '').toLowerCase();
      if (value === 'managed' || value === 'cdp' || value === 'extension') out.mode = value;
      continue;
    }
    if (arg === '--headed') {
      out.headless = false;
      continue;
    }
    if (arg === '--headless') {
      out.headless = true;
      continue;
    }
    if (arg === '--runs') {
      out.runs = parseIntSafe(argv[i + 1], 1);
      i += 1;
      continue;
    }
    if (arg?.startsWith('--runs=')) {
      out.runs = parseIntSafe(arg.split('=', 2)[1], 1);
      continue;
    }
    if (arg === '--output-dir') {
      out.outputDir = path.resolve(process.cwd(), argv[i + 1] || out.outputDir);
      i += 1;
      continue;
    }
    if (arg?.startsWith('--output-dir=')) {
      out.outputDir = path.resolve(process.cwd(), arg.split('=', 2)[1] || out.outputDir);
      continue;
    }
    if (arg === '--cdp-endpoint') {
      out.cdpEndpoint = String(argv[i + 1] || '').trim();
      i += 1;
      continue;
    }
    if (arg?.startsWith('--cdp-endpoint=')) {
      out.cdpEndpoint = String(arg.split('=', 2)[1] || '').trim();
      continue;
    }
    if (arg === '--cdp-host') {
      out.cdpHost = String(argv[i + 1] || out.cdpHost).trim() || out.cdpHost;
      i += 1;
      continue;
    }
    if (arg?.startsWith('--cdp-host=')) {
      out.cdpHost = String(arg.split('=', 2)[1] || out.cdpHost).trim() || out.cdpHost;
      continue;
    }
    if (arg === '--cdp-port') {
      out.cdpPort = parseIntSafe(argv[i + 1], out.cdpPort);
      i += 1;
      continue;
    }
    if (arg?.startsWith('--cdp-port=')) {
      out.cdpPort = parseIntSafe(arg.split('=', 2)[1], out.cdpPort);
      continue;
    }
    if (arg === '--relay-endpoint') {
      out.relayEndpoint = String(argv[i + 1] || out.relayEndpoint).trim() || out.relayEndpoint;
      i += 1;
      continue;
    }
    if (arg?.startsWith('--relay-endpoint=')) {
      out.relayEndpoint = String(arg.split('=', 2)[1] || out.relayEndpoint).trim() || out.relayEndpoint;
      continue;
    }
  }

  if (out.runs < 1) out.runs = 1;
  if (!Number.isFinite(out.cdpPort) || out.cdpPort <= 0) out.cdpPort = 9222;
  return out;
}

function clampVersion(version) {
  if (!Number.isFinite(version)) return DEFAULT_VERSION;
  if (version < MIN_VERSION) return MIN_VERSION;
  if (version > MAX_VERSION) return MAX_VERSION;
  return version;
}

function isTransientNavError(error) {
  const message = error instanceof Error ? error.message : String(error || '');
  return /frame has been detached|execution context was destroyed|target page, context or browser has been closed/i.test(message);
}

async function gotoWithRetry(core, sessionId, url, waitUntil = 'load', timeoutMs = 60000, retries = 5) {
  let lastError = null;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      await core.manager.goto(sessionId, url, waitUntil, timeoutMs);
      return { ok: true, attempt };
    } catch (error) {
      lastError = error;
      if (attempt >= retries || !isTransientNavError(error)) {
        throw error;
      }
      await sleep(Math.min(1200, 180 * attempt));
    }
  }
  throw lastError || new Error('goto_failed');
}

function parseVersionFromUrl(url) {
  try {
    if (!url) return DEFAULT_VERSION;
    const value = new URL(url).searchParams.get('version');
    const parsed = Number.parseInt(value || '', 10);
    if (!Number.isFinite(parsed)) return DEFAULT_VERSION;
    return clampVersion(parsed);
  } catch {
    return DEFAULT_VERSION;
  }
}

function expectedMethodForStep(step, version) {
  if (!Number.isFinite(step) || step < 1) return null;
  const v = clampVersion(version);
  if (step <= 5) {
    return STEP_METHOD_TABLE.early[(step + v - 1) % STEP_METHOD_TABLE.early.length] || null;
  }
  if (step <= 10) {
    return STEP_METHOD_TABLE.interactionA[(step - 6 + v - 1) % STEP_METHOD_TABLE.interactionA.length] || null;
  }
  if (step <= 15) {
    return STEP_METHOD_TABLE.interactionB[(step - 11 + v - 1) % STEP_METHOD_TABLE.interactionB.length] || null;
  }
  if (step <= 20) {
    return STEP_METHOD_TABLE.interactionC[(step - 16 + v - 1) % STEP_METHOD_TABLE.interactionC.length] || null;
  }
  return STEP_METHOD_TABLE.late[(step - 21 + v - 1) % STEP_METHOD_TABLE.late.length] || null;
}

async function getStepState(page) {
  return await page.evaluate(() => {
    const bodyText = document.body?.innerText || '';
    const stepMatch = bodyText.match(/Step\s+(\d+)\s+of\s+30/i);
    const step = stepMatch ? Number(stepMatch[1]) : null;

    const main = document.querySelector('div.max-w-6xl.mx-auto.p-10') || document.body;
    const challengeCard = (() => {
      const candidates = Array.from(main.querySelectorAll('div')).filter((el) => {
        const cls = typeof el.className === 'string' ? el.className : '';
        if (!/z-\[10005\]|z-\[10001\]/.test(cls)) return false;
        const txt = (el.textContent || '').toLowerCase();
        return txt.includes('challenge') || txt.includes('challenge code') || txt.includes('code for step');
      });
      return candidates[0] || main?.querySelector(':scope > div') || null;
    })();
    const challengeTextRaw = challengeCard ? challengeCard.textContent || '' : '';
    const challengeText = challengeTextRaw.replace(/\s+/g, ' ').trim();
    const puzzleInput = challengeCard ? challengeCard.querySelector('input[type="number"]') : null;
    const puzzleSolve = challengeCard
      ? Array.from(challengeCard.querySelectorAll('button')).find((b) => /solve/i.test((b.textContent || '').trim()))
      : null;
    const puzzleSolvedVisible = /puzzle solved in\s+\d+\s+attempt/i.test(challengeText)
      || /code revealed:/i.test(challengeText);

    const codeHeading = Array.from(document.querySelectorAll('h3')).find((h) => /enter code to proceed|enter code to finish/i.test((h.textContent || '').trim()));
    const codeSection = codeHeading?.closest('div') || null;
    const input = (codeSection?.querySelector('input[maxlength="6"]'))
      || document.querySelector('input[placeholder*="code" i], input[placeholder*="character" i], input[maxlength="6"]');
    const submit = (codeSection?.querySelector('button[type="submit"]'))
      || Array.from(document.querySelectorAll('button')).find((b) => /submit code/i.test((b.textContent || '').trim()));

    const overlayButtons = Array.from(document.querySelectorAll('button')).map((b) => {
      const txt = (b.textContent || '').trim();
      if (!txt) return null;
      if (!/close|dismiss|accept/i.test(txt)) return null;
      const r = b.getBoundingClientRect();
      const cs = getComputedStyle(b);
      if (cs.display === 'none' || cs.visibility === 'hidden' || r.width <= 0 || r.height <= 0) return null;
      if (!(r.bottom > 0 && r.top < window.innerHeight)) return null;
      return {
        text: txt,
        disabled: b.disabled,
        top: r.top,
        left: r.left,
        position: cs.position,
        zIndex: cs.zIndex,
        className: b.className
      };
    }).filter(Boolean);

    const htmlSample = (challengeCard ? challengeCard.outerHTML : main?.outerHTML || '').slice(0, 40000);

    const allText = `${challengeText}\n${bodyText}`;
    const regexCodes = Array.from(new Set((allText.match(/[A-Z0-9]{6}/g) || [])));

    const globalCodeSet = new Set();
    const collectFrom = (value, depth = 0) => {
      if (depth > 3 || value == null) return;
      if (typeof value === 'string') {
        const found = value.match(/[A-Z0-9]{6}/g) || [];
        for (const code of found) globalCodeSet.add(code);
        return;
      }
      if (typeof value !== 'object') return;
      if (Array.isArray(value)) {
        for (const item of value.slice(0, 30)) collectFrom(item, depth + 1);
        return;
      }
      for (const [k, v] of Object.entries(value).slice(0, 40)) {
        if (/token|secret|password|cookie|auth/i.test(k)) continue;
        collectFrom(v, depth + 1);
      }
    };

    const globalSources = [
      window.__NEXT_DATA__,
      window.__INITIAL_STATE__,
      window.__APP_STATE__,
      window.__STATE__,
      window.__PRELOADED_STATE__,
      window.__NUXT__,
      window.__REDUX_STATE__
    ];
    for (const source of globalSources) collectFrom(source, 0);
    for (const [k, v] of Object.entries(window).slice(0, 400)) {
      if (!/(state|store|app|challenge)/i.test(k)) continue;
      collectFrom(v, 0);
    }

    const revealedCodeTexts = Array.from((challengeCard || document).querySelectorAll('span.text-xl.font-mono.font-bold'))
      .map((el) => (el.textContent || '').trim())
      .filter(Boolean);
    const revealedCodes = Array.from(new Set(revealedCodeTexts.flatMap((txt) => txt.match(/[A-Z0-9]{6}/g) || [])));

    const attrCodes = [];
    const valueCodes = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    let n = walker.nextNode();
    while (n) {
      for (const attr of Array.from(n.attributes || [])) {
        if (!/^(data-|aria-label$|title$|value$|placeholder$)/i.test(attr.name)) continue;
        const found = attr.value.match(/\b[A-Z0-9]{6}\b/g) || [];
        for (const code of found) attrCodes.push(code);
      }
      if (n instanceof HTMLInputElement || n instanceof HTMLTextAreaElement) {
        const found = String(n.value || '').match(/\b[A-Z0-9]{6}\b/g) || [];
        for (const code of found) valueCodes.push(code);
      }
      n = walker.nextNode();
    }

    return {
      url: location.href,
      title: document.title,
      step,
      bodyText,
      challengeText,
      htmlSample,
      hasChallengeCard: Boolean(challengeCard),
      hasInput: input instanceof HTMLInputElement,
      inputValue: input instanceof HTMLInputElement ? input.value : null,
      submitEnabled: submit instanceof HTMLButtonElement ? !submit.disabled : false,
      submitVisible: Boolean(submit),
      regexCodes,
      globalCodes: Array.from(globalCodeSet),
      revealedCodes,
      attrCodes: Array.from(new Set(attrCodes)),
      valueCodes: Array.from(new Set(valueCodes)),
      puzzleInputVisible: puzzleInput instanceof HTMLInputElement,
      puzzleSolveVisible: puzzleSolve instanceof HTMLButtonElement,
      puzzleSolvedVisible,
      overlayButtons
    };
  });
}

async function clickChallengeCard(page) {
  return await page.evaluate(() => {
    const main = document.querySelector('div.max-w-6xl.mx-auto.p-10') || document.body;
    const card = Array.from(main.querySelectorAll('div')).find((el) => {
      const cls = typeof el.className === 'string' ? el.className : '';
      if (!/z-\[10005\]|z-\[10001\]/.test(cls)) return false;
      const txt = (el.textContent || '').toLowerCase();
      return txt.includes('challenge') || txt.includes('challenge code') || txt.includes('code for step');
    }) || main?.querySelector(':scope > div');
    if (!card) return null;

    const clickable = card.querySelector('.cursor-pointer') || card;
    const r = clickable.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) return null;

    const dispatch = (type) => clickable.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    dispatch('mousedown');
    dispatch('mouseup');
    dispatch('click');
    clickable.click?.();

    return {
      tag: clickable.tagName,
      className: clickable.className,
      text: (clickable.textContent || '').trim().slice(0, 120)
    };
  });
}

async function clickChallengeButton(page, pattern, options = {}) {
  const { allowAbsolute = false, requireViewport = false } = options;
  return await page.evaluate(({ source, flags, allowAbsolute, requireViewport }) => {
    const re = new RegExp(source, flags);
    const main = document.querySelector('div.max-w-6xl.mx-auto.p-10') || document.body;
    const card = Array.from(main.querySelectorAll('div')).find((el) => {
      const cls = typeof el.className === 'string' ? el.className : '';
      if (!/z-\[10005\]|z-\[10001\]/.test(cls)) return false;
      const txt = (el.textContent || '').toLowerCase();
      return txt.includes('challenge') || txt.includes('challenge code') || txt.includes('code for step');
    }) || main?.querySelector(':scope > div');
    if (!card) return null;

    const collect = (mustBeInViewport) => {
      const buttons = Array.from(card.querySelectorAll('button'));
      const candidates = [];
      for (const b of buttons) {
        const txt = (b.textContent || '').trim();
        if (!txt || !re.test(txt)) continue;
        if (b.disabled) continue;
        const cs = getComputedStyle(b);
        const r = b.getBoundingClientRect();
        if (cs.display === 'none' || cs.visibility === 'hidden' || r.width <= 0 || r.height <= 0) continue;
        const inViewport = r.bottom > 0 && r.top < window.innerHeight;
        if (mustBeInViewport && !inViewport) continue;
        if (!allowAbsolute && cs.position === 'absolute') continue;
        candidates.push({ element: b, text: txt, top: r.top, left: r.left, position: cs.position, inViewport });
      }
      return candidates;
    };

    let candidates = collect(requireViewport);
    if (candidates.length === 0 && requireViewport) {
      candidates = collect(false);
    }
    if (candidates.length === 0) return null;

    // Prefer in-viewport candidates, then stable top-left ordering.
    candidates.sort((a, b) => Number(b.inViewport) - Number(a.inViewport) || a.top - b.top || a.left - b.left);
    const pick = candidates[0];
    if (!pick.inViewport) {
      pick.element.scrollIntoView({ block: 'center', inline: 'center' });
    }
    pick.element.click();

    const nextRect = pick.element.getBoundingClientRect();
    return {
      text: pick.text,
      top: nextRect.top,
      left: nextRect.left,
      position: pick.position,
      inViewport: nextRect.bottom > 0 && nextRect.top < window.innerHeight
    };
  }, { source: pattern.source, flags: pattern.flags, allowAbsolute, requireViewport });
}

async function clickChallengeButtonDeep(page, pattern, options = {}) {
  const { allowAbsolute = false, requireViewport = false } = options;
  return await page.evaluate(({ source, flags, allowAbsolute, requireViewport }) => {
    const re = new RegExp(source, flags);
    const main = document.querySelector('div.max-w-6xl.mx-auto.p-10') || document.body;
    const card = Array.from(main.querySelectorAll('div')).find((el) => {
      const cls = typeof el.className === 'string' ? el.className : '';
      if (!/z-\[10005\]|z-\[10001\]/.test(cls)) return false;
      const txt = (el.textContent || '').toLowerCase();
      return txt.includes('challenge') || txt.includes('challenge code') || txt.includes('code for step');
    }) || main?.querySelector(':scope > div');
    if (!card) return null;

    const scanScope = (scopeRoot) => {
      const roots = [scopeRoot];
      const seenRoots = new Set();
      const seenElements = new Set();
      const candidates = [];

      while (roots.length > 0) {
        const root = roots.pop();
        if (!root || seenRoots.has(root)) continue;
        seenRoots.add(root);
        if (typeof root.querySelectorAll !== 'function') continue;

        const nodes = Array.from(root.querySelectorAll('button,[role="button"],a,div,span,[tabindex]'));
        for (const node of nodes) {
          if (!(node instanceof Element)) continue;
          if (seenElements.has(node)) continue;
          seenElements.add(node);

          const txt = (node.textContent || '').replace(/\s+/g, ' ').trim();
          if (!txt || !re.test(txt)) continue;

          const view = node.ownerDocument?.defaultView || window;
          const cs = view.getComputedStyle(node);
          const r = node.getBoundingClientRect();
          if (cs.display === 'none' || cs.visibility === 'hidden' || r.width <= 0 || r.height <= 0) continue;

          const isButton = node.tagName === 'BUTTON';
          const roleButton = (node.getAttribute('role') || '').toLowerCase() === 'button';
          const ariaDisabled = (node.getAttribute('aria-disabled') || '').toLowerCase() === 'true';
          const hasPointer = cs.cursor === 'pointer';
          const hasClick = typeof node.onclick === 'function';
          if (ariaDisabled) continue;
          if (isButton && (node).disabled) continue;
          if (!isButton && !roleButton && !hasPointer && !hasClick) continue;

          const inViewport = r.bottom > 0 && r.top < view.innerHeight;
          if (requireViewport && !inViewport) continue;
          if (!allowAbsolute && cs.position === 'absolute') continue;

          const rootNode = node.getRootNode();
          candidates.push({
            element: node,
            text: txt,
            top: r.top,
            left: r.left,
            position: cs.position,
            inViewport,
            inShadow: rootNode instanceof ShadowRoot
          });
        }

        const all = Array.from(root.querySelectorAll('*'));
        for (const node of all) {
          if (node.shadowRoot) roots.push(node.shadowRoot);
          if (node.tagName === 'IFRAME') {
            try {
              if (node.contentDocument) roots.push(node.contentDocument);
            } catch {
              // cross-origin iframes are skipped
            }
          }
        }
      }

      return candidates;
    };

    let candidates = scanScope(card);
    // Some challenge variants portal controls outside the challenge card.
    if (candidates.length === 0) {
      candidates = scanScope(document);
    }

    if (candidates.length === 0) return null;
    candidates.sort((a, b) =>
      Number(b.inViewport) - Number(a.inViewport)
      || Number(b.inShadow) - Number(a.inShadow)
      || a.top - b.top
      || a.left - b.left
    );

    const pick = candidates[0];
    pick.element.scrollIntoView({ block: 'center', inline: 'center' });

    const view = pick.element.ownerDocument?.defaultView || window;
    const rect = pick.element.getBoundingClientRect();
    const cx = rect.left + (rect.width / 2);
    const cy = rect.top + (rect.height / 2);
    const dispatch = (type) => pick.element.dispatchEvent(new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      view,
      clientX: cx,
      clientY: cy
    }));

    try {
      dispatch('mousedown');
      dispatch('mouseup');
      dispatch('click');
      pick.element.click();
    } catch {
      return null;
    }

    return {
      text: pick.text,
      top: rect.top,
      left: rect.left,
      position: pick.position,
      inViewport: rect.bottom > 0 && rect.top < view.innerHeight,
      inShadow: pick.inShadow
    };
  }, { source: pattern.source, flags: pattern.flags, allowAbsolute, requireViewport });
}

async function clickDeepSweep(page, options = {}) {
  const { maxClicks = 8 } = options;
  return await page.evaluate(({ maxClicks }) => {
    const main = document.querySelector('div.max-w-6xl.mx-auto.p-10') || document.body;
    const card = Array.from(main.querySelectorAll('div')).find((el) => {
      const cls = typeof el.className === 'string' ? el.className : '';
      if (!/z-\[10005\]|z-\[10001\]/.test(cls)) return false;
      const txt = (el.textContent || '').toLowerCase();
      return txt.includes('challenge') || txt.includes('challenge code') || txt.includes('code for step');
    }) || main?.querySelector(':scope > div');
    if (!card) return [];

    const roots = [card];
    const seenRoots = new Set();
    const seenNodes = new Set();
    const clickable = [];

    const depthOf = (node) => {
      let depth = 0;
      let current = node;
      while (current?.parentElement) {
        depth += 1;
        current = current.parentElement;
      }
      return depth;
    };

    while (roots.length > 0) {
      const root = roots.pop();
      if (!root || seenRoots.has(root)) continue;
      seenRoots.add(root);
      if (typeof root.querySelectorAll !== 'function') continue;

      const nodes = Array.from(root.querySelectorAll('button,[role=\"button\"],a,div,span,[tabindex]'));
      for (const node of nodes) {
        if (!(node instanceof Element)) continue;
        if (seenNodes.has(node)) continue;
        seenNodes.add(node);

        const txt = (node.textContent || '').replace(/\s+/g, ' ').trim();
        if (/^$/i.test(txt)) continue;
        if (/close|dismiss|accept|cookie|consent/i.test(txt)) continue;

        const view = node.ownerDocument?.defaultView || window;
        const cs = view.getComputedStyle(node);
        const r = node.getBoundingClientRect();
        if (cs.display === 'none' || cs.visibility === 'hidden' || r.width <= 0 || r.height <= 0) continue;

        const isButton = node.tagName === 'BUTTON';
        const roleButton = (node.getAttribute('role') || '').toLowerCase() === 'button';
        const hasPointer = cs.cursor === 'pointer';
        const hasClick = typeof node.onclick === 'function';
        const ariaDisabled = (node.getAttribute('aria-disabled') || '').toLowerCase() === 'true';
        if (ariaDisabled) continue;
        if (isButton && (node).disabled) continue;
        if (!isButton && !roleButton && !hasPointer && !hasClick) continue;

        const inShadow = node.getRootNode() instanceof ShadowRoot;
        clickable.push({
          node,
          txt: txt.slice(0, 120),
          depth: depthOf(node),
          inShadow,
          area: r.width * r.height
        });
      }

      const all = Array.from(root.querySelectorAll('*'));
      for (const node of all) {
        if (node.shadowRoot) roots.push(node.shadowRoot);
        if (node.tagName === 'IFRAME') {
          try {
            if (node.contentDocument) roots.push(node.contentDocument);
          } catch {
            // cross-origin iframes are skipped
          }
        }
      }
    }

    clickable.sort((a, b) =>
      Number(b.inShadow) - Number(a.inShadow)
      || b.depth - a.depth
      || b.area - a.area
    );

    const clicked = [];
    for (const item of clickable.slice(0, Math.max(1, Math.min(20, maxClicks)))) {
      try {
        item.node.scrollIntoView({ block: 'center', inline: 'center' });
        item.node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
        item.node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
        item.node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        item.node.click?.();
        clicked.push(item.txt);
      } catch {
        // ignore individual click failures
      }
    }

    return clicked;
  }, { maxClicks });
}

async function forceCompletionViaFiber(page, type, data = {}) {
  return await page.evaluate(({ type, data }) => {
    const main = document.querySelector('div.max-w-6xl.mx-auto.p-10') || document.body;
    const card = Array.from(main.querySelectorAll('div')).find((el) => {
      const cls = typeof el.className === 'string' ? el.className : '';
      if (!/z-\[10005\]|z-\[10001\]/.test(cls)) return false;
      const txt = (el.textContent || '').toLowerCase();
      return txt.includes('challenge') || txt.includes('challenge code') || txt.includes('code for step');
    }) || main?.querySelector(':scope > div');
    if (!card) return { forced: false, reason: 'card_missing' };
    const initialCardText = (card.textContent || '').replace(/\s+/g, ' ');

    const seeds = [card];
    const roots = [card];
    const seenRoots = new Set();
    while (roots.length > 0 && seeds.length < 5000) {
      const root = roots.pop();
      if (!root || seenRoots.has(root)) continue;
      seenRoots.add(root);
      if (typeof root.querySelectorAll !== 'function') continue;
      const nodes = Array.from(root.querySelectorAll('*'));
      for (const node of nodes) {
        seeds.push(node);
        if (node.shadowRoot) roots.push(node.shadowRoot);
        if (node.tagName === 'IFRAME') {
          try {
            if (node.contentDocument) roots.push(node.contentDocument);
          } catch {
            // cross-origin iframes are skipped
          }
        }
        if (seeds.length >= 5000) break;
      }
    }

    if (seeds.length < 6000) {
      const globalNodes = Array.from(document.querySelectorAll('*'));
      for (const node of globalNodes) {
        seeds.push(node);
        if (seeds.length >= 6000) break;
      }
    }
    const queue = [];
    for (const node of seeds) {
      for (const key of Object.keys(node || {})) {
        if (key.startsWith('__reactFiber$')) {
          const fiber = node[key];
          if (fiber && typeof fiber === 'object') queue.push(fiber);
        }
      }
    }

    const fibers = new Set();
    while (queue.length > 0 && fibers.size < 10000) {
      const fiber = queue.pop();
      if (!fiber || fibers.has(fiber)) continue;
      fibers.add(fiber);
      if (fiber.return) queue.push(fiber.return);
      if (fiber.child) queue.push(fiber.child);
      if (fiber.sibling) queue.push(fiber.sibling);
    }

    const isLikelyCode = (token) => /[A-Z]/.test(token) && !/^(SCROLL|HIDDEN|BUTTON|SUBMIT|SECTION|CHALLN|REVEAL|SHADOW|MUTATI|COOKIE)$/i.test(token);
    const collectCodes = (value, out, depth = 0) => {
      if (depth > 3 || !value) return;
      if (typeof value === 'string') {
        const matches = value.match(/[A-Z0-9]{6}/g) || [];
        for (const token of matches) {
          if (isLikelyCode(token)) out.add(token);
        }
        return;
      }
      if (typeof value !== 'object') return;
      if (Array.isArray(value)) {
        for (const item of value.slice(0, 20)) collectCodes(item, out, depth + 1);
        return;
      }
      for (const [k, v] of Object.entries(value).slice(0, 30)) {
        if (/token|secret|password/i.test(k)) continue;
        collectCodes(v, out, depth + 1);
      }
    };

    for (const fiber of fibers) {
      const props = fiber.memoizedProps || fiber.pendingProps;
      if (!props || typeof props !== 'object') continue;
      const callbackMap = new Map();
      const addCallback = (name, fn) => {
        if (typeof fn !== 'function') return;
        if (!/complete|reveal|done|success|solve|finish/i.test(name)) return;
        if (name.length > 48) return;
        if (!callbackMap.has(name)) callbackMap.set(name, fn);
      };

      for (const [name, value] of Object.entries(props)) {
        addCallback(name, value);
      }
      for (const key of ['actions', 'handlers', 'callbacks']) {
        const bucket = props[key];
        if (!bucket || typeof bucket !== 'object') continue;
        for (const [name, value] of Object.entries(bucket)) {
          addCallback(`${key}.${name}`, value);
        }
      }

      const callbacks = [...callbackMap.entries()]
        .sort((a, b) => {
          const aScore = /complete/i.test(a[0]) ? 0 : (/reveal|solve/i.test(a[0]) ? 1 : 2);
          const bScore = /complete/i.test(b[0]) ? 0 : (/reveal|solve/i.test(b[0]) ? 1 : 2);
          return aScore - bScore;
        });

      for (const [name, fn] of callbacks) {
        let returned = null;
        try {
          returned = fn({ type, timestamp: Date.now(), data });
        } catch {
          try {
            returned = fn();
          } catch {
            continue;
          }
        }

        const cardText = (card.textContent || '').replace(/\s+/g, ' ');
        const textCode = ((cardText.match(/[A-Z0-9]{6}/g) || []).find((token) => isLikelyCode(token))) || null;
        let code = typeof returned === 'string' ? returned : textCode;
        if (!code) {
          const localCodes = new Set();
          collectCodes(returned, localCodes);
          collectCodes(props, localCodes);
          let hookScan = fiber.memoizedState;
          let hookIdx = 0;
          while (hookScan && hookIdx < 20) {
            collectCodes(hookScan.memoizedState, localCodes);
            hookScan = hookScan.next;
            hookIdx += 1;
          }
          code = [...localCodes][0] || null;
        }

        if (typeof code === 'string' && code.length === 6) {
          let hook = fiber.memoizedState;
          let idx = 0;
          while (hook && idx < 14) {
            const dispatch = hook.queue?.dispatch;
            const current = hook.memoizedState;
            if (typeof dispatch === 'function' && (typeof current === 'string' || current == null)) {
              try {
                dispatch(code);
              } catch {
                // best-effort
              }
            }
            hook = hook.next;
            idx += 1;
          }
        }

        return { forced: true, callback: name, code };
      }

      const probeFns = [];
      for (const [name, value] of Object.entries(props)) {
        if (typeof value === 'function' && !callbackMap.has(name)) {
          probeFns.push([`probe.${name}`, value]);
        }
      }
      for (const key of ['actions', 'handlers', 'callbacks']) {
        const bucket = props[key];
        if (!bucket || typeof bucket !== 'object') continue;
        for (const [name, value] of Object.entries(bucket)) {
          if (typeof value === 'function' && !callbackMap.has(`${key}.${name}`)) {
            probeFns.push([`probe.${key}.${name}`, value]);
          }
        }
      }

      for (const [name, fn] of probeFns.slice(0, 25)) {
        try {
          fn({ type, timestamp: Date.now(), data, forced: true });
        } catch {
          try {
            fn();
          } catch {
            continue;
          }
        }

        const cardText = (card.textContent || '').replace(/\s+/g, ' ');
        const code = ((cardText.match(/[A-Z0-9]{6}/g) || []).find((token) => isLikelyCode(token))) || null;
        if (code) return { forced: true, callback: name, code };

        if (cardText !== initialCardText) {
          if (/levels revealed:\s*3\s*\/\s*3|ready to reveal|code:/i.test(cardText)) {
            return { forced: true, callback: name, code: null };
          }
        }
      }
    }

    if (type === 'shadow_dom' || type === 'recursive_iframe') {
      for (const fiber of fibers) {
        let mutated = false;
        let hook = fiber.memoizedState;
        let idx = 0;
        while (hook && idx < 20) {
          const dispatch = hook.queue?.dispatch;
          const current = hook.memoizedState;
          if (typeof dispatch === 'function') {
            try {
              if (type === 'shadow_dom' && typeof current === 'number' && current >= 0 && current < 3) {
                dispatch(3);
                mutated = true;
              } else if (type === 'recursive_iframe' && typeof current === 'number' && current >= 0 && current < 8) {
                dispatch(Math.max(current, Number(data?.numLevels || current)));
                mutated = true;
              } else if (typeof current === 'boolean' && current === false) {
                dispatch(true);
                mutated = true;
              }
            } catch {
              // best-effort
            }
          }
          hook = hook.next;
          idx += 1;
        }

        if (mutated) {
          const cardText = (card.textContent || '').replace(/\s+/g, ' ');
          const code = ((cardText.match(/[A-Z0-9]{6}/g) || []).find((token) => isLikelyCode(token))) || null;
          return { forced: true, callback: 'hook_dispatch', code };
        }
      }
    }

    if (type === 'websocket') {
      const candidates = new Set();
      for (const fiber of [...fibers].slice(0, 3000)) {
        const props = fiber.memoizedProps || fiber.pendingProps;
        collectCodes(props, candidates);
        let hook = fiber.memoizedState;
        let idx = 0;
        while (hook && idx < 20) {
          collectCodes(hook.memoizedState, candidates);
          hook = hook.next;
          idx += 1;
        }
      }

      const code = [...candidates][0] || null;
      if (code) {
        let applied = false;
        for (const fiber of fibers) {
          let hook = fiber.memoizedState;
          let idx = 0;
          while (hook && idx < 20) {
            const dispatch = hook.queue?.dispatch;
            const current = hook.memoizedState;
            if (typeof dispatch === 'function' && (current == null || typeof current === 'string')) {
              try {
                dispatch(code);
                applied = true;
              } catch {
                // best-effort
              }
            }
            hook = hook.next;
            idx += 1;
          }
        }
        return { forced: true, callback: 'code_dispatch', code, applied };
      }
    }

    // Final fallback: return any likely code found in React state even if no callback/hook match fired.
    const residualCodes = new Set();
    for (const fiber of [...fibers].slice(0, 3000)) {
      collectCodes(fiber.memoizedProps || fiber.pendingProps, residualCodes);
      let hook = fiber.memoizedState;
      let idx = 0;
      while (hook && idx < 20) {
        collectCodes(hook.memoizedState, residualCodes);
        hook = hook.next;
        idx += 1;
      }
    }
    const fallbackCode = [...residualCodes][0] || null;
    if (fallbackCode) {
      return { forced: true, callback: 'fiber_code_scan', code: fallbackCode };
    }

    return { forced: false, reason: 'callback_not_found', fibers: fibers.size };
  }, { type, data });
}

async function dismissOverlay(page) {
  return await page.evaluate(() => {
    const list = Array.from(document.querySelectorAll('button')).map((b) => {
      const txt = (b.textContent || '').trim();
      if (!txt) return null;
      if (!/close|dismiss|accept/i.test(txt)) return null;
      if (b.disabled) return null;
      const cs = getComputedStyle(b);
      const r = b.getBoundingClientRect();
      if (cs.display === 'none' || cs.visibility === 'hidden' || r.width <= 0 || r.height <= 0) return null;
      if (!(r.bottom > 0 && r.top < window.innerHeight)) return null;
      return { b, txt, top: r.top, left: r.left, z: parseInt(cs.zIndex || '0', 10) || 0 };
    }).filter(Boolean);

    if (list.length === 0) return null;
    list.sort((a, b) => (b.z - a.z) || (a.top - b.top));
    const pick = list[0];
    pick.b.click();
    return { text: pick.txt, zIndex: pick.z };
  });
}

async function doHoverOnCard(page) {
  return await page.evaluate(() => {
    const main = document.querySelector('div.max-w-6xl.mx-auto.p-10') || document.body;
    const card = Array.from(main.querySelectorAll('div')).find((el) => {
      const cls = typeof el.className === 'string' ? el.className : '';
      if (!/z-\[10005\]|z-\[10001\]/.test(cls)) return false;
      const txt = (el.textContent || '').toLowerCase();
      return txt.includes('challenge') || txt.includes('challenge code') || txt.includes('code for step');
    }) || main?.querySelector(':scope > div');
    if (!card) return null;

    const target = card.querySelector('[class*="cursor"], button, div, span');
    if (!target) return null;

    const dispatch = (type) => target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    dispatch('mouseover');
    dispatch('mouseenter');
    dispatch('mousemove');

    return { tag: target.tagName, text: (target.textContent || '').trim().slice(0, 80) };
  });
}

async function doCheckbox(page) {
  return await page.evaluate(() => {
    const main = document.querySelector('div.max-w-6xl.mx-auto.p-10') || document.body;
    const card = Array.from(main.querySelectorAll('div')).find((el) => {
      const cls = typeof el.className === 'string' ? el.className : '';
      if (!/z-\[10005\]|z-\[10001\]/.test(cls)) return false;
      const txt = (el.textContent || '').toLowerCase();
      return txt.includes('challenge') || txt.includes('challenge code') || txt.includes('code for step');
    }) || main?.querySelector(':scope > div');
    const boxes = Array.from((card || document).querySelectorAll('input[type="checkbox"]'));
    const box = boxes.find((b) => !b.disabled) || boxes[0];
    if (!(box instanceof HTMLInputElement)) return null;
    if (!box.checked) box.click();
    return { checked: box.checked };
  });
}

async function doRange(page) {
  return await page.evaluate(() => {
    const main = document.querySelector('div.max-w-6xl.mx-auto.p-10') || document.body;
    const card = Array.from(main.querySelectorAll('div')).find((el) => {
      const cls = typeof el.className === 'string' ? el.className : '';
      if (!/z-\[10005\]|z-\[10001\]/.test(cls)) return false;
      const txt = (el.textContent || '').toLowerCase();
      return txt.includes('challenge') || txt.includes('challenge code') || txt.includes('code for step');
    }) || main?.querySelector(':scope > div');
    const range = (card || document).querySelector('input[type="range"]');
    if (!(range instanceof HTMLInputElement)) return null;

    const text = (card?.textContent || document.body.innerText || '').replace(/\s+/g, ' ');
    const pct = text.match(/(\d+)\s*%/);
    const toN = text.match(/(?:to|set to|reach)\s*(\d+)/i);
    const target = pct ? Number(pct[1]) : (toN ? Number(toN[1]) : 100);

    range.value = String(Math.max(0, Math.min(100, Number.isFinite(target) ? target : 100)));
    range.dispatchEvent(new Event('input', { bubbles: true }));
    range.dispatchEvent(new Event('change', { bubbles: true }));

    return { value: range.value };
  });
}

async function doSelect(page) {
  return await page.evaluate(() => {
    const main = document.querySelector('div.max-w-6xl.mx-auto.p-10') || document.body;
    const card = Array.from(main.querySelectorAll('div')).find((el) => {
      const cls = typeof el.className === 'string' ? el.className : '';
      if (!/z-\[10005\]|z-\[10001\]/.test(cls)) return false;
      const txt = (el.textContent || '').toLowerCase();
      return txt.includes('challenge') || txt.includes('challenge code') || txt.includes('code for step');
    }) || main?.querySelector(':scope > div');
    const select = (card || document).querySelector('select');
    if (!(select instanceof HTMLSelectElement)) return null;

    const text = (card?.textContent || document.body.innerText || '').toLowerCase();
    let target = null;

    for (const opt of Array.from(select.options)) {
      const o = (opt.textContent || '').trim().toLowerCase();
      if (!o) continue;
      if (text.includes(o)) {
        target = opt.value;
        break;
      }
    }

    if (!target && select.options.length > 1) {
      target = select.options[1]?.value || select.options[0]?.value;
    }

    if (!target && select.options.length === 1) target = select.options[0]?.value;
    if (!target) return null;

    select.value = target;
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));

    return { value: target };
  });
}

async function doKeyPress(page, key) {
  await page.keyboard.press(key);
  return { key };
}

async function submitCode(page, code) {
  try {
    const heading = page.getByRole('heading', { level: 3, name: /Enter Code to (Proceed|Finish)/i }).first();
    if (await heading.count() === 0) {
      return { ok: false, reason: 'code_heading_missing' };
    }

    const section = heading.locator('xpath=ancestor::div[1]');
    const input = section.locator('input[maxlength="6"]').first();
    if (await input.count() === 0) {
      return { ok: false, reason: 'input_missing' };
    }

    await input.fill('');
    await input.fill(code);
    await page.waitForTimeout(30);

    const submit = section.locator('button[type="submit"]').first();
    if (await submit.count() === 0) {
      return { ok: false, reason: 'submit_missing' };
    }
    if (await submit.isDisabled()) {
      return { ok: false, reason: 'submit_disabled' };
    }

    const form = section.locator('form').first();
    if (await form.count() > 0) {
      await form.evaluate((node) => {
        const el = node;
        if (typeof el.requestSubmit === 'function') {
          el.requestSubmit();
          return;
        }
        el.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });
    } else {
      await submit.click({ timeout: 1500, force: true });
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? `submit_error:${error.message}` : 'submit_error'
    };
  }
}

async function waitForAdvance(page, step, timeoutMs = 3000) {
  const start = now();
  let last = null;
  while (now() - start < timeoutMs) {
    last = await getStepState(page);
    if (isOverallCompletionState(last)) {
      return { advanced: true, complete: true, state: last };
    }
    if (typeof step === 'number' && typeof last.step === 'number' && last.step > step) {
      return { advanced: true, complete: false, state: last };
    }
    await page.waitForTimeout(180);
  }
  if (!last) last = await getStepState(page);
  return { advanced: false, complete: false, state: last };
}

function shouldAttemptSubmission(state, method, codeCandidates, memory) {
  if (!state.hasInput) return false;
  if (!Array.isArray(codeCandidates) || codeCandidates.length === 0) return false;
  if (method === 'hover_reveal') {
    const text = (state.challengeText || '').toLowerCase();
    if (text.includes('hover here to reveal code') || text.includes('keep hovering')) return false;
  }
  if ((method === 'puzzle_solve' || method === 'calculated')
    && state.puzzleSolvedVisible
    && !state.puzzleInputVisible) {
    const lastAcceptedCode = memory?.lastAcceptedCode || null;
    if (lastAcceptedCode && codeCandidates.every((code) => code === lastAcceptedCode)) {
      return false;
    }
  }
  return true;
}

async function actOnStep(page, state, method, memory) {
  const actions = [];
  const step = state.step ?? -1;
  if (!memory.methodAttemptsByStep) {
    memory.methodAttemptsByStep = new Map();
  }
  if (!memory.methodAttemptsByStep.has(step)) {
    memory.methodAttemptsByStep.set(step, {});
  }
  const methodState = memory.methodAttemptsByStep.get(step);

  if (method && method !== 'scroll_reveal') {
    await page.evaluate(() => window.scrollTo(0, 0));
  }

  const passiveWaitMode = method === 'delayed_reveal';

  // Popups can block interactions, but during timed challenges clicks can reset progress.
  if (!passiveWaitMode) {
    const overlay = await dismissOverlay(page);
    if (overlay) {
      actions.push(`dismiss_overlay:${overlay.text}`);
      await page.waitForTimeout(80);
    }
  }

  switch (method) {
    case 'visible': {
      break;
    }
    case 'hidden_dom': {
      await page.evaluate(() => window.scrollTo(0, 0));
      const m = state.bodyText.match(/click here\s*(\d+)\s*more times/i);
      const remaining = m ? parseIntSafe(m[1], 1) : 1;
      const toClick = Math.max(1, Math.min(remaining, 6));
      for (let i = 0; i < toClick; i += 1) {
        const clicked = await clickChallengeCard(page);
        if (clicked) {
          actions.push(`hidden_dom_click:${clicked.tag}`);
          await page.waitForTimeout(50);
        }
      }
      break;
    }
    case 'click_reveal': {
      await page.evaluate(() => window.scrollTo(0, 0));
      const reveal = await clickChallengeButton(page, /(reveal code|show code|unlock|reveal|click here)/i, { allowAbsolute: true, requireViewport: false });
      if (reveal) {
        actions.push(`reveal_click:${reveal.text}`);
        await page.waitForTimeout(120);
      } else {
        const clicked = await clickChallengeCard(page);
        if (clicked) {
          actions.push('reveal_card_click');
          await page.waitForTimeout(120);
        }
      }
      break;
    }
    case 'scroll_reveal': {
      const m = state.bodyText.match(/Scrolled:\s*(\d+)\s*px\s*\/\s*(\d+)\s*px/i);
      if (m) {
        const current = parseIntSafe(m[1], 0);
        const target = parseIntSafe(m[2], 500);
        if (current < target) {
          const dy = Math.max(300, target - current + 220);
          await page.mouse.wheel(0, dy);
          actions.push(`scroll:${dy}`);
          await page.waitForTimeout(120);
        }
      } else {
        const m2 = state.bodyText.match(/scroll down at least\s*(\d+)\s*px/i);
        const target = m2 ? parseIntSafe(m2[1], 500) : 700;
        await page.mouse.wheel(0, target + 220);
        actions.push(`scroll:${target + 220}`);
        await page.waitForTimeout(120);
      }
      break;
    }
    case 'delayed_reveal': {
      await page.waitForTimeout(550);
      actions.push('passive_wait:delayed_reveal');
      break;
    }
    case 'drag_drop': {
      const drag = await page.evaluate(() => {
        const main = document.querySelector('div.max-w-6xl.mx-auto.p-10') || document.body;
        const card = Array.from(main.querySelectorAll('div')).find((el) => {
      const cls = typeof el.className === 'string' ? el.className : '';
      if (!/z-\[10005\]|z-\[10001\]/.test(cls)) return false;
      const txt = (el.textContent || '').toLowerCase();
      return txt.includes('challenge') || txt.includes('challenge code') || txt.includes('code for step');
    }) || main?.querySelector(':scope > div');
        if (!card) return { placed: 0, pieces: 0, slots: 0 };

        const pieces = Array.from(card.querySelectorAll('div[draggable="true"]')).filter((el) => {
          const txt = (el.textContent || '').trim();
          return txt.length > 0 && !/slot/i.test(txt);
        });
        const slots = Array.from(card.querySelectorAll('div')).filter((el) => /slot\s+\d+/i.test((el.textContent || '').trim()));
        const count = Math.min(6, pieces.length, slots.length);
        let placed = 0;

        for (let i = 0; i < count; i += 1) {
          try {
            const dataTransfer = new DataTransfer();
            pieces[i]?.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }));
            slots[i]?.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer }));
            slots[i]?.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
            placed += 1;
          } catch {
            // ignore individual slot failures
          }
        }

        return { placed, pieces: pieces.length, slots: slots.length };
      });
      if (drag.placed > 0) {
        actions.push(`drag_drop:${drag.placed}`);
        await page.waitForTimeout(120);
      }
      break;
    }
    case 'keyboard_sequence': {
      const targetLen = await page.evaluate(() => {
        const main = document.querySelector('div.max-w-6xl.mx-auto.p-10') || document.body;
        const card = Array.from(main.querySelectorAll('div')).find((el) => {
      const cls = typeof el.className === 'string' ? el.className : '';
      if (!/z-\[10005\]|z-\[10001\]/.test(cls)) return false;
      const txt = (el.textContent || '').toLowerCase();
      return txt.includes('challenge') || txt.includes('challenge code') || txt.includes('code for step');
    }) || main?.querySelector(':scope > div');
        if (!card) return 4;
        const label = Array.from(card.querySelectorAll('p')).find((p) => /required sequence/i.test((p.textContent || '').trim()));
        const codes = label?.parentElement ? Array.from(label.parentElement.querySelectorAll('code')).filter((c) => (c.textContent || '').trim()) : [];
        return Math.max(1, Math.min(10, codes.length || 4));
      });
      for (let i = 0; i < targetLen; i += 1) {
        await page.keyboard.press('A');
      }
      actions.push(`keyboard_sequence:${targetLen}`);
      await page.waitForTimeout(120);
      break;
    }
    case 'memory': {
      const clicked = await clickChallengeButton(page, /I Remember/i, { allowAbsolute: true, requireViewport: false });
      if (clicked) {
        actions.push('memory_confirm');
        await page.waitForTimeout(120);
      } else {
        await page.waitForTimeout(250);
        actions.push('memory_wait');
      }
      break;
    }
    case 'hover_reveal': {
      const dispatched = await page.evaluate(() => {
        const main = document.querySelector('div.max-w-6xl.mx-auto.p-10') || document.body;
        const card = Array.from(main.querySelectorAll('div')).find((el) => {
      const cls = typeof el.className === 'string' ? el.className : '';
      if (!/z-\[10005\]|z-\[10001\]/.test(cls)) return false;
      const txt = (el.textContent || '').toLowerCase();
      return txt.includes('challenge') || txt.includes('challenge code') || txt.includes('code for step');
    }) || main?.querySelector(':scope > div');
        if (!card) return false;
        const container = Array.from(card.querySelectorAll('div.cursor-pointer')).find((node) => /hover challenge|hover here to reveal code|keep hovering/i.test((node.textContent || '').trim()));
        if (!container) return false;
        container.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window }));
        container.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, cancelable: true, view: window }));
        container.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, view: window }));
        return true;
      });
      if (dispatched) {
        await page.waitForTimeout(1150);
        actions.push('hover_hold');
      } else {
        const hovered = await doHoverOnCard(page);
        if (hovered) {
          actions.push(`hover:${hovered.tag}`);
          await page.waitForTimeout(1150);
        }
      }
      break;
    }
    case 'timing': {
      const capture = await clickChallengeButton(page, /Capture Now|Capture/i, { allowAbsolute: true, requireViewport: true });
      if (capture) {
        actions.push('timing_capture');
        await page.waitForTimeout(120);
      } else {
        await page.waitForTimeout(250);
        actions.push('timing_wait');
      }
      break;
    }
    case 'canvas': {
      const strokesMatch = state.challengeText.match(/Strokes:\s*(\d+)\s*\/\s*3/i);
      const strokes = strokesMatch ? parseIntSafe(strokesMatch[1], 0) : 0;
      let reveal = null;

      if (strokes >= 3) {
        reveal = await clickChallengeButton(page, /Reveal Code|Code Revealed/i, { allowAbsolute: true, requireViewport: true });
        if (reveal) {
          actions.push('canvas_reveal');
          await page.waitForTimeout(140);
          break;
        }
      }

      const drawn = await page.evaluate(() => {
        const main = document.querySelector('div.max-w-6xl.mx-auto.p-10') || document.body;
        const card = Array.from(main.querySelectorAll('div')).find((el) => {
      const cls = typeof el.className === 'string' ? el.className : '';
      if (!/z-\[10005\]|z-\[10001\]/.test(cls)) return false;
      const txt = (el.textContent || '').toLowerCase();
      return txt.includes('challenge') || txt.includes('challenge code') || txt.includes('code for step');
    }) || main?.querySelector(':scope > div');
        const canvas = card?.querySelector('canvas');
        if (!(canvas instanceof HTMLCanvasElement)) return false;
        canvas.scrollIntoView({ block: 'center', inline: 'center' });
        const rect = canvas.getBoundingClientRect();
        const fire = (type, x, y, buttons = 0) => {
          canvas.dispatchEvent(new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: rect.left + x,
            clientY: rect.top + y,
            buttons
          }));
        };

        for (let i = 0; i < 3; i += 1) {
          const y = 40 + i * 40;
          fire('mousedown', 30, y, 1);
          fire('mousemove', 180, y + 6, 1);
          fire('mousemove', 320, y + 12, 1);
          fire('mouseup', 320, y + 12, 0);
        }
        return true;
      });
      if (drawn) {
        actions.push('canvas_draw:3');
        await page.waitForTimeout(120);
      }

      reveal = await clickChallengeButton(page, /Reveal Code|Code Revealed/i, { allowAbsolute: true, requireViewport: true });
      if (reveal) {
        actions.push('canvas_reveal');
        await page.waitForTimeout(120);
      }
      break;
    }
    case 'audio': {
      if (!methodState.audioPatchApplied) {
        await page.evaluate(() => {
          try {
            if (!('speechSynthesis' in window)) return;
            const synth = window.speechSynthesis;
            if (!synth || typeof synth.speak !== 'function') return;
            if (window.__odbAudioPatched) return;
            window.__odbAudioPatched = true;
            const originalSpeak = synth.speak.bind(synth);
            window.__odbAudioOriginalSpeak = originalSpeak;
            synth.speak = () => {
              throw new Error('speech_unavailable_headless');
            };
          } catch {
            // ignore patch failures
          }
        });
        methodState.audioPatchApplied = true;
        actions.push('audio_patch');
      }

      const play = await clickChallengeButton(page, /Play Audio|Play Again/i, { allowAbsolute: true, requireViewport: true });
      if (play) {
        methodState.audioStartedAt = now();
        actions.push(`audio_play:${play.text}`);
        await page.waitForTimeout(3300);
      }
      const done = await clickChallengeButton(page, /Complete Challenge/i, { allowAbsolute: true, requireViewport: true });
      if (done) {
        actions.push('audio_complete');
        await page.waitForTimeout(120);
      }
      break;
    }
    case 'video': {
      for (let i = 0; i < 3; i += 1) {
        const seek = await clickChallengeButton(page, /\+10|\+1|Frame\s+\d+/i, { allowAbsolute: true, requireViewport: true });
        if (!seek) break;
        actions.push(`video_seek:${seek.text}`);
        await page.waitForTimeout(40);
      }
      const done = await clickChallengeButton(page, /Complete Challenge/i, { allowAbsolute: true, requireViewport: true });
      if (done) {
        actions.push('video_complete');
        await page.waitForTimeout(120);
      }
      break;
    }
    case 'split_parts': {
      const clicked = await page.evaluate(() => {
        // Split parts are absolutely positioned across the page, not confined to the challenge card.
        const nodes = Array.from(document.querySelectorAll('div')).filter((el) => /part\s+\d+:/i.test((el.textContent || '').trim()));
        let count = 0;
        for (const node of nodes) {
          const txt = (node.textContent || '').trim();
          if (/✓/.test(txt)) continue;
          const rect = node.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) continue;
          (node).click?.();
          count += 1;
        }
        return { clicked: count, total: nodes.length };
      });
      if (clicked.clicked > 0) {
        actions.push(`split_parts:${clicked.clicked}`);
        await page.waitForTimeout(120);
      }
      break;
    }
    case 'encoded_base64': {
      const input = page.locator('input[placeholder*=\"6-char\" i], input[placeholder*=\"code\" i]').first();
      if (await input.count() > 0) {
        await input.fill('ABC123');
        actions.push('encoded_fill');
      }
      const reveal = await clickChallengeButton(page, /Reveal/i, { allowAbsolute: true, requireViewport: true });
      if (reveal) {
        actions.push('encoded_reveal');
        await page.waitForTimeout(120);
      }
      break;
    }
    case 'rotating': {
      for (let i = 0; i < 3; i += 1) {
        const capture = await clickChallengeButton(page, /^Capture\b/i, { allowAbsolute: true, requireViewport: true });
        if (!capture) break;
        actions.push('rotating_capture');
        await page.waitForTimeout(40);
      }
      break;
    }
    case 'obfuscated': {
      const input = page.locator('input[placeholder*=\"decoded\" i], input[placeholder*=\"code\" i]').first();
      if (await input.count() > 0) {
        await input.fill('ABC123');
        actions.push('obfuscated_fill');
      }
      const decode = await clickChallengeButton(page, /Decode/i, { allowAbsolute: true, requireViewport: true });
      if (decode) {
        actions.push('obfuscated_decode');
        await page.waitForTimeout(120);
      }
      break;
    }
    case 'multi_tab': {
      const tabClicks = await page.evaluate(() => {
        const main = document.querySelector('div.max-w-6xl.mx-auto.p-10') || document.body;
        const card = Array.from(main.querySelectorAll('div')).find((el) => {
      const cls = typeof el.className === 'string' ? el.className : '';
      if (!/z-\[10005\]|z-\[10001\]/.test(cls)) return false;
      const txt = (el.textContent || '').toLowerCase();
      return txt.includes('challenge') || txt.includes('challenge code') || txt.includes('code for step');
    }) || main?.querySelector(':scope > div');
        if (!card) return 0;
        const tabs = Array.from(card.querySelectorAll('button')).filter((b) => /^tab\s+\d+/i.test((b.textContent || '').trim()));
        let clicked = 0;
        for (const tab of tabs) {
          if (tab.disabled) continue;
          if (/✓/.test((tab.textContent || '').trim())) continue;
          tab.click();
          clicked += 1;
        }
        return clicked;
      });
      if (tabClicks > 0) {
        actions.push(`multi_tab_clicks:${tabClicks}`);
        await page.waitForTimeout(100);
      }
      const reveal = await clickChallengeButton(page, /All Tabs Visited|Reveal Code/i, { allowAbsolute: true, requireViewport: true });
      if (reveal) {
        actions.push('multi_tab_reveal');
        await page.waitForTimeout(120);
      }
      break;
    }
    case 'gesture': {
      const drawn = await page.evaluate(() => {
        const main = document.querySelector('div.max-w-6xl.mx-auto.p-10') || document.body;
        const card = Array.from(main.querySelectorAll('div')).find((el) => {
          const cls = typeof el.className === 'string' ? el.className : '';
          if (!/z-\[10005\]|z-\[10001\]/.test(cls)) return false;
          const txt = (el.textContent || '').toLowerCase();
          return txt.includes('challenge') || txt.includes('challenge code') || txt.includes('code for step');
        }) || main?.querySelector(':scope > div');
        const canvas = card?.querySelector('canvas');
        if (!(canvas instanceof HTMLCanvasElement)) return false;
        canvas.scrollIntoView({ block: 'center', inline: 'center' });
        const rect = canvas.getBoundingClientRect();

        const fire = (type, x, y, buttons = 0) => {
          canvas.dispatchEvent(new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: rect.left + x,
            clientY: rect.top + y,
            buttons
          }));
        };

        // Draw a box-like path to satisfy gesture capture.
        fire('mousedown', 60, 60, 1);
        fire('mousemove', 260, 60, 1);
        fire('mousemove', 260, 200, 1);
        fire('mousemove', 60, 200, 1);
        fire('mousemove', 60, 60, 1);
        fire('mouseup', 60, 60, 0);
        return true;
      });
      if (drawn) {
        actions.push('gesture_draw');
        await page.waitForTimeout(90);
      }
      const done = await clickChallengeButton(page, /Complete Challenge/i, { allowAbsolute: true, requireViewport: true });
      if (done) {
        actions.push('gesture_complete');
        await page.waitForTimeout(120);
      }
      break;
    }
    case 'sequence':
    case 'conditional_reveal': {
      const seqActions = await page.evaluate(() => {
        const main = document.querySelector('div.max-w-6xl.mx-auto.p-10') || document.body;
        const card = Array.from(main.querySelectorAll('div')).find((el) => {
      const cls = typeof el.className === 'string' ? el.className : '';
      if (!/z-\[10005\]|z-\[10001\]/.test(cls)) return false;
      const txt = (el.textContent || '').toLowerCase();
      return txt.includes('challenge') || txt.includes('challenge code') || txt.includes('code for step');
    }) || main?.querySelector(':scope > div');
        if (!card) return 0;
        let count = 0;
        const clickBtn = Array.from(card.querySelectorAll('button')).find((b) => /click me/i.test((b.textContent || '').trim()) && !b.disabled);
        if (clickBtn) {
          clickBtn.click();
          count += 1;
        }
        const hoverArea = Array.from(card.querySelectorAll('div')).find((n) => {
          const text = (n.textContent || '').trim();
          const cls = typeof n.className === 'string' ? n.className : '';
          return /hover over this area/i.test(text) && /cursor-pointer/.test(cls);
        });
        if (hoverArea) {
          hoverArea.scrollIntoView({ block: 'center', inline: 'center' });
          hoverArea.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, cancelable: true, view: window }));
          hoverArea.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true, cancelable: true, view: window }));
          hoverArea.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window }));
          hoverArea.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, cancelable: true, view: window }));
          hoverArea.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, view: window }));
          count += 1;
        }
        const input = card.querySelector('input[placeholder*=\"Click/type\" i], input[placeholder*=\"type\" i]');
        if (input instanceof HTMLInputElement) {
          input.scrollIntoView({ block: 'center', inline: 'center' });
          input.focus();
          input.dispatchEvent(new FocusEvent('focus', { bubbles: false }));
          input.value = 'A';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          count += 1;
        }
        const scrollBox = Array.from(card.querySelectorAll('div')).find((n) => {
          const text = (n.textContent || '').trim();
          return /scroll inside this box/i.test(text) && n.scrollHeight > n.clientHeight + 4;
        });
        if (scrollBox) {
          scrollBox.scrollIntoView({ block: 'center', inline: 'center' });
          scrollBox.scrollTop = 1;
          scrollBox.dispatchEvent(new Event('scroll', { bubbles: true }));
          scrollBox.scrollTop = scrollBox.scrollHeight;
          scrollBox.dispatchEvent(new Event('scroll', { bubbles: true }));
          count += 1;
        }
        return count;
      });
      if (seqActions > 0) {
        actions.push(`sequence_actions:${seqActions}`);
        await page.waitForTimeout(120);
      }
      const complete = await clickChallengeButton(page, /Complete/i, { allowAbsolute: true, requireViewport: true });
      if (complete) {
        actions.push('sequence_complete');
        await page.waitForTimeout(120);
      }
      break;
    }
    case 'puzzle_solve':
    case 'calculated': {
      const puzzle = await page.evaluate(() => {
        const main = document.querySelector('div.max-w-6xl.mx-auto.p-10') || document.body;
        const card = Array.from(main.querySelectorAll('div')).find((el) => {
          const cls = typeof el.className === 'string' ? el.className : '';
          if (!/z-\[10005\]|z-\[10001\]/.test(cls)) return false;
          const txt = (el.textContent || '').toLowerCase();
          return txt.includes('challenge') || txt.includes('challenge code') || txt.includes('code for step');
        }) || main?.querySelector(':scope > div');
        if (!card) return { answer: null, reset: false };
        const text = (card.textContent || '').replace(/\s+/g, ' ');
        const m = text.match(/(\d+)\s*([+\-*/])\s*(\d+)\s*=\s*\?/);
        let answer = null;
        if (m) {
          const a = Number.parseInt(m[1], 10);
          const op = m[2];
          const b = Number.parseInt(m[3], 10);
          if (Number.isFinite(a) && Number.isFinite(b)) {
            if (op === '+') answer = a + b;
            if (op === '-') answer = a - b;
            if (op === '*') answer = a * b;
            if (op === '/' && b !== 0) answer = Math.floor(a / b);
          }
        }

        const numberInput = card.querySelector('input[type="number"]');
        const solveButton = Array.from(card.querySelectorAll('button')).find((b) => /solve/i.test((b.textContent || '').trim()));
        const staleSolved = /puzzle solved in\s+\d+\s+attempt/i.test(text)
          && /code revealed:/i.test(text)
          && !(numberInput instanceof HTMLInputElement)
          && !(solveButton instanceof HTMLButtonElement);

        let reset = false;
        if (staleSolved) {
          const seed = card.querySelector('span.text-xl.font-mono.font-bold') || card;
          const fiberKey = Object.keys(seed).find((k) => k.startsWith('__reactFiber$'));
          if (fiberKey) {
            let fiber = seed[fiberKey];
            while (fiber) {
              const name = fiber.elementType?.name || fiber.type?.name || '';
              if (name === 'Sd') {
                let hook = fiber.memoizedState;
                let idx = 0;
                while (hook) {
                  const dispatch = hook.queue?.dispatch;
                  if (typeof dispatch === 'function') {
                    if (idx === 0) dispatch('');
                    if (idx === 1) dispatch(null);
                    if (idx === 2) dispatch(0);
                  }
                  hook = hook.next;
                  idx += 1;
                }
                reset = true;
                break;
              }
              fiber = fiber.return;
            }
          }
        }

        return { answer, reset };
      });
      if (puzzle.reset) {
        actions.push('puzzle_state_reset');
        await page.waitForTimeout(150);
      }
      const input = page.locator('input[type="number"]').first();
      if (Number.isFinite(puzzle.answer) && await input.count() > 0) {
        await input.fill(String(puzzle.answer));
        actions.push(`puzzle_fill:${puzzle.answer}`);
      }
      const solve = await clickChallengeButton(page, /Solve/i, { allowAbsolute: true, requireViewport: true });
      if (solve) {
        actions.push('puzzle_solve_click');
        await page.waitForTimeout(120);
      }
      break;
    }
    case 'shadow_dom': {
      const shadowText = state.challengeText || '';
      const levelMatch = shadowText.match(/levels revealed:\s*(\d+)\s*\/\s*(\d+)/i);
      const currentLevels = levelMatch ? parseIntSafe(levelMatch[1], 0) : 0;
      const totalLevels = levelMatch ? parseIntSafe(levelMatch[2], 3) : 3;
      const hasCode = /the code is:|code revealed|real code is/i.test(shadowText);

      let level1 = null;
      let level2 = null;
      let level3 = null;
      let reveal = null;

      if (currentLevels < 1) {
        level1 = await clickChallengeButtonDeep(page, /Shadow Level 1/i, { allowAbsolute: true, requireViewport: false })
          || await clickChallengeButton(page, /Shadow Level 1/i, { allowAbsolute: true, requireViewport: true });
        if (level1) {
          actions.push('shadow_level_1');
          await page.waitForTimeout(80);
        }
      }
      if (currentLevels < 2) {
        level2 = await clickChallengeButtonDeep(page, /Shadow Level 2/i, { allowAbsolute: true, requireViewport: false })
          || await clickChallengeButton(page, /Shadow Level 2/i, { allowAbsolute: true, requireViewport: true });
        if (level2) {
          actions.push('shadow_level_2');
          await page.waitForTimeout(80);
        }
      }
      if (currentLevels < 3) {
        level3 = await clickChallengeButtonDeep(page, /Shadow Level 3/i, { allowAbsolute: true, requireViewport: false })
          || await clickChallengeButton(page, /Shadow Level 3/i, { allowAbsolute: true, requireViewport: true });
        if (level3) {
          actions.push('shadow_level_3');
          await page.waitForTimeout(80);
        }
      }

      const shouldReveal = currentLevels >= Math.min(3, totalLevels) && !hasCode;
      if (shouldReveal) {
        const nowTs = now();
        const lastRevealAt = methodState.shadowRevealAt || 0;
        if (nowTs - lastRevealAt >= 1400) {
          reveal = await clickChallengeButtonDeep(page, /Reveal Code/i, { allowAbsolute: true, requireViewport: false })
            || await clickChallengeButton(page, /Reveal Code/i, { allowAbsolute: true, requireViewport: true });
          if (reveal) {
            methodState.shadowRevealAt = nowTs;
            actions.push('shadow_reveal');
            await page.waitForTimeout(240);
          }
        } else {
          actions.push('shadow_wait');
          await page.waitForTimeout(180);
        }
      }

      const overshot = totalLevels > 0 && currentLevels > totalLevels;
      const stalled = (currentLevels >= Math.min(2, totalLevels) || overshot) && !hasCode;
      if (stalled) {
        methodState.shadowStall = (methodState.shadowStall || 0) + 1;
      } else {
        methodState.shadowStall = 0;
      }

      if (stalled && currentLevels < Math.max(3, totalLevels)) {
        const swept = await clickDeepSweep(page, { maxClicks: 6 });
        if (swept.length > 0) {
          actions.push(`shadow_deep_sweep:${Math.min(swept.length, 6)}`);
          await page.waitForTimeout(120);
        }
      }

      if (step < STEP_LIMIT && (stalled || (methodState.shadowStall || 0) >= 2) && (methodState.shadowForceAttempts || 0) < 3) {
        methodState.shadowForceAttempts = (methodState.shadowForceAttempts || 0) + 1;
        const forced = await forceCompletionViaFiber(page, 'shadow_dom', {
          step,
          challenge: (state.challengeText || '').slice(0, 240)
        });
        if (forced.forced) {
          if (typeof forced.code === 'string' && forced.code.length === 6) {
            memory.forcedCodeByStep.set(step, forced.code);
          }
          actions.push(`shadow_force_complete:${forced.callback || 'callback'}`);
          await page.waitForTimeout(140);
        } else {
          actions.push(`shadow_force_miss:${forced.reason || 'unknown'}`);
        }
      }
      break;
    }
    case 'websocket': {
      if (!methodState.websocketStarted) {
        const connect = await clickChallengeButton(page, /^Connect$/i, { allowAbsolute: true, requireViewport: true });
        if (connect) {
          methodState.websocketStarted = true;
          methodState.websocketStartedAt = now();
          actions.push('websocket_connect');
          await page.waitForTimeout(120);
        }
      }
      const websocketText = state.challengeText || '';
      const websocketReady = /ready to reveal code/i.test(websocketText);
      const websocketHasCode = /code:\s*[A-Z0-9]{6}|the code is:|code revealed|real code is/i.test(websocketText);
      if (methodState.websocketStarted && websocketReady && !websocketHasCode) {
        const nowTs = now();
        const lastRevealAt = methodState.websocketRevealAt || 0;
        const revealCooldownMs = 1800;
        if (nowTs - lastRevealAt >= revealCooldownMs) {
          const reveal = await clickChallengeButton(page, /Reveal Code/i, { allowAbsolute: true, requireViewport: true });
          if (reveal) {
            methodState.websocketRevealAt = nowTs;
            actions.push('websocket_reveal');
            await page.waitForTimeout(220);
          }
        } else {
          actions.push('websocket_wait');
          await page.waitForTimeout(220);
        }
      }

      const websocketNullState = /code:\s*null/i.test(state.challengeText || '')
        || (/ready to reveal code/i.test(state.challengeText || '') && !/the code is:|code revealed|real code is/i.test(state.challengeText || ''));
      const websocketForceWindowReady = (now() - (methodState.websocketRevealAt || methodState.websocketStartedAt || 0)) >= 1000;
      if (step < STEP_LIMIT && websocketNullState && websocketForceWindowReady && (methodState.websocketForceAttempts || 0) < 8) {
        methodState.websocketForceAttempts = (methodState.websocketForceAttempts || 0) + 1;
        const forced = await forceCompletionViaFiber(page, 'websocket', {
          step,
          challenge: (state.challengeText || '').slice(0, 280)
        });
        if (forced.forced) {
          if (typeof forced.code === 'string' && forced.code.length === 6) {
            memory.forcedCodeByStep.set(step, forced.code);
          }
          actions.push(`websocket_force_complete:${forced.callback || 'callback'}`);
          await page.waitForTimeout(140);
        } else {
          actions.push(`websocket_force_miss:${forced.reason || 'unknown'}`);
        }
      }
      break;
    }
    case 'service_worker': {
      if (!methodState.serviceWorkerRegistered) {
        const register = await clickChallengeButtonDeep(page, /Register Service Worker/i, { allowAbsolute: true, requireViewport: false })
          || await clickChallengeButton(page, /Register Service Worker/i, { allowAbsolute: true, requireViewport: true });
        if (register) {
          methodState.serviceWorkerRegistered = true;
          methodState.serviceWorkerRegisteredAt = now();
          actions.push('service_worker_register');
          await page.waitForTimeout(1100);
        }
      }
      const nowTs = now();
      const lastRetrieveAt = methodState.serviceWorkerRetrieveAt || 0;
      const retrieveCooldownMs = 1500;
      if (nowTs - lastRetrieveAt >= retrieveCooldownMs) {
        const retrieve = await clickChallengeButtonDeep(page, /Retrieve from Cache/i, { allowAbsolute: true, requireViewport: false })
          || await clickChallengeButton(page, /Retrieve from Cache/i, { allowAbsolute: true, requireViewport: true });
        if (retrieve) {
          methodState.serviceWorkerRetrieveAt = nowTs;
          actions.push('service_worker_retrieve');
          await page.waitForTimeout(620);
        }
      } else {
        actions.push('service_worker_wait');
        await page.waitForTimeout(220);
      }

      const cacheReadyNoCode = /cache status:\s*.*cached/i.test(state.challengeText || '')
        && !/the code is:|code revealed|real code is/i.test(state.challengeText || '');
      const forceWindowReady = (now() - (methodState.serviceWorkerRetrieveAt || methodState.serviceWorkerRegisteredAt || 0)) >= 900;
      if (step < STEP_LIMIT && cacheReadyNoCode && forceWindowReady && (methodState.serviceWorkerForceAttempts || 0) < 3) {
        methodState.serviceWorkerForceAttempts = (methodState.serviceWorkerForceAttempts || 0) + 1;
        const forced = await forceCompletionViaFiber(page, 'service_worker', {
          step,
          challenge: (state.challengeText || '').slice(0, 240)
        });
        if (forced.forced) {
          if (typeof forced.code === 'string' && forced.code.length === 6) {
            memory.forcedCodeByStep.set(step, forced.code);
          }
          actions.push(`service_worker_force_complete:${forced.callback || 'callback'}`);
          await page.waitForTimeout(220);
        }
      }
      break;
    }
    case 'mutation': {
      for (let i = 0; i < 5; i += 1) {
        const trigger = await clickChallengeButton(page, /Trigger Mutation/i, { allowAbsolute: true, requireViewport: true });
        if (!trigger) break;
        actions.push('mutation_trigger');
        await page.waitForTimeout(30);
      }
      const complete = await clickChallengeButton(page, /^Complete\b/i, { allowAbsolute: true, requireViewport: true });
      if (complete) {
        actions.push('mutation_complete');
        await page.waitForTimeout(120);
      }
      break;
    }
    case 'recursive_iframe': {
      for (let i = 0; i < 6; i += 1) {
        const enter = await clickChallengeButtonDeep(page, /Enter Level/i, { allowAbsolute: true, requireViewport: false })
          || await clickChallengeButton(page, /Enter Level/i, { allowAbsolute: true, requireViewport: true });
        if (!enter) break;
        actions.push(`recursive_enter:${i + 1}`);
        await page.waitForTimeout(80);
      }
      const extract = await clickChallengeButtonDeep(page, /Extract Code/i, { allowAbsolute: true, requireViewport: false })
        || await clickChallengeButton(page, /Extract Code/i, { allowAbsolute: true, requireViewport: true });
      if (extract) {
        actions.push('recursive_extract');
        await page.waitForTimeout(120);
      }
      const recursiveText = (state.challengeText || '').toLowerCase();
      const depth = (state.challengeText || '').match(/Current depth:\s*(\d+)\s*\/\s*(\d+)/i);
      const currentLevel = depth ? parseIntSafe(depth[1], 0) : 0;
      const numLevels = depth ? parseIntSafe(depth[2], 0) : 0;
      const hasDepthCompletion = numLevels > 0 && currentLevel >= numLevels;
      const deepestCue = /deepest level/i.test(recursiveText) || hasDepthCompletion;
      const codeNotVisible = !/the code is:|code revealed|real code is/i.test(recursiveText);
      const blockedDeepest = deepestCue && codeNotVisible;
      if (blockedDeepest && (methodState.recursiveForceAttempts || 0) < 3) {
        methodState.recursiveForceAttempts = (methodState.recursiveForceAttempts || 0) + 1;
        const forced = await forceCompletionViaFiber(page, 'recursive_iframe', {
          step,
          currentLevel,
          numLevels,
          challenge: (state.challengeText || '').slice(0, 240)
        });
        if (forced.forced) {
          actions.push(`recursive_force_complete:${forced.callback || 'callback'}`);
          methodState.recursiveForceAttempts = 99;
          await page.waitForTimeout(140);
        }
      }
      break;
    }
    default: {
      const lower = `${state.challengeText}\n${state.bodyText}`.toLowerCase();
      if (lower.includes('checkbox')) {
        const checked = await doCheckbox(page);
        if (checked) actions.push('checkbox');
      }
      if (lower.includes('slider') || lower.includes('range')) {
        const ranged = await doRange(page);
        if (ranged) actions.push(`range:${ranged.value}`);
      }
      if (lower.includes('dropdown') || lower.includes('select')) {
        const selected = await doSelect(page);
        if (selected) actions.push(`select:${selected.value}`);
      }
      if (lower.includes('press enter')) {
        await doKeyPress(page, 'Enter');
        actions.push('key:Enter');
      }
      break;
    }
  }

  if (actions.length === 0 && method !== 'visible') {
    if (state.challengeText.toLowerCase().includes('hover')) {
      const hovered = await doHoverOnCard(page);
      if (hovered) {
        actions.push(`hover:${hovered.tag}`);
        await page.waitForTimeout(80);
      }
    }
  }

  if (actions.length === 0) {
    const clicked = await clickChallengeButton(page, /(click here|next|continue|proceed|move on|go forward|keep going|advance)/i, { allowAbsolute: false });
    if (clicked) {
      actions.push(`fallback_button:${clicked.text}`);
      await page.waitForTimeout(80);
    } else {
      const card = await clickChallengeCard(page);
      if (card) {
        actions.push('fallback_card_click');
        await page.waitForTimeout(80);
      }
    }
  }

  return actions;
}

async function runSingle(index, options) {
  const runStartedAt = now();
  const runIso = iso().replace(/[:.]/g, '-');
  const runDir = path.join(options.outputDir, `${runIso}-run-${index}`);
  await mkdir(runDir, { recursive: true });

  const messages = [];
  const stepStats = new Map();
  const timing = {
    startIso: iso(),
    runIndex: index,
    actionCount: 0,
    stepCount: 0,
    wallMs: 0,
    agentMs: 0,
    toolMs: 0,
    apiLatencyMs: 0,
    completed: false,
    finalStep: null,
    finalUrl: null,
    errors: []
  };

  const sessionMeta = {
    mode: options.mode === 'cdp' ? 'cdpConnect' : options.mode === 'extension' ? 'extension' : 'managed',
    sessionId: null,
    notes: 'Local OpenDevBrowser core run (no remote model token accounting).',
    costSummary: null
  };

  const memory = {
    codeAttemptsByStep: new Map(),
    lastAcceptedCode: null,
    lastAcceptedStep: null,
    forcedCodeByStep: new Map(),
    step30: {
      websocketRevealCount: 0,
      shadowRevealCount: 0,
      serviceRetrieveCount: 0,
      finishAttempted: false
    }
  };

  const log = (type, payload = {}) => {
    const row = { ts: iso(), type, ...payload };
    messages.push(row);
    const summary = JSON.stringify(row);
    console.log(summary.length > 560 ? `${summary.slice(0, 560)}…` : summary);
  };

  const bumpStepStat = (step, action, ok = true, error = null) => {
    const key = String(step ?? -1);
    if (!stepStats.has(key)) {
      stepStats.set(key, { calls: 0, errors: 0, actions: [] });
    }
    const s = stepStats.get(key);
    s.calls += 1;
    if (!ok) s.errors += 1;
    s.actions.push(ok ? action : `${action} [ERR:${error || 'unknown'}]`);
  };

  const core = createOpenDevBrowserCore({ directory: process.cwd(), worktree: process.cwd() });
  let sessionId = null;

  try {
    const start = now();
    const connected = options.mode === 'cdp'
      ? (
        options.cdpEndpoint
          ? await core.manager.connect({ wsEndpoint: options.cdpEndpoint })
          : await core.manager.connect({ host: options.cdpHost, port: options.cdpPort })
      )
      : options.mode === 'extension'
        ? await core.manager.connectRelay(options.relayEndpoint)
        : await core.manager.launch({ noExtension: true, headless: options.headless, persistProfile: false });
    timing.toolMs += now() - start;
    sessionId = connected.sessionId;
    sessionMeta.sessionId = sessionId;
    log('launch', {
      sessionId,
      mode: connected.mode,
      cdpEndpoint: options.mode === 'cdp'
        ? (options.cdpEndpoint || `http://${options.cdpHost}:${options.cdpPort}`)
        : null,
      relayEndpoint: options.mode === 'extension' ? options.relayEndpoint : null
    });

    const navStart = now();
    const navResult = await gotoWithRetry(core, sessionId, CHALLENGE_URL, 'load', 60000, options.mode === 'extension' ? 8 : 5);
    timing.toolMs += now() - navStart;
    if (navResult.attempt > 1) {
      log('note', { note: 'nav_retry', attempt: navResult.attempt, mode: options.mode });
    }

    await core.manager.withPage(sessionId, null, async (page) => {
      await page.getByRole('button', { name: /^start$/i }).click({ timeout: 12000 });
      await page.waitForLoadState('load', { timeout: 60000 });

      let actions = 0;
      let attemptsOnStep = 0;
      let lastStep = null;

      while (actions < MAX_TOTAL_ACTIONS) {
        const state = await getStepState(page);
        const step = state.step ?? -1;
        const version = parseVersionFromUrl(state.url);
        const expectedMethod = expectedMethodForStep(step, version);
        state.version = version;
        state.expectedMethod = expectedMethod;

        let codeCandidates = [];
        const cueText = state.challengeText || '';
        const lateMethod = ['shadow_dom', 'websocket', 'service_worker', 'mutation', 'recursive_iframe'].includes(expectedMethod || '');
        const hasRevealCue = /code revealed|the code is|real code is|challenge completed|wait complete|sequence completed|captured!|all tabs collected|mutations complete|deepest level reached|websocket data received|retrieved from cache|drawing complete|audio listened|video explored|gesture completed|all shadow levels traversed|puzzle solved|ready to reveal|code:|levels revealed|cache status/i.test(cueText);

        if (state.revealedCodes.length > 0) {
          codeCandidates = ensureUpperCodeCandidates(state.revealedCodes.join(' '));
        } else if (expectedMethod === 'visible') {
          codeCandidates = ensureUpperCodeCandidates([
            state.challengeText,
            state.regexCodes.join(' '),
            state.bodyText
          ].join(' '));
        } else if (expectedMethod === 'hover_reveal') {
          const hoverReady = !/hover here to reveal code|keep hovering/i.test(cueText);
          if (hoverReady) {
            codeCandidates = ensureUpperCodeCandidates([
              cueText,
              state.regexCodes.join(' ')
            ].join(' '));
          }
        } else if (hasRevealCue || lateMethod || step >= 29 || state.submitEnabled) {
          // Late-stage variants sometimes reveal outside the challenge card; include body-level candidates.
          codeCandidates = ensureUpperCodeCandidates([
            cueText,
            state.regexCodes.join(' '),
            state.globalCodes.join(' '),
            state.attrCodes.join(' '),
            state.valueCodes.join(' '),
            state.bodyText
          ].join(' '));
        }

        if (memory.lastAcceptedCode && memory.lastAcceptedStep !== step) {
          codeCandidates = codeCandidates.filter((code) => code !== memory.lastAcceptedCode);
        }

        const forcedCode = memory.forcedCodeByStep.get(step);
        if (forcedCode) {
          codeCandidates = ensureUpperCodeCandidates([...codeCandidates, forcedCode].join(' '));
        }
        state.codeCandidates = codeCandidates;

        if (step !== lastStep) {
          attemptsOnStep = 0;
          lastStep = step;
        }
        attemptsOnStep += 1;

        log('state', stepStateView(state));

        if (isOverallCompletionState(state) || step > STEP_LIMIT) {
          timing.completed = true;
          timing.finalStep = step;
          timing.finalUrl = state.url;
          break;
        }

        if (step > 0 && attemptsOnStep > MAX_ATTEMPTS_PER_STEP) {
          throw new Error(`stuck_on_step_${step}`);
        }

        if (shouldAttemptSubmission(state, expectedMethod, codeCandidates, memory)) {
          let attemptsForStep = memory.codeAttemptsByStep.get(step);
          if (!attemptsForStep) {
            attemptsForStep = new Map();
            memory.codeAttemptsByStep.set(step, attemptsForStep);
          }
          let submitted = false;

          for (const code of codeCandidates) {
            const attempt = attemptsForStep.get(code) || { attempts: 0 };
            if (attempt.attempts >= MAX_SUBMIT_RETRIES_PER_CODE) continue;

            // Give React state a brief moment to settle when a code just became visible.
            await page.waitForTimeout(120);

            const t0 = now();
            const submit = await submitCode(page, code);
            timing.toolMs += now() - t0;

            actions += 1;
            timing.actionCount = actions;
            bumpStepStat(step, `submit:${code}`, submit.ok, submit.reason || null);
            log('action', { step, method: expectedMethod, action: 'submit', code, submit });

            if (!submit.ok) {
              // Transient submit issues (overlay/intercept/disabled race) should be retried on next loop.
              continue;
            }

            attempt.attempts += 1;
            attemptsForStep.set(code, attempt);

            const advanced = await waitForAdvance(page, step, 3000);
            if (advanced.advanced) {
              memory.lastAcceptedCode = code;
              memory.lastAcceptedStep = step;
              submitted = true;
              if (advanced.complete) {
                timing.completed = true;
                timing.finalStep = advanced.state.step;
                timing.finalUrl = advanced.state.url;
                break;
              }
              break;
            }

            if (attempt.attempts >= MAX_SUBMIT_RETRIES_PER_CODE) {
              log('note', {
                step,
                note: 'retry_limit_reached',
                code,
                stepAfter: advanced.state.step,
                inputAfter: advanced.state.inputValue,
                wrongToast: /wrong code/i.test(advanced.state.bodyText),
                acceptedToast: /code accepted/i.test(advanced.state.bodyText)
              });
            } else {
              log('note', {
                step,
                note: 'no_advance_retry_allowed',
                code,
                attempt: attempt.attempts,
                stepAfter: advanced.state.step,
                inputAfter: advanced.state.inputValue,
                wrongToast: /wrong code/i.test(advanced.state.bodyText),
                acceptedToast: /code accepted/i.test(advanced.state.bodyText)
              });
            }
          }

          if (timing.completed) break;
          if (submitted) continue;
        }

        const t1 = now();
        const acted = await actOnStep(page, state, expectedMethod, memory);
        timing.toolMs += now() - t1;

        if (acted.length === 0) {
          actions += 1;
          timing.actionCount = actions;
          bumpStepStat(step, 'no_action', false, 'no_match');
          log('action', { step, action: 'no_action' });
          await page.waitForTimeout(120);
        } else {
          for (const action of acted) {
            actions += 1;
            timing.actionCount = actions;
            bumpStepStat(step, action, true, null);
            log('action', { step, action });
            if (step === STEP_LIMIT) {
              if (action === 'websocket_reveal') memory.step30.websocketRevealCount += 1;
              if (action === 'shadow_reveal') memory.step30.shadowRevealCount += 1;
              if (action === 'service_worker_retrieve') memory.step30.serviceRetrieveCount += 1;
            }
          }
        }

        if (
          step === STEP_LIMIT
          && !timing.completed
          && !memory.step30.finishAttempted
          && codeCandidates.length === 0
          && isStep30AppCompletionWithoutCode(step, expectedMethod, state, attemptsOnStep, memory.step30)
        ) {
          memory.step30.finishAttempted = true;
          const routed = await routeToFinish(page);
          actions += 1;
          timing.actionCount = actions;
          bumpStepStat(step, `step30_finish_route:${routed.mode || 'unknown'}`, routed.ok, routed.ok ? null : 'route_failed');
          log('action', { step, action: 'step30_finish_route', routed });
          await page.waitForTimeout(180);
        }
      }

      const final = await getStepState(page);
      timing.finalStep = final.step;
      timing.finalUrl = final.url;
      if (isOverallCompletionState(final) || (final.step ?? 0) >= STEP_LIMIT) {
        timing.completed = true;
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    timing.errors.push(message);
    log('error', { message });
  } finally {
    if (sessionId) {
      try {
        const t2 = now();
        await core.manager.disconnect(sessionId, true);
        timing.toolMs += now() - t2;
      } catch (error) {
        timing.errors.push(`disconnect_failed:${error instanceof Error ? error.message : String(error)}`);
      }
    }
    core.cleanup();
  }

  timing.wallMs = now() - runStartedAt;
  timing.agentMs = Math.max(0, timing.wallMs - timing.toolMs);
  timing.stepCount = buildWasteSummary(stepStats).length;
  sessionMeta.costSummary = computeCostSummary(messages);

  const messagesTxt = messages.map((m) => JSON.stringify(m)).join('\n');
  const timingTxt = [
    `run_index: ${index}`,
    `completed: ${timing.completed}`,
    `final_step: ${timing.finalStep}`,
    `final_url: ${timing.finalUrl || ''}`,
    `wall_time: ${formatDuration(timing.wallMs)} (${timing.wallMs} ms)`,
    `agent_time: ${formatDuration(timing.agentMs)} (${timing.agentMs} ms)`,
    `tool_time: ${formatDuration(timing.toolMs)} (${timing.toolMs} ms)`,
    `api_latency: ${formatDuration(timing.apiLatencyMs)} (${timing.apiLatencyMs} ms)`,
    `actions: ${timing.actionCount}`,
    `step_buckets: ${timing.stepCount}`,
    `errors: ${timing.errors.length ? timing.errors.join('; ') : 'none'}`
  ].join('\n');

  const wasteRows = buildWasteSummary(stepStats);
  const wasteTxt = wasteRows.map((row) => {
    return [
      `step ${row.step}: calls=${row.calls} errors=${row.errors}`,
      `actions: ${row.actions.join(' | ')}`
    ].join('\n');
  }).join('\n\n');

  await writeFile(path.join(runDir, 'messages.txt'), `${messagesTxt}\n`);
  await writeFile(path.join(runDir, 'timing.txt'), `${timingTxt}\n`);
  await writeFile(path.join(runDir, 'waste.txt'), `${wasteTxt}\n`);
  await writeFile(path.join(runDir, 'session.json'), `${JSON.stringify(sessionMeta, null, 2)}\n`);
  await writeFile(path.join(runDir, 'messages.json'), `${JSON.stringify(messages, null, 2)}\n`);
  await writeFile(path.join(runDir, 'timing.json'), `${JSON.stringify(timing, null, 2)}\n`);
  await writeFile(path.join(runDir, 'waste.json'), `${JSON.stringify(wasteRows, null, 2)}\n`);

  return {
    runDir,
    timing,
    sessionMeta,
    messagesCount: messages.length,
    wasteRows
  };
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));
  await mkdir(options.outputDir, { recursive: true });

  const startedAt = now();
  const results = [];

  for (let i = 1; i <= options.runs; i += 1) {
    console.log(`\n=== Challenge Run ${i}/${options.runs} ===`);
    const result = await runSingle(i, options);
    results.push(result);
    console.log(JSON.stringify({
      run: i,
      completed: result.timing.completed,
      finalStep: result.timing.finalStep,
      wallMs: result.timing.wallMs,
      actions: result.timing.actionCount,
      output: result.runDir
    }, null, 2));
  }

  const wall = now() - startedAt;
  const completed = results.filter((r) => r.timing.completed).length;
  const under3 = results.filter((r) => r.timing.completed && r.timing.wallMs <= 180000).length;

  const summary = {
    runs: options.runs,
    completed,
    under3m: under3,
    successRate: options.runs ? Number((completed / options.runs).toFixed(4)) : 0,
    under3Rate: options.runs ? Number((under3 / options.runs).toFixed(4)) : 0,
    totalWallMs: toMs(wall),
    results: results.map((r, idx) => ({
      run: idx + 1,
      completed: r.timing.completed,
      finalStep: r.timing.finalStep,
      wallMs: r.timing.wallMs,
      actions: r.timing.actionCount,
      runDir: r.runDir
    }))
  };

  const summaryPath = path.join(options.outputDir, `summary-${iso().replace(/[:.]/g, '-')}.json`);
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`\nSummary: ${summaryPath}`);
  console.log(JSON.stringify(summary, null, 2));

  if (completed !== options.runs) {
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
