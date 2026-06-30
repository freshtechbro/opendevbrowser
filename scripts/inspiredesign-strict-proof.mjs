#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  ensureCli,
  getFreePort,
  runCli,
  startDaemon,
  terminateChild
} from "./cli-smoke-test.mjs";
import { INSTALL_AUTOSTART_SKIP_ENV_VAR } from "./live-direct-utils.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STRICT_PROOF_NAMESPACE = "inspiredesign-strict";
const REQUIRED_ARTIFACT_FILES = [
  "evidence.json",
  "ranked-references.json",
  "pin-media-index.json",
  "motion-evidence.json",
  "media-analysis.json",
  "bundle-manifest.json"
];
const PRODUCT_READY_AUTHORITY = "product_ready";
const DIAGNOSTIC_AUTHORITY = "diagnostic_only";
const VALID_STRICT_EVIDENCE_AUTHORITIES = new Set([
  "pin_media_ready",
  "motion_ready",
  "snapshot_ready"
]);
const MIN_PIN_MEDIA_BYTES = 1024;
const DEFAULT_STRICT_TIMEOUT_MS = 180_000;
const HELP_TEXT = [
  "Usage: node scripts/inspiredesign-strict-proof.mjs [options]",
  "",
  "Options:",
  "  --artifact-path <path>  Inspect an existing Inspiredesign bundle instead of running harvest",
  "  --workflow-json <path>  JSON response for --artifact-path inspection",
  "  --out-dir <path>        Proof output root (default: .opendevbrowser/inspiredesign-strict/<runId>)",
  "  --brief <text>          Harvest brief for live strict proof",
  "  --query <text>          Harvest query for live strict proof",
  "  --url <url>             Explicit reference URL for live strict proof, repeatable",
  "  --provider <id>         Harvest provider (default: web/default)",
  "  --timeout-ms <ms>       Live workflow timeout (default: 180000)",
  "  --quiet                Suppress progress logging",
  "  --help                 Show help"
].join("\n");

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

const readJsonFile = (filePath) => JSON.parse(fs.readFileSync(filePath, "utf8"));

const sha256File = (filePath) => createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");

const tokenDigest = (value) => createHash("sha256").update(value).digest("hex").slice(0, 16);

