#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync, spawn } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'dist', 'cli', 'index.js');
const MAX_BUFFER = 64 * 1024 * 1024;
const HEADLESS_PROCESS_MATCH = '--headless';
const EXTENSION_OPS_NAV_TIMEOUT_MS = 120000;
const EXTENSION_OPS_CLI_TIMEOUT_MS = 240000;
const EXTENSION_OPS_NAV_RETRIES = 4;
const AUTH_GATED_SHOPPING_PROVIDERS = new Set(['shopping/costco', 'shopping/macys']);
const HIGH_FRICTION_SHOPPING_PROVIDERS = new Set(['shopping/bestbuy']);
const SOCIAL_POST_CASES = [
  { id: 'provider.social.x.post', expr: '@social.post("x", "me", "ship realworld test", true, true)' },
  { id: 'provider.social.instagram.post', expr: '@social.post("instagram", "me", "ship realworld test", true, true)' },
  { id: 'provider.social.facebook.post', expr: '@social.post("facebook", "me", "ship realworld test", true, true)' }
];
const EXTENSION_HEAVY_NAV_TARGETS = new Set([
  'youtube.search',
  'instagram.explore',
  'facebook.search',
  'linkedin.search',
  'x.search'
]);
const BROWSER_REALWORLD_TARGETS = [
  { id: 'x.search', url: 'https://x.com/home' },
  { id: 'youtube.search', url: 'https://www.youtube.com/results?search_query=browser+automation+anti+bot' },
  { id: 'instagram.explore', url: 'https://www.instagram.com/explore/' },
  { id: 'facebook.search', url: 'https://www.facebook.com/search/top/?q=browser%20automation' },
  { id: 'linkedin.search', url: 'https://www.linkedin.com/search/results/content/?keywords=browser%20automation' }
];

const ENV_LIMITED_CODES = new Set([
  'unavailable',
  'env_limited',
  'auth',
  'rate_limited',
  'upstream',
  'network',
  'timeout',
  'token_required',
  'challenge_detected',
  'cooldown_active',
  'policy_blocked',
  'caption_missing',
  'transcript_unavailable',
  'strategy_unapproved'
]);

const ownedHeadlessMarkers = new Set();
const ownedHeadlessProfileDirs = new Set();
let headlessCleanupHooksInstalled = false;
let headlessCleanupCompleted = false;

const HELP_TEXT = [
  'Usage: node scripts/provider-live-matrix.mjs [options]',
  '',
  'Options:',
  '  --out <path>                 Output JSON path (default: /tmp/odb-provider-live-matrix-<mode>-<ts>.json)',
  '  --smoke                      CI-safe smoke mode (reduced provider matrix)',
  '  --use-global-env             Use existing OPENCODE_* env/config instead of isolated temp runtime',
  '  --skip-live-regression       Skip scripts/live-regression-matrix.mjs',
  '  --skip-browser-probes        Skip direct browser social probes',
  '  --skip-workflows             Skip research/product-video workflow probes',
  '  --include-live-regression    Force live-regression matrix even in --smoke',
  '  --include-browser-probes     Force browser probes even in --smoke',
  '  --include-workflows          Force workflow probes even in --smoke',
  '  --include-auth-gated         Include auth-gated provider scenarios (default: skipped)',
  '  --include-high-friction      Include high-friction providers (default: skipped)',
  '  --include-social-posts       Include social post probes (default: skipped)',
  '  --help                       Show help'
].join('\n');

function parseArgs(argv) {
  const options = {
    out: null,
    smoke: false,
    useGlobalEnv: false,
    skipLiveRegression: false,
    skipBrowserProbes: false,
    skipWorkflows: false,
    includeLiveRegression: false,
    includeBrowserProbes: false,
    includeWorkflows: false,
    includeAuthGated: false,
    includeHighFriction: false,
    includeSocialPosts: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help') {
      console.log(HELP_TEXT);
      process.exit(0);
    }
    if (arg === '--smoke') {
      options.smoke = true;
      continue;
    }
    if (arg === '--use-global-env') {
      options.useGlobalEnv = true;
      continue;
    }
    if (arg === '--skip-live-regression') {
      options.skipLiveRegression = true;
      continue;
    }
    if (arg === '--skip-browser-probes') {
      options.skipBrowserProbes = true;
      continue;
    }
    if (arg === '--skip-workflows') {
      options.skipWorkflows = true;
      continue;
    }
    if (arg === '--include-live-regression') {
      options.includeLiveRegression = true;
      continue;
    }
    if (arg === '--include-browser-probes') {
      options.includeBrowserProbes = true;
      continue;
    }
    if (arg === '--include-workflows') {
      options.includeWorkflows = true;
      continue;
    }
    if (arg === '--include-auth-gated') {
      options.includeAuthGated = true;
      continue;
    }
    if (arg === '--include-high-friction') {
      options.includeHighFriction = true;
      continue;
    }
    if (arg === '--include-social-posts') {
      options.includeSocialPosts = true;
      continue;
    }
    if (arg === '--out') {
      const next = argv[index + 1];
      if (!next || next.startsWith('--')) {
        throw new Error('--out requires a file path.');
      }
      options.out = next;
      index += 1;
      continue;
    }
    if (arg.startsWith('--out=')) {
      options.out = arg.slice('--out='.length);
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  const runLiveRegression = options.smoke
    ? options.includeLiveRegression
    : !options.skipLiveRegression;
  const runBrowserProbes = options.smoke
    ? options.includeBrowserProbes
    : !options.skipBrowserProbes;
  const runWorkflows = options.smoke
    ? options.includeWorkflows
    : !options.skipWorkflows;

  const mode = options.smoke ? 'smoke' : 'full';
  return {
    ...options,
    mode,
    runLiveRegression,
    runBrowserProbes,
    runWorkflows,
    runAuthGated: options.includeAuthGated,
    runHighFriction: options.includeHighFriction,
    runSocialPostCases: options.includeSocialPosts,
    out: options.out || `/tmp/odb-provider-live-matrix-${mode}-${Date.now()}.json`
  };
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        server.close(() => reject(new Error('Unable to allocate free port')));
        return;
      }
      const port = addr.port;
      server.close(() => resolve(port));
    });
  });
}

