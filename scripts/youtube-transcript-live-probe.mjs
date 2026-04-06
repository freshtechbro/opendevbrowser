#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import {
  defaultArtifactPath,
  finalizeReport,
  pushStep,
  writeJson
} from "./live-direct-utils.mjs";

export const YOUTUBE_TRANSCRIPT_PROBE_STEP_ID = "workflow.youtube.transcript";
export const DEFAULT_YOUTUBE_TRANSCRIPT_PROBE_URL = "https://www.youtube.com/watch?v=M7lc1UVf-VE";
export const DEFAULT_YOUTUBE_TRANSCRIPT_MODE = "auto";
export const DEFAULT_YOUTUBE_TRANSCRIPT_TIMEOUT_MS = 120_000;
export const TRANSCRIPT_ENV_LIMITED_REASON_CODES = new Set([
  "strategy_unapproved",
  "token_required",
  "rate_limited",
  "env_limited"
]);

const HELP_TEXT = [
  "Usage: node scripts/youtube-transcript-live-probe.mjs [options]",
  "",
  "Options:",
  "  --url <url>             YouTube watch URL to probe",
  `  --youtube-mode <mode>   Transcript mode override (default: ${DEFAULT_YOUTUBE_TRANSCRIPT_MODE})`,
  "  --timeout-ms <ms>       Provider timeout budget",
  "  --out <path>            Output JSON path",
  "  --quiet                 Suppress per-step progress logging",
  "  --help                  Show help"
].join("\n");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function parseArgs(argv) {
  const options = {
    url: process.env.OPDEVBROWSER_YOUTUBE_TRANSCRIPT_URL ?? DEFAULT_YOUTUBE_TRANSCRIPT_PROBE_URL,
    youtubeMode: DEFAULT_YOUTUBE_TRANSCRIPT_MODE,
    timeoutMs: DEFAULT_YOUTUBE_TRANSCRIPT_TIMEOUT_MS,
    out: defaultArtifactPath("odb-youtube-transcript-live-probe"),
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
    if (arg === "--url") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("--url requires a value.");
      }
      options.url = next;
      index += 1;
      continue;
    }
    if (arg.startsWith("--url=")) {
      options.url = arg.slice("--url=".length);
      continue;
    }
    if (arg === "--youtube-mode") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("--youtube-mode requires a value.");
      }
      options.youtubeMode = next;
      index += 1;
      continue;
    }
    if (arg.startsWith("--youtube-mode=")) {
      options.youtubeMode = arg.slice("--youtube-mode=".length);
      continue;
    }
    if (arg === "--timeout-ms") {
      const next = argv[index + 1];
      const parsed = Number.parseInt(next ?? "", 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error("--timeout-ms requires a positive integer.");
      }
      options.timeoutMs = parsed;
      index += 1;
      continue;
    }
    if (arg.startsWith("--timeout-ms=")) {
      const parsed = Number.parseInt(arg.slice("--timeout-ms=".length), 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error("--timeout-ms requires a positive integer.");
      }
      options.timeoutMs = parsed;
      continue;
    }
    if (arg === "--out") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("--out requires a file path.");
      }
      options.out = next;
      index += 1;
      continue;
    }
    if (arg.startsWith("--out=")) {
      options.out = arg.slice("--out=".length);
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

function createProviderContext(timeoutMs) {
  return {
    trace: {
      requestId: `youtube-transcript-live-${randomUUID()}`,
      ts: new Date().toISOString()
    },
    timeoutMs,
    attempt: 1
  };
}

let cachedYouTubeProviderRuntime = null;

async function loadYouTubeProviderRuntime() {
  if (cachedYouTubeProviderRuntime) {
    return cachedYouTubeProviderRuntime;
  }

  const bundleDir = fs.mkdtempSync(path.join(os.tmpdir(), "odb-youtube-probe-bundle-"));
  const outfile = path.join(bundleDir, "youtube-provider.mjs");
  await build({
    entryPoints: [path.join(ROOT, "src", "providers", "social", "youtube.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node18",
    outfile,
    sourcemap: false,
    logLevel: "silent"
  });
  cachedYouTubeProviderRuntime = await import(`${pathToFileURL(outfile).href}?ts=${Date.now()}`);
  return cachedYouTubeProviderRuntime;
}

function asRecord(value) {
  return value && typeof value === "object" ? value : null;
}

function extractReasonCode(error) {
  const details = asRecord(error?.details);
  const transcriptReasonCode = typeof details?.transcriptReasonCode === "string"
    ? details.transcriptReasonCode
    : null;
  const reasonCode = typeof details?.reasonCode === "string"
    ? details.reasonCode
    : (typeof error?.reasonCode === "string" ? error.reasonCode : null);
  return {
    reasonCode,
    transcriptReasonCode
  };
}

export function classifyTranscriptProbeFailure(error) {
  const message = error instanceof Error
    ? error.message
    : (typeof error?.message === "string" && error.message.length > 0
      ? error.message
      : String(error ?? "Unknown transcript probe failure."));
  const details = asRecord(error?.details);
  const { reasonCode, transcriptReasonCode } = extractReasonCode(error);
  const effectiveReasonCode = transcriptReasonCode ?? reasonCode;
  const envLimited = effectiveReasonCode
    ? TRANSCRIPT_ENV_LIMITED_REASON_CODES.has(effectiveReasonCode)
    : false;

  return {
    status: envLimited ? "env_limited" : "fail",
    detail: effectiveReasonCode ? `reason_codes=${effectiveReasonCode}` : message,
    data: {
      reasonCode,
      transcriptReasonCode,
      attemptChain: Array.isArray(details?.attemptChain) ? details.attemptChain : [],
      message
    }
  };
}

function buildSuccessStep(url, records, options) {
  const first = Array.isArray(records) ? records[0] : null;
  const attributes = asRecord(first?.attributes) ?? {};
  const transcriptFull = typeof attributes.transcript_full === "string"
    ? attributes.transcript_full
    : "";
  const transcriptStrategyDetail = typeof attributes.transcript_strategy_detail === "string"
    ? attributes.transcript_strategy_detail
    : null;
  const transcriptStrategy = typeof attributes.transcript_strategy === "string"
    ? attributes.transcript_strategy
    : null;
  const translationApplied = attributes.translation_applied === true;

  return {
    id: YOUTUBE_TRANSCRIPT_PROBE_STEP_ID,
    status: "pass",
    detail: transcriptStrategyDetail
      ? `transcript_strategy=${transcriptStrategyDetail}`
      : null,
    data: {
      url,
      records: Array.isArray(records) ? records.length : 0,
      title: typeof first?.title === "string" ? first.title : null,
      transcriptAvailable: attributes.transcript_available === true,
      transcriptMode: typeof attributes.transcript_mode === "string" ? attributes.transcript_mode : options.youtubeMode,
      transcriptLanguage: typeof attributes.transcript_language === "string" ? attributes.transcript_language : null,
      transcriptStrategy,
      transcriptStrategyDetail,
      translationApplied,
      transcriptLength: transcriptFull.length,
      attemptChain: Array.isArray(attributes.attempt_chain) ? attributes.attempt_chain : []
    }
  };
}

export async function runProbe(options) {
  const report = {
    startedAt: new Date().toISOString(),
    out: options.out,
    steps: []
  };
  const runtime = await loadYouTubeProviderRuntime();
  const provider = runtime.createYouTubeProvider(runtime.withDefaultYouTubeOptions());

  try {
    const records = await provider.fetch?.({
      url: options.url,
      filters: {
        requireTranscript: true,
        include_full_transcript: true,
        translateToEnglish: true,
        youtube_mode: options.youtubeMode
      }
    }, createProviderContext(options.timeoutMs));

    const step = Array.isArray(records) && records.length > 0
      ? buildSuccessStep(options.url, records, options)
      : {
        id: YOUTUBE_TRANSCRIPT_PROBE_STEP_ID,
        status: "fail",
        detail: "YouTube transcript probe returned no records.",
        data: {
          url: options.url,
          records: 0
        }
      };
    pushStep(report, step, {
      prefix: "[youtube-transcript]",
      logProgress: !options.quiet
    });
    report.summary = {
      status: step.status,
      detail: step.detail,
      data: step.data
    };
  } catch (error) {
    const verdict = classifyTranscriptProbeFailure(error);
    const step = {
      id: YOUTUBE_TRANSCRIPT_PROBE_STEP_ID,
      status: verdict.status,
      detail: verdict.detail,
      data: {
        url: options.url,
        youtubeMode: options.youtubeMode,
        ...verdict.data
      }
    };
    pushStep(report, step, {
      prefix: "[youtube-transcript]",
      logProgress: !options.quiet
    });
    report.summary = {
      status: step.status,
      detail: step.detail,
      data: step.data
    };
  }

  finalizeReport(report);
  writeJson(options.out, report);
  return report;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = await runProbe(options);
  console.log(options.out);
  console.log(JSON.stringify({
    ok: report.ok,
    counts: report.counts,
    summary: report.summary,
    out: options.out
  }, null, 2));
  if (!report.ok) {
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