function parseArgs(argv) {
  const options = {
    artifactPath: null,
    workflowJsonPath: null,
    outDir: null,
    brief: "Design a premium editorial workspace landing page",
    query: "premium editorial workspace landing page design reference",
    urls: [],
    provider: "web/default",
    timeoutMs: DEFAULT_STRICT_TIMEOUT_MS,
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
    if (arg === "--artifact-path") {
      options.artifactPath = requireFlagValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--workflow-json") {
      options.workflowJsonPath = requireFlagValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--out-dir") {
      options.outDir = requireFlagValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--brief") {
      options.brief = requireFlagValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--query") {
      options.query = requireFlagValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--url") {
      options.urls.push(requireFlagValue(argv, index, arg));
      index += 1;
      continue;
    }
    if (arg === "--provider") {
      options.provider = requireFlagValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--timeout-ms") {
      options.timeoutMs = parsePositiveInteger(requireFlagValue(argv, index, arg), arg);
      index += 1;
      continue;
    }
    const inline = parseInlineFlag(arg);
    if (inline) {
      applyInlineFlag(options, inline.flag, inline.value);
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

function requireFlagValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function parseInlineFlag(arg) {
  const match = arg.match(/^(--[a-z-]+)=(.*)$/u);
  return match ? { flag: match[1], value: match[2] } : null;
}

function applyInlineFlag(options, flag, value) {
  if (flag === "--artifact-path") options.artifactPath = value;
  else if (flag === "--workflow-json") options.workflowJsonPath = value;
  else if (flag === "--out-dir") options.outDir = value;
  else if (flag === "--brief") options.brief = value;
  else if (flag === "--query") options.query = value;
  else if (flag === "--url") options.urls.push(value);
  else if (flag === "--provider") options.provider = value;
  else if (flag === "--timeout-ms") options.timeoutMs = parsePositiveInteger(value, flag);
  else throw new Error(`Unknown option: ${flag}`);
}

function parsePositiveInteger(value, flag) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} requires a positive integer.`);
  }
  return parsed;
}

function strictProofRoot(runId, outDir) {
  return outDir ? path.resolve(outDir) : path.join(ROOT, ".opendevbrowser", STRICT_PROOF_NAMESPACE, runId);
}

export async function createStrictRuntime() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "odb-inspiredesign-strict-"));
  const configDir = path.join(tempRoot, "config");
  const cacheDir = path.join(tempRoot, "cache");
  const daemonPort = await getFreePort();
  const relayPort = await getFreePort();
  const daemonToken = randomUUID().replaceAll("-", "");
  const relayToken = randomUUID().replaceAll("-", "");

  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, "opendevbrowser.jsonc"), `${JSON.stringify({
    relayPort,
    relayToken,
    daemonPort,
    daemonToken,
    headless: true,
    persistProfile: false
  }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });

  return {
    tempRoot,
    configDir,
    cacheDir,
    daemonPort,
    relayPort,
    daemonToken,
    relayToken,
    env: {
      ...process.env,
      OPENCODE_CONFIG_DIR: configDir,
      OPENCODE_CACHE_DIR: cacheDir,
      [INSTALL_AUTOSTART_SKIP_ENV_VAR]: "1"
    }
  };
}

export function inspectStrictRuntime(runtime) {
  const configUnique = Boolean(runtime.configDir) && runtime.configDir !== process.env.OPENCODE_CONFIG_DIR;
  const cacheUnique = Boolean(runtime.cacheDir) && runtime.cacheDir !== process.env.OPENCODE_CACHE_DIR;
  const configCacheDistinct = Boolean(runtime.configDir) && Boolean(runtime.cacheDir) && runtime.configDir !== runtime.cacheDir;
  const portsUnique = Number.isInteger(runtime.daemonPort) && Number.isInteger(runtime.relayPort) && runtime.daemonPort !== runtime.relayPort;
  const tokensUnique = typeof runtime.daemonToken === "string" && typeof runtime.relayToken === "string" && runtime.daemonToken !== runtime.relayToken;
  return {
    configDir: runtime.configDir,
    cacheDir: runtime.cacheDir,
    daemonPort: runtime.daemonPort,
    relayPort: runtime.relayPort,
    configUnique,
    cacheUnique,
    configCacheDistinct,
    portsUnique,
    tokensUnique,
    daemonTokenSha256: tokenDigest(String(runtime.daemonToken ?? "")),
    relayTokenSha256: tokenDigest(String(runtime.relayToken ?? ""))
  };
}

export function assertStrictRuntimeIsolation(runtime) {
  const inspection = inspectStrictRuntime(runtime);
  const failures = [];
  if (!inspection.configUnique) failures.push("config_dir_not_unique");
  if (!inspection.cacheUnique) failures.push("cache_dir_not_unique");
  if (!inspection.configCacheDistinct) failures.push("config_cache_not_distinct");
  if (!inspection.portsUnique) failures.push("ports_not_unique");
  if (!inspection.tokensUnique) failures.push("tokens_not_unique");
  if (failures.length > 0) {
    throw new Error(`strict_runtime_isolation_failed:${failures.join(",")}`);
  }
  return inspection;
}

export function assertCurrentDaemonFingerprint(statusJson) {
  if (!isRecord(statusJson) || statusJson.success !== true) {
    throw new Error("daemon_status_failed");
  }
  const data = isRecord(statusJson.data) ? statusJson.data : null;
  if (data?.fingerprintCurrent !== true) {
    const reason = typeof data?.reason === "string" ? data.reason : "daemon_fingerprint_missing";
    throw new Error(`daemon_fingerprint_not_current:${reason}`);
  }
  return statusJson;
}

function normalizeWorkflowPayload(workflowJson) {
  if (!isRecord(workflowJson)) return {};
  if (isRecord(workflowJson.data)) return workflowJson.data;
  return workflowJson;
}

function artifactListFromManifest(manifest) {
  if (!isRecord(manifest)) return [];
  return Array.isArray(manifest.files) ? manifest.files.filter((file) => typeof file === "string") : [];
}

function rankedReferenceList(rankedReferences) {
  if (Array.isArray(rankedReferences)) return rankedReferences;
  if (isRecord(rankedReferences) && Array.isArray(rankedReferences.references)) return rankedReferences.references;
  return [];
}

function pinMediaIndexList(pinMediaIndex) {
  if (Array.isArray(pinMediaIndex)) return pinMediaIndex;
  if (isRecord(pinMediaIndex) && Array.isArray(pinMediaIndex.pinMediaIndex)) return pinMediaIndex.pinMediaIndex;
  return [];
}

function motionEvidenceList(motionEvidence) {
  if (Array.isArray(motionEvidence)) return motionEvidence;
  if (isRecord(motionEvidence) && Array.isArray(motionEvidence.motionEvidence)) return motionEvidence.motionEvidence;
  return [];
}

function screenshotIndexList(screenshotIndex) {
  if (Array.isArray(screenshotIndex)) return screenshotIndex;
  if (isRecord(screenshotIndex) && Array.isArray(screenshotIndex.screenshots)) return screenshotIndex.screenshots;
  return [];
}

function resolveArtifactFilePath(artifactPath, relativePath) {
  if (typeof relativePath !== "string" || relativePath.trim() === "") {
    throw new Error("artifact_path_missing");
  }
  if (path.isAbsolute(relativePath) || relativePath.split(/[\\/]+/u).includes("..")) {
    throw new Error(`artifact_path_escapes_bundle:${relativePath}`);
  }
  const filePath = path.resolve(artifactPath, relativePath);
  const artifactRoot = path.resolve(artifactPath);
  if (filePath !== artifactRoot && !filePath.startsWith(`${artifactRoot}${path.sep}`)) {
    throw new Error(`artifact_path_escapes_bundle:${relativePath}`);
  }
  return filePath;
}

function artifactSummary(artifactPath, relativePath) {
  const filePath = resolveArtifactFilePath(artifactPath, relativePath);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error(`required_artifact_missing:${relativePath}`);
  }
  const bytes = fs.statSync(filePath).size;
  if (bytes <= 0) {
    throw new Error(`required_artifact_empty:${relativePath}`);
  }
  return { path: relativePath, bytes, sha256: sha256File(filePath) };
}