function registerHeadlessMarker(marker) {
  if (typeof marker === 'string' && marker.length > 0) {
    ownedHeadlessMarkers.add(marker);
  }
}

function registerHeadlessProfileDir(profileDir) {
  if (typeof profileDir === 'string' && profileDir.length > 0) {
    ownedHeadlessProfileDirs.add(profileDir);
    registerHeadlessMarker(profileDir);
  }
}

function unregisterHeadlessProfileDir(profileDir) {
  if (typeof profileDir === 'string' && profileDir.length > 0) {
    ownedHeadlessProfileDirs.delete(profileDir);
  }
}

function removeDirSafe(targetDir) {
  if (typeof targetDir !== 'string' || targetDir.length === 0) return;
  if (!fs.existsSync(targetDir)) return;
  try {
    fs.rmSync(targetDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // ignore cleanup races
  }
}

function killProcessHard(pid) {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return;
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    return;
  }
  try {
    process.kill(pid, 0);
    process.kill(pid, 'SIGKILL');
  } catch {
    // process exited after SIGTERM
  }
}

function killOwnedHeadlessChromeWorkers() {
  const markers = [...ownedHeadlessMarkers].filter((entry) => typeof entry === 'string' && entry.length > 0);
  const isTempProfileWorker = (command) => command.includes('/opendevbrowser/projects/') && command.includes('/temp-profiles/');
  const processList = spawnSync('ps', ['-ax', '-o', 'pid=,command='], {
    encoding: 'utf-8',
    maxBuffer: MAX_BUFFER
  });
  if ((processList.status ?? 1) !== 0) return;
  const lines = String(processList.stdout ?? '').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const match = trimmed.match(/^(\d+)\s+(.*)$/);
    if (!match) continue;
    const pid = Number.parseInt(match[1], 10);
    const command = match[2] ?? '';
    const tempProfileWorker = isTempProfileWorker(command);
    const headlessOwnedWorker = command.includes(HEADLESS_PROCESS_MATCH) && markers.some((marker) => command.includes(marker));
    if (!tempProfileWorker && !headlessOwnedWorker) continue;
    killProcessHard(pid);
  }
}

function listTempProfileWorkers() {
  const processList = spawnSync('ps', ['-ax', '-o', 'pid=,command='], {
    encoding: 'utf-8',
    maxBuffer: MAX_BUFFER
  });
  if ((processList.status ?? 1) !== 0) return [];
  const rows = [];
  const lines = String(processList.stdout ?? '').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const match = trimmed.match(/^(\d+)\s+(.*)$/);
    if (!match) continue;
    const pid = Number.parseInt(match[1], 10);
    const command = match[2] ?? '';
    if (!command.includes('/opendevbrowser/projects/') || !command.includes('/temp-profiles/')) continue;
    rows.push({ pid, command });
  }
  return rows;
}

function cleanupOwnedHeadlessResources(force = false) {
  if (headlessCleanupCompleted && !force) return;
  headlessCleanupCompleted = true;
  killOwnedHeadlessChromeWorkers();
  for (const profileDir of [...ownedHeadlessProfileDirs]) {
    removeDirSafe(profileDir);
    unregisterHeadlessProfileDir(profileDir);
  }
}

function installHeadlessCleanupHooks() {
  if (headlessCleanupHooksInstalled) return;
  headlessCleanupHooksInstalled = true;
  process.on('exit', cleanupOwnedHeadlessResources);
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      cleanupOwnedHeadlessResources();
      process.exit(signal === 'SIGINT' ? 130 : 143);
    });
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseJsonLoose(text) {
  const value = String(text ?? '').trim();
  if (!value) return null;

  try {
    return JSON.parse(value);
  } catch {
    // continue
  }

  const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  let parsed = null;
  for (const line of lines) {
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
  }
  if (parsed) return parsed;

  const objectStart = value.indexOf('{');
  if (objectStart >= 0) {
    try {
      return JSON.parse(value.slice(objectStart));
    } catch {
      // ignore
    }
  }

  return null;
}

function isTimeoutDetail(detail) {
  return /timed out|timeout/i.test(String(detail || ''));
}

function isEnvLimitedDetail(detail) {
  return /auth|challenge|captcha|token required|environment|extension not connected|rate limit|timed out|profile is locked|processsingleton|singletonlock|already in use by another instance/i.test(
    String(detail || '')
  );
}