function requireManifestFiles(manifestFiles) {
  const missing = REQUIRED_ARTIFACT_FILES.filter((file) => !manifestFiles.includes(file));
  if (missing.length > 0) {
    throw new Error(`bundle_manifest_missing_required_files:${missing.join(",")}`);
  }
}

function validateReadiness(workflowPayload) {
  if (workflowPayload.ready !== true || workflowPayload.productSuccess !== true) {
    throw new Error("inspiredesign_diagnostic_only_bundle");
  }
  if (workflowPayload.artifactAuthority !== PRODUCT_READY_AUTHORITY) {
    throw new Error("inspiredesign_artifact_authority_not_product_ready");
  }
  if (!VALID_STRICT_EVIDENCE_AUTHORITIES.has(workflowPayload.evidenceAuthority)) {
    throw new Error("inspiredesign_evidence_authority_not_strict");
  }
}

function validateEvidenceJson(evidenceJson, evidenceAuthority) {
  if (!isRecord(evidenceJson)) {
    throw new Error("evidence_json_invalid");
  }
  if (
    evidenceJson.artifactAuthority === DIAGNOSTIC_AUTHORITY
    || evidenceJson.evidenceAuthority === DIAGNOSTIC_AUTHORITY
  ) {
    throw new Error("evidence_json_diagnostic_only");
  }
  const references = Array.isArray(evidenceJson.references) ? evidenceJson.references : [];
  if (references.length === 0) {
    throw new Error("evidence_json_references_missing");
  }
  const validatedReferences = references.map(validateEvidenceReference);
  const authorityAnnotatedReferences = validatedReferences.filter((reference) => (
    typeof reference.evidenceAuthority === "string" || Array.isArray(reference.capturedVia)
  ));
  if (
    authorityAnnotatedReferences.length > 0
    && !authorityAnnotatedReferences.some((reference) => referenceMatchesEvidenceAuthority(reference, evidenceAuthority))
  ) {
    throw new Error("evidence_json_reference_authority_mismatch");
  }
  return validatedReferences;
}

function validateEvidenceReference(reference, index) {
  if (!isRecord(reference)) throw new Error(`evidence_json_reference_invalid:${index}`);
  if (typeof reference.url !== "string" || reference.url.trim() === "") {
    throw new Error(`evidence_json_reference_missing_url:${index}`);
  }
  if (
    reference.artifactAuthority === DIAGNOSTIC_AUTHORITY
    || reference.evidenceAuthority === DIAGNOSTIC_AUTHORITY
  ) {
    throw new Error(`evidence_json_reference_diagnostic_only:${index}`);
  }
  return reference;
}

function referenceMatchesEvidenceAuthority(reference, evidenceAuthority) {
  return reference.evidenceAuthority === evidenceAuthority
    || (Array.isArray(reference.capturedVia) && reference.capturedVia.includes(evidenceAuthority));
}

function validateTopReference(references) {
  const topReference = references[0];
  if (!isRecord(topReference) || typeof topReference.url !== "string" || topReference.url.trim() === "") {
    throw new Error("ranked_reference_top_reference_missing_url");
  }
  if (topReference.evidenceAuthority === DIAGNOSTIC_AUTHORITY) {
    throw new Error("ranked_reference_top_reference_diagnostic_only");
  }
  return topReference;
}

function validatePinMediaAuthority(workflowPayload, pinMediaIndex, artifactPath) {
  if (workflowPayload.evidenceAuthority !== "pin_media_ready") return [];
  if (pinMediaIndex.length === 0) {
    throw new Error("pin_media_authority_missing_index");
  }
  return pinMediaIndex.map((entry, index) => inspectPinMediaEntry(entry, index, artifactPath));
}

function inspectPinMediaEntry(entry, index, artifactPath) {
  if (!isRecord(entry)) throw new Error(`pin_media_index_entry_invalid:${index}`);
  if (entry.authority !== "design_evidence") throw new Error(`pin_media_index_entry_not_design_evidence:${index}`);
  if (typeof entry.path !== "string" || entry.path.trim() === "") throw new Error(`pin_media_index_entry_missing_path:${index}`);
  if (typeof entry.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(entry.sha256)) throw new Error(`pin_media_index_entry_missing_hash:${index}`);
  if (!Number.isInteger(entry.bytes) || entry.bytes < MIN_PIN_MEDIA_BYTES) throw new Error(`pin_media_index_entry_weak_bytes:${index}`);
  const filePath = resolveArtifactFilePath(artifactPath, entry.path);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) throw new Error(`pin_media_file_missing:${entry.path}`);
  const actualSha = sha256File(filePath);
  if (actualSha !== entry.sha256) throw new Error(`pin_media_file_hash_mismatch:${entry.path}`);
  return { path: entry.path, bytes: entry.bytes, sha256: entry.sha256 };
}

function validateMotionAuthority(workflowPayload, motionEvidence, artifactPath) {
  if (workflowPayload.evidenceAuthority !== "motion_ready") return [];
  if (motionEvidence.length === 0) {
    throw new Error("motion_authority_missing_evidence");
  }
  return motionEvidence.map((entry, index) => inspectMotionEntry(entry, index, artifactPath));
}

function inspectMotionEntry(entry, index, artifactPath) {
  const motion = isRecord(entry) && isRecord(entry.motion) ? entry.motion : null;
  if (!motion) throw new Error(`motion_evidence_entry_invalid:${index}`);
  if (motion.status !== "captured") throw new Error(`motion_evidence_entry_not_captured:${index}`);
  if (motion.authority !== "design_evidence") throw new Error(`motion_evidence_entry_not_design_evidence:${index}`);
  if (motion.diagnostic === true) throw new Error(`motion_evidence_entry_diagnostic:${index}`);
  if (Array.isArray(motion.diagnosticReasons) && motion.diagnosticReasons.length > 0) throw new Error(`motion_evidence_entry_diagnostic_reasons:${index}`);
  if (!Number.isInteger(motion.frameCount) || motion.frameCount <= 0) throw new Error(`motion_evidence_entry_weak_frames:${index}`);
  return {
    index,
    replay: inspectMotionFile(motion.replay, index, "replay", artifactPath),
    preview: inspectMotionFile(motion.preview, index, "preview", artifactPath)
  };
}

function inspectMotionFile(file, index, kind, artifactPath) {
  if (!isRecord(file)) throw new Error(`motion_${kind}_file_invalid:${index}`);
  if (typeof file.path !== "string" || file.path.trim() === "") throw new Error(`motion_${kind}_file_missing_path:${index}`);
  if (typeof file.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(file.sha256)) throw new Error(`motion_${kind}_file_missing_hash:${index}`);
  if (!Number.isInteger(file.bytes) || file.bytes <= 0) throw new Error(`motion_${kind}_file_weak_bytes:${index}`);
  const filePath = resolveArtifactFilePath(artifactPath, file.path);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) throw new Error(`motion_${kind}_file_missing:${file.path}`);
  const actualSha = sha256File(filePath);
  if (actualSha !== file.sha256) throw new Error(`motion_${kind}_file_hash_mismatch:${file.path}`);
  return { path: file.path, bytes: file.bytes, sha256: file.sha256 };
}