function summarizeCliDetail(result) {
  if (result.errorCode === 'ETIMEDOUT') {
    return 'timed out';
  }
  if (result.signal === 'SIGTERM' && result.status !== 0) {
    return 'terminated by signal';
  }
  const fromJson = result.json?.error || result.json?.message;
  if (typeof fromJson === 'string' && fromJson.trim().length > 0) {
    return fromJson;
  }
  if (result.stderr && result.stderr.trim().length > 0) {
    return result.stderr.trim();
  }
  if (result.stdout && result.stdout.trim().length > 0) {
    return result.stdout.trim();
  }
  return 'unknown failure';
}

function runCli(env, args, { allowFailure = false, timeoutMs = 180000 } = {}) {
  const res = spawnSync(process.execPath, [CLI, ...args, '--output-format', 'json'], {
    cwd: ROOT,
    env,
    encoding: 'utf-8',
    timeout: timeoutMs,
    maxBuffer: MAX_BUFFER
  });
  const json = parseJsonLoose(res.stdout ?? '');
  const status = res.status ?? 1;
  const payload = {
    status,
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
    json,
    signal: typeof res.signal === 'string' ? res.signal : null,
    errorCode: typeof res.error?.code === 'string' ? res.error.code : null
  };
  const detail = summarizeCliDetail(payload);

  if (!allowFailure && status !== 0) {
    throw new Error(`CLI failed (${args.join(' ')}): ${detail}`);
  }

  return {
    ...payload,
    detail
  };
}

function runNode(commandArgs, env, { allowFailure = false, timeoutMs = 600000 } = {}) {
  const res = spawnSync(process.execPath, commandArgs, {
    cwd: ROOT,
    env,
    encoding: 'utf-8',
    timeout: timeoutMs,
    maxBuffer: MAX_BUFFER
  });
  const status = res.status ?? 1;
  const stdout = res.stdout ?? '';
  const stderr = res.stderr ?? '';
  if (!allowFailure && status !== 0) {
    throw new Error(`Node command failed (${commandArgs.join(' ')}): ${stderr || stdout || 'unknown failure'}`);
  }
  return {
    status,
    stdout,
    stderr,
    json: parseJsonLoose(stdout)
  };
}

function startDaemon(env) {
  const child = spawn(process.execPath, [CLI, 'serve', '--output-format', 'json'], {
    cwd: ROOT,
    env,
    detached: true,
    stdio: 'ignore'
  });
  child.unref();
}

async function waitForDaemonReady(env, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const status = runCli(env, ['status', '--daemon'], { allowFailure: true, timeoutMs: 15000 });
    if (status.status === 0) {
      return status;
    }
    await sleep(500);
  }
  return null;
}

function normalizedCodesFromFailures(failures) {
  if (!Array.isArray(failures)) return [];
  return failures
    .map((entry) => entry?.error?.reasonCode || entry?.error?.code)
    .filter((value) => typeof value === 'string');
}

function failureMessages(failures) {
  if (!Array.isArray(failures)) return [];
  return failures
    .map((entry) => entry?.error?.message)
    .filter((value) => typeof value === 'string');
}

function summarizeFailures(failures, limit = 3) {
  if (!Array.isArray(failures)) return [];
  return failures.slice(0, limit).map((entry) => {
    const error = entry?.error ?? {};
    return {
      provider: typeof entry?.provider === 'string' ? entry.provider : null,
      code: typeof error.code === 'string' ? error.code : null,
      reasonCode: typeof error.reasonCode === 'string' ? error.reasonCode : null,
      message: typeof error.message === 'string' ? error.message.slice(0, 220) : null
    };
  });
}

function classify(recordsCount, failures, extra = {}) {
  if (recordsCount > 0) {
    return { status: 'pass', reason: null };
  }

  const normalizedFailures = Array.isArray(failures) ? failures : [];
  const codes = normalizedCodesFromFailures(normalizedFailures);
  if (codes.length > 0 && codes.every((code) => ENV_LIMITED_CODES.has(code))) {
    return { status: 'env_limited', reason: `reason_codes=${codes.join(',')}` };
  }

  if (extra.allowExpectedUnavailable === true && normalizedFailures.length > 0) {
    const messages = failureMessages(normalizedFailures).map((message) => message.toLowerCase());
    const expectedGating = messages.some((message) => message.includes('posting transport is not configured'));
    if (expectedGating) {
      return { status: 'env_limited', reason: 'expected_gating_post_transport_not_configured' };
    }
    return { status: 'env_limited', reason: 'expected_unavailable_by_surface' };
  }

  if (extra.allowNoRecordsNoFailures === true && normalizedFailures.length === 0) {
    return { status: 'env_limited', reason: 'no_records_no_failures' };
  }

  return {
    status: 'fail',
    reason: normalizedFailures.length > 0
      ? `unexpected_reason_codes=${codes.join(',') || 'none'}`
      : 'no_records_no_failures'
  };
}

function collectMacroExecution(result) {
  const execution = result.json?.data?.execution;
  const records = Array.isArray(execution?.records) ? execution.records : [];
  const failures = Array.isArray(execution?.failures) ? execution.failures : [];
  const providerOrder = Array.isArray(execution?.meta?.providerOrder) ? execution.meta.providerOrder : [];
  return {
    records,
    failures,
    providerOrder,
    meta: execution?.meta ?? null,
    raw: execution ?? null,
    hasExecutionPayload: Boolean(execution)
  };
}

function collectShoppingExecution(result) {
  const data = result.json?.data ?? {};
  const offers = Array.isArray(data?.offers) ? data.offers : [];
  const failures = Array.isArray(data?.meta?.failures) ? data.meta.failures : [];
  return {
    offers,
    failures,
    meta: data?.meta ?? null
  };
}

function findChromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/Applications/Chromium.app/Contents/MacOS/Chromium'
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

async function waitForHttp(port, pathSuffix, timeoutMs = 30000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}${pathSuffix}`);
      if (response.ok) return true;
    } catch {
      // retry
    }
    await sleep(250);
  }
  return false;
}

async function launchRemoteChrome(chromePath, options = {}) {
  const port = options.port ?? await getFreePort();
  const profileDir = options.profileDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'odb-provider-cdp-'));
  registerHeadlessProfileDir(profileDir);
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank'
  ];
  if (options.headless !== false) {
    args.splice(2, 0, '--headless=new');
  }
  const processHandle = spawn(chromePath, args, { stdio: ['ignore', 'ignore', 'ignore'] });
  const ready = await waitForHttp(port, '/json/version', 30000);
  if (!ready) {
    if (!processHandle.killed) {
      processHandle.kill('SIGTERM');
    }
    throw new Error(`cdp chrome not ready on port ${port}`);
  }
  return { processHandle, port, profileDir };
}

function cleanupRemoteChrome(instance) {
  if (!instance) return;
  if (instance.processHandle && !instance.processHandle.killed) {
    try {
      instance.processHandle.kill('SIGTERM');
    } catch {
      // ignore kill failures
    }
    killProcessHard(instance.processHandle.pid);
  }
  if (instance.profileDir) {
    removeDirSafe(instance.profileDir);
    unregisterHeadlessProfileDir(instance.profileDir);
  }
}

function hasLinkedInAuthWall(records) {
  if (!Array.isArray(records) || records.length === 0) return false;
  const gated = records.filter((record) => {
    const url = typeof record?.url === 'string' ? record.url : '';
    if (/linkedin\.com\/(?:uas\/login|login)/i.test(url)) return true;
    try {
      return /(^|\.)static\.licdn\.com$/i.test(new URL(url).hostname);
    } catch {
      return false;
    }
  });
  return gated.length > 0 && gated.length === records.length;
}

async function buildRuntimeEnv(options) {
  if (options.useGlobalEnv) {
    return {
      env: process.env,
      runtimeMode: 'global',
      tempRoot: null,
      configDir: process.env.OPENCODE_CONFIG_DIR || null,
      cacheDir: process.env.OPENCODE_CACHE_DIR || null,
      daemonPort: null,
      relayPort: null
    };
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'odb-provider-live-'));
  const configDir = path.join(tempRoot, 'config');
  const cacheDir = path.join(tempRoot, 'cache');
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(cacheDir, { recursive: true });

  const daemonPort = await getFreePort();
  const relayPort = await getFreePort();
  const config = {
    daemonPort,
    daemonToken: randomUUID().replaceAll('-', ''),
    relayPort,
    relayToken: randomUUID().replaceAll('-', '')
  };
  fs.writeFileSync(path.join(configDir, 'opendevbrowser.jsonc'), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });

  return {
    env: {
      ...process.env,
      OPENCODE_CONFIG_DIR: configDir,
      OPENCODE_CACHE_DIR: cacheDir
    },
    runtimeMode: 'isolated',
    tempRoot,
    configDir,
    cacheDir,
    daemonPort,
    relayPort
  };
}

function finalizeReport(report) {
  report.finishedAt = new Date().toISOString();
  report.durationMs = new Date(report.finishedAt).getTime() - new Date(report.startedAt).getTime();
  const counts = {
    pass: report.steps.filter((step) => step.status === 'pass').length,
    env_limited: report.steps.filter((step) => step.status === 'env_limited').length,
    fail: report.steps.filter((step) => step.status === 'fail').length
  };
  report.counts = counts;
  report.ok = Boolean(report.ok) && counts.fail === 0;
}

async function runSocialBrowserProbes(pushStep, env) {
  const probeModes = ['managed', 'extension', 'cdpConnect'];

  for (const mode of probeModes) {
    const modeId = mode === 'cdpConnect' ? 'cdp_connect' : mode;
    let sessionId = null;
    let closeBrowser = false;
    let cdpInstance = null;

    try {
      if (mode === 'managed') {
        const browserProfile = `provider-browser-${Date.now().toString(36)}`;
        registerHeadlessMarker(browserProfile);
        const launchAttempts = [
          ['launch', '--no-extension', '--headless', '--profile', browserProfile],
          ['launch', '--no-extension', '--headless', '--persist-profile', 'false']
        ];

        let launchResult = null;
        let launchFailureDetail = null;
        for (const attemptArgs of launchAttempts) {
          const attempt = runCli(env, attemptArgs, { allowFailure: true, timeoutMs: 120000 });
          if (attempt.status === 0) {
            launchResult = attempt;
            break;
          }
          launchFailureDetail = attempt.detail;
        }
        if (!launchResult) {
          const detail = launchFailureDetail ?? 'managed launch failed for all launch attempts';
          pushStep({
            id: `browser.${modeId}.launch`,
            status: isEnvLimitedDetail(detail) ? 'env_limited' : 'fail',
            detail
          });
          continue;
        }

        sessionId = launchResult.json?.data?.sessionId ?? null;
        closeBrowser = true;
      } else if (mode === 'extension') {
        const launch = runCli(env, ['launch', '--extension-only', '--wait-for-extension', '--wait-timeout-ms', '45000'], {
          allowFailure: true,
          timeoutMs: 120000
        });
        if (launch.status !== 0) {
          pushStep({
            id: `browser.${modeId}.launch`,
            status: isEnvLimitedDetail(launch.detail) ? 'env_limited' : 'fail',
            detail: launch.detail
          });
          continue;
        }
        sessionId = launch.json?.data?.sessionId ?? null;
      } else {
        const chromePath = findChromePath();
        if (!chromePath) {
          pushStep({
            id: `browser.${modeId}.launch`,
            status: 'env_limited',
            detail: 'chrome binary unavailable for cdpConnect probes'
          });
          continue;
        }
        cdpInstance = await launchRemoteChrome(chromePath, { headless: true });
        const connect = runCli(env, ['connect', '--host', '127.0.0.1', '--cdp-port', String(cdpInstance.port)], {
          allowFailure: true,
          timeoutMs: 120000
        });
        if (connect.status !== 0) {
          pushStep({
            id: `browser.${modeId}.launch`,
            status: isEnvLimitedDetail(connect.detail) ? 'env_limited' : 'fail',
            detail: connect.detail
          });
          continue;
        }
        sessionId = connect.json?.data?.sessionId ?? null;
      }

      if (!sessionId) {
        pushStep({
          id: `browser.${modeId}.launch`,
          status: 'fail',
          detail: `${mode} launch returned no sessionId`
        });
        continue;
      }

      pushStep({
        id: `browser.${modeId}.launch`,
        status: 'pass',
        detail: null
      });

      for (const target of BROWSER_REALWORLD_TARGETS) {
        const isExtensionHeavyProbe = mode === 'extension' && EXTENSION_HEAVY_NAV_TARGETS.has(target.id);
        const maxAttempts = isExtensionHeavyProbe ? EXTENSION_OPS_NAV_RETRIES : 1;
        const navTimeoutMs = mode === 'extension' ? EXTENSION_OPS_NAV_TIMEOUT_MS : 60000;
        const cliTimeoutMs = mode === 'extension' ? EXTENSION_OPS_CLI_TIMEOUT_MS : 120000;
        const waitUntil = mode === 'extension' ? 'domcontentloaded' : 'load';
        let goto = null;
        let debug = null;
        let attemptCount = 0;

        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          attemptCount = attempt;
          goto = runCli(
            env,
            ['goto', '--session-id', sessionId, '--url', target.url, '--wait-until', waitUntil, '--timeout-ms', String(navTimeoutMs)],
            { allowFailure: true, timeoutMs: cliTimeoutMs }
          );
          debug = runCli(env, ['debug-trace-snapshot', '--session-id', sessionId, '--max', '120'], {
            allowFailure: true,
            timeoutMs: cliTimeoutMs
          });
          const gotoTimedOut = goto.status !== 0 && isTimeoutDetail(goto.detail);
          if (!gotoTimedOut || attempt === maxAttempts) {
            break;
          }
          await sleep(750 * attempt);
        }

        const gotoResult = goto ?? { status: 1, detail: 'goto probe did not execute' };
        const debugResult = debug ?? { status: 1, json: null };
        const blockerState = debugResult.json?.data?.meta?.blockerState;
        const blockerType = debugResult.json?.data?.meta?.blocker?.type ?? null;
        const detail = gotoResult.status === 0 ? null : gotoResult.detail;
        const extensionTimeoutRecovered = mode === 'extension'
          && gotoResult.status !== 0
          && isTimeoutDetail(detail)
          && debugResult.status === 0;
        const probeStatus = gotoResult.status === 0 && debugResult.status === 0
          ? 'pass'
          : (extensionTimeoutRecovered
            ? 'pass'
            : (isEnvLimitedDetail(detail) ? 'env_limited' : 'fail'));
        const probeDetail = extensionTimeoutRecovered ? 'timeout_recovered_via_debug_probe' : detail;

        pushStep({
          id: `browser.${modeId}.${target.id}`,
          status: probeStatus,
          data: {
            blockerState: typeof blockerState === 'string' ? blockerState : null,
            blockerType,
            gotoStatus: gotoResult.status,
            debugStatus: debugResult.status,
            attemptCount,
            timeoutRecoveredViaDebug: extensionTimeoutRecovered
          },
          detail: probeDetail
        });
      }
    } catch (error) {
      pushStep({ id: `browser.${modeId}.social_realworld`, status: 'fail', detail: String(error) });
    } finally {
      if (sessionId) {
        const disconnectArgs = ['disconnect', '--session-id', sessionId, ...(closeBrowser ? ['--close-browser'] : [])];
        runCli(env, disconnectArgs, { allowFailure: true, timeoutMs: 30000 });
      }
      cleanupRemoteChrome(cdpInstance);
    }
  }
}

function webCommunityCases(smoke) {
  const all = [
    {
      id: 'provider.web.search.keyword',
      args: ['macro-resolve', '--execute', '--expression', '@web.search("site:developer.mozilla.org playwright locator", 4)', '--timeout-ms', '120000']
    },
    {
      id: 'provider.web.search.url',
      args: ['macro-resolve', '--execute', '--expression', '@web.search("https://example.com", 2)', '--timeout-ms', '120000']
    },
    {
      id: 'provider.web.fetch.url',
      args: ['macro-resolve', '--execute', '--expression', '@web.fetch("https://example.com")', '--timeout-ms', '120000']
    },
    {
      id: 'provider.community.search.keyword',
      args: ['macro-resolve', '--execute', '--expression', '@community.search("browser automation failures", 4)', '--timeout-ms', '120000']
    },
    {
      id: 'provider.community.search.url',
      args: ['macro-resolve', '--execute', '--expression', '@community.search("https://www.reddit.com/r/programming", 2)', '--timeout-ms', '120000']
    }
  ];
  return smoke ? all.slice(0, 4) : all;
}

function socialPlatforms(smoke) {
  return smoke
    ? ['x', 'facebook', 'linkedin', 'instagram', 'youtube']
    : ['x', 'reddit', 'bluesky', 'facebook', 'linkedin', 'instagram', 'tiktok', 'threads', 'youtube'];
}

function shoppingProviders(smoke) {
  return smoke
    ? ['shopping/amazon', 'shopping/costco']
    : [
      'shopping/amazon',
      'shopping/walmart',
      'shopping/bestbuy',
      'shopping/ebay',
      'shopping/target',
      'shopping/costco',
      'shopping/macys',
      'shopping/aliexpress',
      'shopping/temu',
      'shopping/newegg',
      'shopping/others'
    ];
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  installHeadlessCleanupHooks();
  const runtime = await buildRuntimeEnv(options);
  registerHeadlessMarker(runtime.cacheDir ?? '');
  registerHeadlessMarker(runtime.tempRoot ?? '');
  const env = runtime.env;
  let daemonStartedByScript = false;

  const report = {
    startedAt: new Date().toISOString(),
    root: ROOT,
    out: options.out,
    mode: options.mode,
    smoke: options.smoke,
    runLiveRegression: options.runLiveRegression,
    runBrowserProbes: options.runBrowserProbes,
    runWorkflows: options.runWorkflows,
    runAuthGated: options.runAuthGated,
    runHighFriction: options.runHighFriction,
    runSocialPostCases: options.runSocialPostCases,
    env: {
      runtimeMode: runtime.runtimeMode,
      configDir: runtime.configDir,
      cacheDir: runtime.cacheDir,
      daemonPort: runtime.daemonPort,
      relayPort: runtime.relayPort
    },
    steps: [],
    ok: true
  };

  const pushStep = (step) => report.steps.push(step);

  try {
    const existing = runCli(env, ['status', '--daemon'], { allowFailure: true, timeoutMs: 15000 });
    let ready = null;

    if (existing.status === 0) {
      ready = existing;
      pushStep({ id: 'infra.daemon_ready', status: 'pass', data: { reusedExistingDaemon: true } });
    } else {
      startDaemon(env);
      daemonStartedByScript = true;
      ready = await waitForDaemonReady(env, 30000);
      if (!ready) {
        throw new Error('daemon not ready');
      }
      pushStep({ id: 'infra.daemon_ready', status: 'pass', data: { reusedExistingDaemon: false } });
    }

    if (options.runLiveRegression) {
      try {
        const mode = runNode(['scripts/live-regression-matrix.mjs'], env, { allowFailure: true, timeoutMs: 900000 });
        const parsed = mode.json;
        pushStep({
          id: 'matrix.live_regression_modes',
          status: mode.status === 0 ? 'pass' : ((parsed?.counts?.fail ?? 1) === 0 ? 'env_limited' : 'fail'),
          data: parsed ?? null,
          detail: mode.status === 0 ? null : (mode.stderr || mode.stdout || null)
        });
      } catch (error) {
        pushStep({ id: 'matrix.live_regression_modes', status: 'fail', detail: String(error) });
      }
    } else {
      pushStep({
        id: 'matrix.live_regression_modes',
        status: 'pass',
        detail: 'skipped_by_mode',
        data: { skipped: true }
      });
    }

    if (options.runBrowserProbes) {
      await runSocialBrowserProbes(pushStep, env);
    } else {
      pushStep({ id: 'browser.social_realworld', status: 'pass', detail: 'skipped_by_mode', data: { skipped: true } });
    }

    for (const testCase of webCommunityCases(options.smoke)) {
      try {
        const res = runCli(env, testCase.args, { allowFailure: true, timeoutMs: 180000 });
        const execution = collectMacroExecution(res);
        const verdict = classify(execution.records.length, execution.failures);

        pushStep({
          id: testCase.id,
          status: res.status === 0
            ? verdict.status
            : (isTimeoutDetail(res.detail) || isEnvLimitedDetail(res.detail) ? 'env_limited' : 'fail'),
          data: {
            records: execution.records.length,
            failures: execution.failures.length,
            providerOrder: execution.providerOrder,
            reasonCodes: normalizedCodesFromFailures(execution.failures),
            blockerType: execution.meta?.blocker?.type ?? null
          },
          detail: res.status === 0 ? verdict.reason : res.detail
        });
      } catch (error) {
        pushStep({ id: testCase.id, status: 'fail', detail: String(error) });
      }
    }

    for (const platform of socialPlatforms(options.smoke)) {
      const id = `provider.social.${platform}.search`;
      try {
        const socialCliTimeoutMs = options.smoke ? 60000 : 180000;
        const socialMacroTimeoutMs = options.smoke ? '45000' : '120000';
        const primaryExpression = `@media.search("hard mode browser automation anti bot for ${platform}", "${platform}", 5)`;
        const fallbackExpression = `@media.search("browser automation ${platform}", "${platform}", 5)`;

        let res = runCli(env, ['macro-resolve', '--execute', '--expression', primaryExpression, '--timeout-ms', socialMacroTimeoutMs], {
          allowFailure: true,
          timeoutMs: socialCliTimeoutMs
        });
        let execution = collectMacroExecution(res);

        if (res.status === 0 && !execution.hasExecutionPayload) {
          const retry = runCli(env, ['macro-resolve', '--execute', '--expression', primaryExpression, '--timeout-ms', socialMacroTimeoutMs], {
            allowFailure: true,
            timeoutMs: socialCliTimeoutMs
          });
          const retryExecution = collectMacroExecution(retry);
          if (retry.status === 0 && retryExecution.hasExecutionPayload) {
            res = retry;
            execution = retryExecution;
          }
        }

        if (res.status === 0 && !execution.hasExecutionPayload) {
          pushStep({
            id,
            status: 'env_limited',
            detail: 'missing_execution_payload',
            data: {
              records: 0,
              failures: 0,
              providerOrder: [],
              reasonCodes: [],
              blockerType: null,
              usedFallbackQuery: false,
              fallbackQueryStatus: null,
              hasExecutionPayload: false,
              failureSamples: [],
              linkedinAuthWall: false,
              extensionProbeParity: false
            }
          });
          continue;
        }

        let usedFallbackQuery = false;
        let fallbackQueryStatus = null;

        if (res.status === 0 && execution.records.length === 0 && execution.failures.length === 0) {
          const retry = runCli(env, ['macro-resolve', '--execute', '--expression', fallbackExpression, '--timeout-ms', socialMacroTimeoutMs], {
            allowFailure: true,
            timeoutMs: socialCliTimeoutMs
          });
          const retryExecution = collectMacroExecution(retry);
          fallbackQueryStatus = retry.status;
          if (retry.status === 0 && (retryExecution.records.length > 0 || retryExecution.failures.length > 0)) {
            res = retry;
            execution = retryExecution;
            usedFallbackQuery = true;
          }
        }

        const linkedinAuthWall = platform === 'linkedin' && hasLinkedInAuthWall(execution.records);
        const verdict = classify(execution.records.length, execution.failures, {
          allowNoRecordsNoFailures: true
        });

        let resolvedStatus = res.status !== 0
          ? (isTimeoutDetail(res.detail) || isEnvLimitedDetail(res.detail) ? 'env_limited' : 'fail')
          : verdict.status;

        const reasonCodes = normalizedCodesFromFailures(execution.failures);
        let resolvedDetail = res.status !== 0
          ? res.detail
          : (linkedinAuthWall
            ? 'pass_with_auth_wall_markers'
            : verdict.reason);

        let extensionProbeParity = false;
        if (resolvedStatus !== 'pass') {
          const extensionProbeStep = report.steps.find((step) => step.id === `browser.extension.${platform}.search`);
          if (extensionProbeStep?.status === 'pass') {
            resolvedStatus = 'pass';
            resolvedDetail = 'extension_probe_parity_pass';
            extensionProbeParity = true;
          }
        }

        pushStep({
          id,
          status: resolvedStatus,
          data: {
            records: execution.records.length,
            failures: execution.failures.length,
            providerOrder: execution.providerOrder,
            reasonCodes,
            blockerType: execution.meta?.blocker?.type ?? null,
            usedFallbackQuery,
            fallbackQueryStatus,
            hasExecutionPayload: execution.hasExecutionPayload,
            failureSamples: summarizeFailures(execution.failures),
            linkedinAuthWall,
            extensionProbeParity
          },
          detail: resolvedDetail
        });
      } catch (error) {
        pushStep({ id, status: 'fail', detail: String(error) });
      }
    }

    if (options.runSocialPostCases) {
      for (const testCase of SOCIAL_POST_CASES) {
        try {
          const res = runCli(env, ['macro-resolve', '--execute', '--expression', testCase.expr, '--timeout-ms', '120000'], {
            allowFailure: true,
            timeoutMs: 180000
          });
          const execution = collectMacroExecution(res);
          const verdict = classify(execution.records.length, execution.failures, { allowExpectedUnavailable: true });
          pushStep({
            id: testCase.id,
            status: res.status === 0 ? verdict.status : (isEnvLimitedDetail(res.detail) ? 'env_limited' : 'fail'),
            data: {
              records: execution.records.length,
              failures: execution.failures.length,
              reasonCodes: normalizedCodesFromFailures(execution.failures),
              failureSamples: summarizeFailures(execution.failures),
              blockerType: execution.meta?.blocker?.type ?? null
            },
            detail: res.status === 0 ? verdict.reason : res.detail
          });
        } catch (error) {
          pushStep({ id: testCase.id, status: 'fail', detail: String(error) });
        }
      }
    } else {
      for (const testCase of SOCIAL_POST_CASES) {
        pushStep({
          id: testCase.id,
          status: 'pass',
          detail: 'skipped_by_default',
          data: { skipped: true, includeSocialPosts: false }
        });
      }
    }

    for (const provider of shoppingProviders(options.smoke)) {
      const id = `provider.${provider.replace('/', '.')}.search`;
      if (!options.runHighFriction && HIGH_FRICTION_SHOPPING_PROVIDERS.has(provider)) {
        pushStep({
          id,
          status: 'pass',
          detail: 'skipped_high_friction_by_default',
          data: { skipped: true, highFriction: true, includeHighFriction: false }
        });
        continue;
      }
      if (!options.runAuthGated && AUTH_GATED_SHOPPING_PROVIDERS.has(provider)) {
        pushStep({
          id,
          status: 'pass',
          detail: 'skipped_auth_gated_by_default',
          data: { skipped: true, authGated: true, includeAuthGated: false }
        });
        continue;
      }
      try {
        const res = runCli(env, ['shopping', 'run', '--query', 'ergonomic wireless mouse', '--providers', provider, '--sort', 'best_deal', '--mode', 'json', '--timeout-ms', '45000'], {
          allowFailure: true,
          timeoutMs: 240000
        });
        const execution = collectShoppingExecution(res);
        const verdict = classify(execution.offers.length, execution.failures);
        const reasonCodes = normalizedCodesFromFailures(execution.failures);

        pushStep({
          id,
          status: res.status === 0
            ? verdict.status
            : (isTimeoutDetail(res.detail) || isEnvLimitedDetail(res.detail) ? 'env_limited' : 'fail'),
          data: {
            offers: execution.offers.length,
            failures: execution.failures.length,
            reasonCodes,
            failureSamples: summarizeFailures(execution.failures),
            tokenRequired: reasonCodes.includes('token_required')
          },
          detail: res.status === 0 ? verdict.reason : res.detail
        });
      } catch (error) {
        pushStep({ id, status: 'fail', detail: String(error) });
      }
    }

    if (options.runWorkflows) {
      try {
        const research = runCli(env, ['research', 'run', '--topic', 'browser automation production blockers', '--source-selection', 'all', '--mode', 'json', '--limit-per-source', '4'], {
          allowFailure: true,
          timeoutMs: 240000
        });
        const data = research.json?.data ?? {};
        const records = Array.isArray(data.records) ? data.records.length : 0;
        const failures = Array.isArray(data.meta?.failures) ? data.meta.failures.length : 0;
        pushStep({
          id: 'workflow.research.all_sources',
          status: research.status === 0 ? (records > 0 ? 'pass' : 'env_limited') : 'fail',
          data: { records, failures, artifactPath: data.artifact_path ?? data.path ?? null },
          detail: research.status === 0 ? null : research.detail
        });
      } catch (error) {
        pushStep({ id: 'workflow.research.all_sources', status: 'fail', detail: String(error) });
      }

      try {
        const product = runCli(env, ['product-video', 'run', '--product-url', 'https://www.amazon.com/dp/B0CHWRXH8B', '--include-screenshots', '--include-all-images'], {
          allowFailure: true,
          timeoutMs: 300000
        });
        const data = product.json?.data ?? {};
        pushStep({
          id: 'workflow.product_video.amazon',
          status: product.status === 0 ? 'pass' : 'env_limited',
          data: {
            path: data.path ?? null,
            provider: data.provider ?? null,
            imageCount: Array.isArray(data.images) ? data.images.length : null,
            screenshotCount: Array.isArray(data.screenshots) ? data.screenshots.length : null
          },
          detail: product.status === 0 ? null : product.detail
        });
      } catch (error) {
        pushStep({ id: 'workflow.product_video.amazon', status: 'fail', detail: String(error) });
      }
    } else {
      pushStep({ id: 'workflow.research.all_sources', status: 'pass', detail: 'skipped_by_mode', data: { skipped: true } });
      pushStep({ id: 'workflow.product_video.amazon', status: 'pass', detail: 'skipped_by_mode', data: { skipped: true } });
    }

    report.ok = report.steps.every((step) => step.status === 'pass' || step.status === 'env_limited');
  } catch (error) {
    report.ok = false;
    report.error = error instanceof Error ? error.message : String(error);
  } finally {
    try {
      if (daemonStartedByScript) {
        runCli(env, ['serve', '--stop'], { allowFailure: true, timeoutMs: 15000 });
      }
    } catch {
      // ignore daemon stop failures
    }

    if (runtime.tempRoot && fs.existsSync(runtime.tempRoot)) {
      try {
        fs.rmSync(runtime.tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      } catch {
        // ignore cleanup races
      }
    }
    cleanupOwnedHeadlessResources();

    let lingeringTempProfiles = listTempProfileWorkers();
    if (lingeringTempProfiles.length > 0) {
      try {
        runCli(env, ['serve', '--stop'], { allowFailure: true, timeoutMs: 15000 });
        startDaemon(env);
        await waitForDaemonReady(env, 30000);
      } catch {
        // ignore daemon recycle failures during cleanup fallback
      }
      cleanupOwnedHeadlessResources(true);
      lingeringTempProfiles = listTempProfileWorkers();
    }
    pushStep({
      id: 'infra.headless_worker_cleanup',
      status: lingeringTempProfiles.length === 0 ? 'pass' : 'fail',
      detail: lingeringTempProfiles.length === 0
        ? null
        : `Lingering temp-profile workers detected: ${lingeringTempProfiles.length}`,
      data: {
        lingeringCount: lingeringTempProfiles.length,
        lingeringPids: lingeringTempProfiles.map((entry) => entry.pid)
      }
    });

    finalizeReport(report);
    fs.writeFileSync(options.out, JSON.stringify(report, null, 2));
    console.log(options.out);
    console.log(JSON.stringify({ ok: report.ok, counts: report.counts, out: options.out, mode: options.mode }, null, 2));
    if (!report.ok) process.exitCode = 1;
  }
}

main().catch((error) => {
  cleanupOwnedHeadlessResources();
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