function validateSnapshotAuthority(workflowPayload, screenshots, artifactPath) {
  if (workflowPayload.evidenceAuthority !== "snapshot_ready") return [];
  if (screenshots.length === 0) {
    throw new Error("snapshot_authority_missing_screenshot_index");
  }
  return screenshots.map((entry, index) => inspectScreenshotEntry(entry, index, artifactPath));
}

function inspectScreenshotEntry(entry, index, artifactPath) {
  if (!isRecord(entry)) throw new Error(`screenshot_index_entry_invalid:${index}`);
  if (typeof entry.path !== "string" || entry.path.trim() === "") throw new Error(`screenshot_index_entry_missing_path:${index}`);
  if (typeof entry.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(entry.sha256)) throw new Error(`screenshot_index_entry_missing_hash:${index}`);
  if (!Number.isInteger(entry.bytes) || entry.bytes < MIN_PIN_MEDIA_BYTES) throw new Error(`screenshot_index_entry_weak_bytes:${index}`);
  const filePath = resolveArtifactFilePath(artifactPath, entry.path);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) throw new Error(`screenshot_file_missing:${entry.path}`);
  const actualSha = sha256File(filePath);
  if (actualSha !== entry.sha256) throw new Error(`screenshot_file_hash_mismatch:${entry.path}`);
  return { path: entry.path, bytes: entry.bytes, sha256: entry.sha256 };
}

function assertMediaAnalysisAdvisoryOnly(value, trail = "media-analysis") {
  if (value === PRODUCT_READY_AUTHORITY) {
    throw new Error(`media_analysis_claims_product_authority:${trail}`);
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertMediaAnalysisAdvisoryOnly(entry, `${trail}[${index}]`));
    return;
  }
  if (!isRecord(value)) return;
  Object.entries(value).forEach(([key, entry]) => {
    assertMediaAnalysisAdvisoryOnly(entry, `${trail}.${key}`);
  });
}

export function inspectInspiredesignStrictBundle(artifactPath, workflowJson = {}) {
  if (typeof artifactPath !== "string" || artifactPath.trim() === "") {
    throw new Error("missing_inspiredesign_artifact_path");
  }
  if (!fs.existsSync(artifactPath) || !fs.statSync(artifactPath).isDirectory()) {
    throw new Error("inspiredesign_artifact_path_missing_on_disk");
  }
  if (path.basename(path.dirname(artifactPath)) !== "inspiredesign") {
    throw new Error("inspiredesign_artifact_namespace_mismatch");
  }

  const workflowPayload = normalizeWorkflowPayload(workflowJson);
  validateReadiness(workflowPayload);

  const artifactSummaries = REQUIRED_ARTIFACT_FILES.map((file) => artifactSummary(artifactPath, file));
  const manifest = readJsonFile(path.join(artifactPath, "bundle-manifest.json"));
  const manifestFiles = artifactListFromManifest(manifest);
  requireManifestFiles(manifestFiles);

  const evidenceJson = readJsonFile(path.join(artifactPath, "evidence.json"));
  const rankedReferencesJson = readJsonFile(path.join(artifactPath, "ranked-references.json"));
  const pinMediaIndexJson = readJsonFile(path.join(artifactPath, "pin-media-index.json"));
  const motionEvidenceJson = readJsonFile(path.join(artifactPath, "motion-evidence.json"));
  const mediaAnalysisJson = readJsonFile(path.join(artifactPath, "media-analysis.json"));
  const screenshotIndexJson = workflowPayload.evidenceAuthority === "snapshot_ready"
    ? readJsonFile(path.join(artifactPath, "screenshot-index.json"))
    : { screenshots: [] };
  const rankedReferences = rankedReferenceList(rankedReferencesJson);
  const pinMediaIndex = pinMediaIndexList(pinMediaIndexJson);
  const motionEvidence = motionEvidenceList(motionEvidenceJson);
  const screenshots = screenshotIndexList(screenshotIndexJson);
  const evidenceReferences = validateEvidenceJson(evidenceJson, workflowPayload.evidenceAuthority);
  const topReference = validateTopReference(rankedReferences);
  const inspectedPinMedia = validatePinMediaAuthority(workflowPayload, pinMediaIndex, artifactPath);
  const inspectedMotion = validateMotionAuthority(workflowPayload, motionEvidence, artifactPath);
  const inspectedScreenshots = validateSnapshotAuthority(workflowPayload, screenshots, artifactPath);

  if (workflowPayload.evidenceAuthority === "pin_media_ready" && inspectedPinMedia.length === 0) {
    throw new Error("pin_media_authority_not_inspected");
  }
  assertMediaAnalysisAdvisoryOnly(mediaAnalysisJson);

  return {
    status: "pass",
    artifactPath,
    readiness: {
      ready: workflowPayload.ready,
      productSuccess: workflowPayload.productSuccess,
      artifactAuthority: workflowPayload.artifactAuthority,
      evidenceAuthority: workflowPayload.evidenceAuthority
    },
    artifactSummaries,
    manifestFileCount: manifestFiles.length,
    rankedReferenceCount: rankedReferences.length,
    evidenceReferenceCount: evidenceReferences.length,
    topReference: {
      url: topReference.url,
      evidenceAuthority: topReference.evidenceAuthority ?? null,
      capturedVia: Array.isArray(topReference.capturedVia) ? topReference.capturedVia : []
    },
    pinMediaInspections: inspectedPinMedia,
    motionInspections: inspectedMotion,
    screenshotInspections: inspectedScreenshots,
    mediaAnalysisAdvisoryOnly: true
  };
}

function copyInspectedArtifacts(artifactPath, proofDir) {
  fs.mkdirSync(proofDir, { recursive: true });
  for (const file of REQUIRED_ARTIFACT_FILES) {
    fs.copyFileSync(path.join(artifactPath, file), path.join(proofDir, file));
  }
}

function writeInspectionReport(proofDir, report) {
  fs.mkdirSync(proofDir, { recursive: true });
  fs.writeFileSync(path.join(proofDir, "inspection-report.json"), `${JSON.stringify(report, null, 2)}\n`);
}

function loadWorkflowJson(options) {
  if (!options.workflowJsonPath) return {};
  return readJsonFile(path.resolve(options.workflowJsonPath));
}

async function runExistingArtifactInspection(options) {
  const runId = randomUUID();
  const proofDir = strictProofRoot(runId, options.outDir);
  const artifactPath = path.resolve(options.artifactPath);
  const workflowJson = loadWorkflowJson(options);
  const inspection = inspectInspiredesignStrictBundle(artifactPath, workflowJson);
  copyInspectedArtifacts(artifactPath, proofDir);
  writeInspectionReport(proofDir, { runId, proofDir, mode: "artifact_inspection", inspection });
  return { proofDir, inspection };
}

async function runLiveStrictProof(options) {
  ensureCli();
  const runId = randomUUID();
  const proofDir = strictProofRoot(runId, options.outDir);
  const runtime = await createStrictRuntime();
  const runtimeInspection = assertStrictRuntimeIsolation(runtime);
  const daemon = await startDaemon(runtime.env, runtime.daemonPort);
  try {
    const daemonStatus = runCli(["status", "--daemon", "--output-format", "json"], {
      env: runtime.env,
      timeoutMs: 15_000
    });
    assertCurrentDaemonFingerprint(daemonStatus.json);
    const sourceArgs = options.urls.length > 0
      ? options.urls.flatMap((url) => ["--url", url])
      : ["--query", options.query, "--provider", options.provider];
    const workflow = runCli([
      "inspiredesign",
      "harvest",
      "--brief",
      options.brief,
      ...sourceArgs,
      "--visual-evidence",
      "required",
      "--browser-mode",
      "managed",
      "--output-format",
      "json"
    ], {
      env: runtime.env,
      timeoutMs: options.timeoutMs
    });
    const artifactPath = workflow.json?.data?.artifact_path ?? workflow.json?.artifact_path;
    const inspection = inspectInspiredesignStrictBundle(String(artifactPath ?? ""), workflow.json);
    copyInspectedArtifacts(inspection.artifactPath, proofDir);
    writeInspectionReport(proofDir, {
      runId,
      proofDir,
      mode: "live_strict_harvest",
      runtime: runtimeInspection,
      daemonStatus: daemonStatus.json,
      command: "inspiredesign harvest",
      inspection
    });
    return { proofDir, inspection };
  } finally {
    runCli(["serve", "--stop"], { env: runtime.env, allowFailure: true, timeoutMs: 15_000 });
    await terminateChild(daemon);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = options.artifactPath
    ? await runExistingArtifactInspection(options)
    : await runLiveStrictProof(options);
  if (!options.quiet) {
    console.log(JSON.stringify({ success: true, proofDir: result.proofDir, inspection: result.inspection }, null, 2));
  }
}

export const __test__ = {
  REQUIRED_ARTIFACT_FILES,
  parseArgs,
  strictProofRoot,
  rankedReferenceList,
  pinMediaIndexList,
  motionEvidenceList,
  screenshotIndexList
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
