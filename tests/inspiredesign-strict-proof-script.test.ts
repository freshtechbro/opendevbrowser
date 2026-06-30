import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertCurrentDaemonFingerprint,
  assertStrictRuntimeIsolation,
  inspectInspiredesignStrictBundle,
  inspectStrictRuntime,
  __test__
} from "../scripts/inspiredesign-strict-proof.mjs";

const pinBytes = Buffer.alloc(2048, 7);
const pinSha = createHash("sha256").update(pinBytes).digest("hex");
const screenshotBytes = Buffer.alloc(4096, 9);
const screenshotSha = createHash("sha256").update(screenshotBytes).digest("hex");
const motionReplayBytes = Buffer.alloc(2048, 3);
const motionReplaySha = createHash("sha256").update(motionReplayBytes).digest("hex");
const motionPreviewBytes = Buffer.alloc(2048, 4);
const motionPreviewSha = createHash("sha256").update(motionPreviewBytes).digest("hex");

function writeJson(path: string, value: unknown) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function makeWorkflow(artifactPath: string, overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    data: {
      ready: true,
      productSuccess: true,
      artifactAuthority: "product_ready",
      evidenceAuthority: "pin_media_ready",
      artifact_path: artifactPath,
      ...overrides
    }
  };
}

function makeBundle(overrides: {
  workflow?: Record<string, unknown>;
  manifestFiles?: string[];
  evidence?: Record<string, unknown>;
  pinMediaEntry?: Record<string, unknown>;
  mediaAnalysis?: Record<string, unknown>;
  rankedReference?: Record<string, unknown>;
  motionEvidence?: unknown;
  screenshotEntry?: Record<string, unknown>;
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "odb-inspiredesign-strict-test-"));
  const artifactPath = join(root, "inspiredesign", "run-1");
  mkdirSync(join(artifactPath, "pin-media-evidence", "pin-ref"), { recursive: true });
  mkdirSync(join(artifactPath, "visual-evidence", "pin-ref"), { recursive: true });
  writeFileSync(join(artifactPath, "pin-media-evidence", "pin-ref", "main.jpg"), pinBytes);
  writeFileSync(join(artifactPath, "visual-evidence", "pin-ref", "viewport.png"), screenshotBytes);

  const requiredFiles = [...__test__.REQUIRED_ARTIFACT_FILES];
  writeJson(join(artifactPath, "bundle-manifest.json"), {
    run_id: "run-1",
    files: overrides.manifestFiles ?? [...requiredFiles, "pin-media-evidence/pin-ref/main.jpg"]
  });
  const defaultEvidenceAuthority = typeof overrides.workflow?.evidenceAuthority === "string"
    ? overrides.workflow.evidenceAuthority
    : "pin_media_ready";
  writeJson(join(artifactPath, "evidence.json"), {
    references: [{ url: "https://www.pinterest.com/pin/123/" }],
    ...overrides.evidence
  });
  writeJson(join(artifactPath, "ranked-references.json"), {
    references: [{
      id: "pin-ref",
      url: "https://www.pinterest.com/pin/123/",
      evidenceAuthority: defaultEvidenceAuthority,
      capturedVia: [defaultEvidenceAuthority],
      ...overrides.rankedReference
    }]
  });
  writeJson(join(artifactPath, "pin-media-index.json"), {
    pinMediaIndex: [{
      referenceId: "pin-ref",
      url: "https://www.pinterest.com/pin/123/",
      sourceUrl: "https://www.pinterest.com/pin/123/",
      mediaUrl: "https://i.pinimg.com/originals/pin.jpg",
      path: "pin-media-evidence/pin-ref/main.jpg",
      sha256: pinSha,
      bytes: pinBytes.length,
      width: 1200,
      height: 1600,
      contentType: "image/jpeg",
      kind: "image",
      authority: "design_evidence",
      firstPartyProvenance: {
        referenceUrlCanonical: true,
        sourceUrlMatchesReference: true,
        mediaUrlFirstParty: true
      },
      warnings: [],
      ...overrides.pinMediaEntry
    }]
  });
  writeJson(join(artifactPath, "motion-evidence.json"), overrides.motionEvidence ?? { motionEvidence: [] });
  writeJson(join(artifactPath, "screenshot-index.json"), {
    screenshots: [{
      referenceId: "pin-ref",
      url: "https://www.pinterest.com/pin/123/",
      sourceUrl: "https://www.pinterest.com/pin/123/",
      path: "visual-evidence/pin-ref/viewport.png",
      sha256: screenshotSha,
      bytes: screenshotBytes.length,
      warnings: [],
      ...overrides.screenshotEntry
    }]
  });
  writeJson(join(artifactPath, "media-analysis.json"), {
    version: 1,
    nonGoals: ["media-analysis.json cannot satisfy product readiness."],
    references: [{ referenceId: "pin-ref", mediaPath: "pin-media-evidence/pin-ref/main.jpg" }],
    ...overrides.mediaAnalysis
  });

  return {
    root,
    artifactPath,
    workflow: makeWorkflow(artifactPath, overrides.workflow)
  };
}

function writeMotionEvidence(
  artifactPath: string,
  motionOverrides: Record<string, unknown> = {},
  entryOverrides: Record<string, unknown> = {}
) {
  mkdirSync(join(artifactPath, "motion-evidence", "pin-ref"), { recursive: true });
  writeFileSync(join(artifactPath, "motion-evidence", "pin-ref", "replay.json"), motionReplayBytes);
  writeFileSync(join(artifactPath, "motion-evidence", "pin-ref", "preview.png"), motionPreviewBytes);
  writeJson(join(artifactPath, "motion-evidence.json"), {
    motionEvidence: [{
      referenceId: "pin-ref",
      url: "https://www.pinterest.com/pin/123/",
      ...entryOverrides,
      motion: {
        status: "captured",
        kind: "screencast",
        capturedAt: "2026-06-29T00:00:00.000Z",
        replay: {
          path: "motion-evidence/pin-ref/replay.json",
          sha256: motionReplaySha,
          bytes: motionReplayBytes.length
        },
        preview: {
          path: "motion-evidence/pin-ref/preview.png",
          sha256: motionPreviewSha,
          bytes: motionPreviewBytes.length
        },
        frameCount: 4,
        warnings: [],
        diagnostic: false,
        diagnosticReasons: [],
        authority: "design_evidence",
        ...motionOverrides
      }
    }]
  });
}

describe("inspiredesign strict proof script", () => {
  it("parses explicit strict proof URLs without disabling query defaults", () => {
    expect(__test__.parseArgs([
      "--url",
      "https://example.com/reference-a",
      "--url=https://example.com/reference-b",
      "--timeout-ms",
      "120000"
    ])).toEqual(expect.objectContaining({
      urls: ["https://example.com/reference-a", "https://example.com/reference-b"],
      query: "premium editorial workspace landing page design reference",
      timeoutMs: 120000
    }));
  });

  it("requires a current daemon fingerprint before strict proof", () => {
    expect(assertCurrentDaemonFingerprint({ success: true, data: { fingerprintCurrent: true } })).toEqual(
      { success: true, data: { fingerprintCurrent: true } }
    );
    expect(() => assertCurrentDaemonFingerprint({ success: true, data: { fingerprintCurrent: false, reason: "daemon_fingerprint_mismatch" } }))
      .toThrow("daemon_fingerprint_not_current:daemon_fingerprint_mismatch");
    expect(() => assertCurrentDaemonFingerprint({ success: true, data: {} })).toThrow("daemon_fingerprint_not_current:daemon_fingerprint_missing");
    expect(() => assertCurrentDaemonFingerprint({ success: false })).toThrow("daemon_status_failed");
  });

  it("requires unique config, cache, ports, and tokens", () => {
    const runtime = {
      configDir: "/tmp/odb-strict-config-a",
      cacheDir: "/tmp/odb-strict-cache-a",
      daemonPort: 45501,
      relayPort: 45502,
      daemonToken: "daemon-token-a",
      relayToken: "relay-token-b"
    };

    expect(assertStrictRuntimeIsolation(runtime)).toEqual(expect.objectContaining({
      configUnique: true,
      cacheUnique: true,
      portsUnique: true,
      tokensUnique: true,
      daemonTokenSha256: expect.any(String),
      relayTokenSha256: expect.any(String)
    }));
    expect(inspectStrictRuntime({ ...runtime, relayPort: runtime.daemonPort })).toEqual(expect.objectContaining({
      portsUnique: false
    }));
    expect(() => assertStrictRuntimeIsolation({ ...runtime, relayPort: runtime.daemonPort, relayToken: runtime.daemonToken }))
      .toThrow("strict_runtime_isolation_failed:ports_not_unique,tokens_not_unique");
    expect(() => assertStrictRuntimeIsolation({ ...runtime, cacheDir: runtime.configDir }))
      .toThrow("strict_runtime_isolation_failed:config_cache_not_distinct");
  });

  it("passes only after direct artifact inspection proves product-ready pin media authority", () => {
    const bundle = makeBundle();
    try {
      const inspection = inspectInspiredesignStrictBundle(bundle.artifactPath, bundle.workflow);
      expect(inspection).toEqual(expect.objectContaining({
        status: "pass",
        readiness: {
          ready: true,
          productSuccess: true,
          artifactAuthority: "product_ready",
          evidenceAuthority: "pin_media_ready"
        },
        rankedReferenceCount: 1,
        mediaAnalysisAdvisoryOnly: true,
        pinMediaInspections: [{
          referenceId: "pin-ref",
          url: "https://www.pinterest.com/pin/123/",
          sourceUrl: "https://www.pinterest.com/pin/123/",
          path: "pin-media-evidence/pin-ref/main.jpg",
          bytes: pinBytes.length,
          sha256: pinSha
        }]
      }));
      expect(inspection.artifactSummaries.map((summary) => summary.path)).toEqual(__test__.REQUIRED_ARTIFACT_FILES);
    } finally {
      rmSync(bundle.root, { recursive: true, force: true });
    }
  });

  it("fails diagnostic-only bundles even when required artifacts exist", () => {
    const bundle = makeBundle({
      workflow: {
        ready: false,
        productSuccess: false,
        artifactAuthority: "diagnostic_only",
        evidenceAuthority: "diagnostic_only"
      }
    });
    try {
      expect(() => inspectInspiredesignStrictBundle(bundle.artifactPath, bundle.workflow))
        .toThrow("inspiredesign_diagnostic_only_bundle");
    } finally {
      rmSync(bundle.root, { recursive: true, force: true });
    }
  });

  it("does not let media-analysis replace pin-media authority", () => {
    const bundle = makeBundle({
      pinMediaEntry: { path: "pin-media-evidence/pin-ref/remote.jpg" },
      mediaAnalysis: { authority: "product_ready" }
    });
    try {
      expect(() => inspectInspiredesignStrictBundle(bundle.artifactPath, bundle.workflow))
        .toThrow("pin_media_file_missing:pin-media-evidence/pin-ref/remote.jpg");
    } finally {
      rmSync(bundle.root, { recursive: true, force: true });
    }
  });

  it("rejects media-analysis product-ready claims even when pin-media proof is valid", () => {
    const bundle = makeBundle({
      mediaAnalysis: {
        references: [{ referenceId: "pin-ref", authority: "product_ready" }]
      }
    });
    try {
      expect(() => inspectInspiredesignStrictBundle(bundle.artifactPath, bundle.workflow))
        .toThrow("media_analysis_claims_readiness_key:media-analysis.references[0].authority");
    } finally {
      rmSync(bundle.root, { recursive: true, force: true });
    }
  });

  it("rejects media-analysis readiness keys and strict authority values", () => {
    const readinessKeyBundle = makeBundle({
      mediaAnalysis: { ready: true }
    });
    try {
      expect(() => inspectInspiredesignStrictBundle(readinessKeyBundle.artifactPath, readinessKeyBundle.workflow))
        .toThrow("media_analysis_claims_readiness_key:media-analysis.ready");
    } finally {
      rmSync(readinessKeyBundle.root, { recursive: true, force: true });
    }

    const authorityValueBundle = makeBundle({
      mediaAnalysis: { references: [{ referenceId: "pin-ref", claimLevel: "pin_media_ready" }] }
    });
    try {
      expect(() => inspectInspiredesignStrictBundle(authorityValueBundle.artifactPath, authorityValueBundle.workflow))
        .toThrow("media_analysis_claims_readiness_authority:media-analysis.references[0].claimLevel");
    } finally {
      rmSync(authorityValueBundle.root, { recursive: true, force: true });
    }
  });

  it("rejects missing and diagnostic evidence.json references", () => {
    const emptyEvidenceBundle = makeBundle({ evidence: { references: [] } });
    try {
      expect(() => inspectInspiredesignStrictBundle(emptyEvidenceBundle.artifactPath, emptyEvidenceBundle.workflow))
        .toThrow("evidence_json_references_missing");
    } finally {
      rmSync(emptyEvidenceBundle.root, { recursive: true, force: true });
    }

    const diagnosticEvidenceBundle = makeBundle({
      evidence: { references: [{ url: "https://www.pinterest.com/pin/123/", evidenceAuthority: "diagnostic_only" }] }
    });
    try {
      expect(() => inspectInspiredesignStrictBundle(diagnosticEvidenceBundle.artifactPath, diagnosticEvidenceBundle.workflow))
        .toThrow("evidence_json_reference_diagnostic_only:0");
    } finally {
      rmSync(diagnosticEvidenceBundle.root, { recursive: true, force: true });
    }
  });

  it("rejects evidence.json authority annotations that contradict accepted authority", () => {
    const bundle = makeBundle({
      evidence: { references: [{ url: "https://www.pinterest.com/pin/123/", evidenceAuthority: "snapshot_ready" }] }
    });
    try {
      expect(() => inspectInspiredesignStrictBundle(bundle.artifactPath, bundle.workflow))
        .toThrow("evidence_json_reference_authority_mismatch");
    } finally {
      rmSync(bundle.root, { recursive: true, force: true });
    }
  });

  it("rejects artifact paths that escape the bundle", () => {
    const bundle = makeBundle({
      pinMediaEntry: { path: "../outside.jpg" }
    });
    try {
      expect(() => inspectInspiredesignStrictBundle(bundle.artifactPath, bundle.workflow))
        .toThrow("artifact_path_escapes_bundle:../outside.jpg");
    } finally {
      rmSync(bundle.root, { recursive: true, force: true });
    }
  });

  it("inspects motion-ready replay and preview files before accepting motion authority", () => {
    const bundle = makeBundle({
      workflow: { evidenceAuthority: "motion_ready" },
      evidence: { references: [{ url: "https://example.com/reference" }] },
      rankedReference: { url: "https://example.com/reference" }
    });
    writeMotionEvidence(bundle.artifactPath, {}, { referenceId: "motion-ref", url: "https://example.com/reference" });
    try {
      const inspection = inspectInspiredesignStrictBundle(bundle.artifactPath, bundle.workflow);
      expect(inspection.motionInspections).toEqual([{
        index: 0,
        referenceId: "motion-ref",
        url: "https://example.com/reference",
        sourceUrl: null,
        replay: {
          path: "motion-evidence/pin-ref/replay.json",
          bytes: motionReplayBytes.length,
          sha256: motionReplaySha
        },
        preview: {
          path: "motion-evidence/pin-ref/preview.png",
          bytes: motionPreviewBytes.length,
          sha256: motionPreviewSha
        }
      }]);
    } finally {
      rmSync(bundle.root, { recursive: true, force: true });
    }
  });

  it("rejects motion evidence with diagnostic reasons for motion authority", () => {
    const bundle = makeBundle({
      workflow: { evidenceAuthority: "motion_ready" },
      evidence: { references: [{ url: "https://example.com/reference" }] },
      rankedReference: { url: "https://example.com/reference" }
    });
    writeMotionEvidence(bundle.artifactPath, { diagnosticReasons: ["controls_only"] }, { referenceId: "motion-ref", url: "https://example.com/reference" });
    try {
      expect(() => inspectInspiredesignStrictBundle(bundle.artifactPath, bundle.workflow))
        .toThrow("motion_evidence_entry_diagnostic_reasons:0");
    } finally {
      rmSync(bundle.root, { recursive: true, force: true });
    }
  });

  it("rejects diagnostic motion evidence for motion authority", () => {
    const bundle = makeBundle({
      workflow: { evidenceAuthority: "motion_ready" },
      evidence: { references: [{ url: "https://example.com/reference" }] },
      rankedReference: { url: "https://example.com/reference" }
    });
    writeMotionEvidence(bundle.artifactPath, { diagnostic: true }, { referenceId: "motion-ref", url: "https://example.com/reference" });
    try {
      expect(() => inspectInspiredesignStrictBundle(bundle.artifactPath, bundle.workflow))
        .toThrow("motion_evidence_entry_diagnostic:0");
    } finally {
      rmSync(bundle.root, { recursive: true, force: true });
    }
  });

  it("inspects snapshot-ready screenshot files before accepting snapshot authority", () => {
    const bundle = makeBundle({
      workflow: { evidenceAuthority: "snapshot_ready" },
      evidence: { references: [{ url: "https://example.com/reference" }] },
      rankedReference: { url: "https://example.com/reference" },
      screenshotEntry: { referenceId: "screenshot-ref", url: "https://example.com/reference", sourceUrl: "https://example.com/reference" }
    });
    try {
      const inspection = inspectInspiredesignStrictBundle(bundle.artifactPath, bundle.workflow);
      expect(inspection.screenshotInspections).toEqual([{
        referenceId: "screenshot-ref",
        url: "https://example.com/reference",
        sourceUrl: "https://example.com/reference",
        path: "visual-evidence/pin-ref/viewport.png",
        bytes: screenshotBytes.length,
        sha256: screenshotSha
      }]);
    } finally {
      rmSync(bundle.root, { recursive: true, force: true });
    }
  });

  it("fails snapshot-ready bundles when screenshot hashes do not match", () => {
    const bundle = makeBundle({
      workflow: { evidenceAuthority: "snapshot_ready" },
      evidence: { references: [{ url: "https://example.com/reference" }] },
      rankedReference: { url: "https://example.com/reference" }
    });
    try {
      writeJson(join(bundle.artifactPath, "screenshot-index.json"), {
        screenshots: [{
          referenceId: "screenshot-ref",
          url: "https://example.com/reference",
          sourceUrl: "https://example.com/reference",
          path: "visual-evidence/pin-ref/viewport.png",
          sha256: "a".repeat(64),
          bytes: screenshotBytes.length
        }]
      });
      expect(() => inspectInspiredesignStrictBundle(bundle.artifactPath, bundle.workflow))
        .toThrow("screenshot_file_hash_mismatch:visual-evidence/pin-ref/viewport.png");
    } finally {
      rmSync(bundle.root, { recursive: true, force: true });
    }
  });

  it("requires required JSON files to be listed in the bundle manifest", () => {
    const bundle = makeBundle({
      manifestFiles: __test__.REQUIRED_ARTIFACT_FILES.filter((file) => file !== "media-analysis.json")
    });
    try {
      expect(() => inspectInspiredesignStrictBundle(bundle.artifactPath, bundle.workflow))
        .toThrow("bundle_manifest_missing_required_files:media-analysis.json");
    } finally {
      rmSync(bundle.root, { recursive: true, force: true });
    }
  });

  it("requires pin-media authority for canonical Pinterest pin references", () => {
    const bundle = makeBundle({
      workflow: { evidenceAuthority: "snapshot_ready" }
    });
    try {
      expect(() => inspectInspiredesignStrictBundle(bundle.artifactPath, bundle.workflow))
        .toThrow("canonical_pinterest_pin_requires_pin_media_ready");
    } finally {
      rmSync(bundle.root, { recursive: true, force: true });
    }
  });

  it("rejects pin-media authority that is not bound to the top ranked reference", () => {
    const bundle = makeBundle({
      pinMediaEntry: {
        referenceId: "other-ref",
        url: "https://example.com/other",
        sourceUrl: "https://example.com/other"
      }
    });
    try {
      expect(() => inspectInspiredesignStrictBundle(bundle.artifactPath, bundle.workflow))
        .toThrow("pin_media_authority_not_bound_to_ranked_reference:0");
    } finally {
      rmSync(bundle.root, { recursive: true, force: true });
    }
  });

  it("accepts pin-media authority bound by normalized URL", () => {
    const bundle = makeBundle({
      rankedReference: {
        id: "ranked-ref",
        url: "https://www.pinterest.com/pin/123/?utm_source=test"
      },
      pinMediaEntry: {
        referenceId: "media-ref",
        url: "https://www.pinterest.com/pin/123/"
      }
    });
    try {
      expect(inspectInspiredesignStrictBundle(bundle.artifactPath, bundle.workflow).status).toBe("pass");
    } finally {
      rmSync(bundle.root, { recursive: true, force: true });
    }
  });

  it("rejects canonical Pinterest pin-media authority with same id but off-platform proof", () => {
    const bundle = makeBundle({
      pinMediaEntry: {
        referenceId: "pin-ref",
        url: "https://evil.example/pin/123/",
        sourceUrl: "https://evil.example/source/123/",
        mediaUrl: "https://evil.example/media.jpg",
        firstPartyProvenance: {
          referenceUrlCanonical: false,
          sourceUrlMatchesReference: false,
          mediaUrlFirstParty: false
        }
      }
    });
    try {
      expect(() => inspectInspiredesignStrictBundle(bundle.artifactPath, bundle.workflow))
        .toThrow("canonical_pinterest_pin_media_entry_not_first_party:0");
    } finally {
      rmSync(bundle.root, { recursive: true, force: true });
    }
  });

  it("rejects canonical Pinterest pin-media authority bound only to a non-Pinterest ranked reference", () => {
    const bundle = makeBundle({
      rankedReference: { referenceId: "pin-ref", url: "https://www.pinterest.com/pin/123/" },
      pinMediaEntry: {
        referenceId: "other-ref",
        url: "https://example.com/other",
        sourceUrl: "https://example.com/other"
      }
    });
    writeJson(join(bundle.artifactPath, "ranked-references.json"), {
      references: [
        { referenceId: "pin-ref", url: "https://www.pinterest.com/pin/123/", score: 98 },
        { referenceId: "other-ref", url: "https://example.com/other", score: 91 }
      ]
    });
    try {
      expect(() => inspectInspiredesignStrictBundle(bundle.artifactPath, bundle.workflow))
        .toThrow("canonical_pinterest_pin_media_not_bound_to_pinterest_reference");
    } finally {
      rmSync(bundle.root, { recursive: true, force: true });
    }
  });

  it("rejects evidence-only canonical Pinterest refs backed by non-Pinterest ranked media", () => {
    const bundle = makeBundle({
      evidence: { references: [{ url: "https://www.pinterest.com/pin/123/" }] },
      rankedReference: {
        id: "ranked-ref",
        url: "https://example.com/reference"
      },
      pinMediaEntry: {
        referenceId: "ranked-ref",
        url: "https://example.com/reference",
        sourceUrl: "https://example.com/reference",
        mediaUrl: "https://example.com/media.jpg",
        firstPartyProvenance: {
          referenceUrlCanonical: false,
          sourceUrlMatchesReference: false,
          mediaUrlFirstParty: false
        }
      }
    });
    try {
      expect(() => inspectInspiredesignStrictBundle(bundle.artifactPath, bundle.workflow))
        .toThrow("canonical_pinterest_pin_media_not_bound_to_pinterest_reference");
    } finally {
      rmSync(bundle.root, { recursive: true, force: true });
    }
  });

  it("accepts authority artifacts bound to non-top ranked references by normalized URL", () => {
    const bundle = makeBundle({
      rankedReference: {
        referenceId: "top-ref",
        url: "https://example.com/top"
      },
      pinMediaEntry: {
        referenceId: "media-ref",
        url: "https://www.pinterest.com/pin/123/"
      }
    });
    writeJson(join(bundle.artifactPath, "ranked-references.json"), {
      references: [
        { referenceId: "top-ref", url: "https://example.com/top", score: 98 },
        { referenceId: "ranked-ref", url: "https://www.pinterest.com/pin/123/?utm_source=test", score: 91 }
      ]
    });
    try {
      expect(inspectInspiredesignStrictBundle(bundle.artifactPath, bundle.workflow).status).toBe("pass");
    } finally {
      rmSync(bundle.root, { recursive: true, force: true });
    }
  });

  it("rejects motion authority that is not bound to a ranked reference", () => {
    const bundle = makeBundle({
      workflow: { evidenceAuthority: "motion_ready" },
      evidence: { references: [{ url: "https://example.com/reference" }] },
      rankedReference: { url: "https://example.com/reference" }
    });
    writeMotionEvidence(bundle.artifactPath, {}, { referenceId: "other-ref", url: "https://example.com/other" });
    try {
      expect(() => inspectInspiredesignStrictBundle(bundle.artifactPath, bundle.workflow))
        .toThrow("motion_authority_not_bound_to_ranked_reference:0");
    } finally {
      rmSync(bundle.root, { recursive: true, force: true });
    }
  });

  it("rejects declared artifact byte counts that differ from file sizes", () => {
    const pinBundle = makeBundle({
      pinMediaEntry: { bytes: pinBytes.length + 1 }
    });
    try {
      expect(() => inspectInspiredesignStrictBundle(pinBundle.artifactPath, pinBundle.workflow))
        .toThrow("pin_media_file_size_mismatch:pin-media-evidence/pin-ref/main.jpg");
    } finally {
      rmSync(pinBundle.root, { recursive: true, force: true });
    }

    const motionBundle = makeBundle({
      workflow: { evidenceAuthority: "motion_ready" },
      evidence: { references: [{ url: "https://example.com/reference" }] },
      rankedReference: { url: "https://example.com/reference" }
    });
    writeMotionEvidence(
      motionBundle.artifactPath,
      { replay: { path: "motion-evidence/pin-ref/replay.json", sha256: motionReplaySha, bytes: motionReplayBytes.length + 1 } },
      { referenceId: "motion-ref", url: "https://example.com/reference" }
    );
    try {
      expect(() => inspectInspiredesignStrictBundle(motionBundle.artifactPath, motionBundle.workflow))
        .toThrow("motion_replay_file_size_mismatch:motion-evidence/pin-ref/replay.json");
    } finally {
      rmSync(motionBundle.root, { recursive: true, force: true });
    }

    const screenshotBundle = makeBundle({
      workflow: { evidenceAuthority: "snapshot_ready" },
      evidence: { references: [{ url: "https://example.com/reference" }] },
      rankedReference: { url: "https://example.com/reference" },
      screenshotEntry: {
        referenceId: "screenshot-ref",
        url: "https://example.com/reference",
        sourceUrl: "https://example.com/reference",
        bytes: screenshotBytes.length + 1
      }
    });
    try {
      expect(() => inspectInspiredesignStrictBundle(screenshotBundle.artifactPath, screenshotBundle.workflow))
        .toThrow("screenshot_file_size_mismatch:visual-evidence/pin-ref/viewport.png");
    } finally {
      rmSync(screenshotBundle.root, { recursive: true, force: true });
    }
  });

  it("rejects diagnostic screenshot entries for snapshot authority", () => {
    const bundle = makeBundle({
      workflow: { evidenceAuthority: "snapshot_ready" },
      evidence: { references: [{ url: "https://example.com/reference" }] },
      rankedReference: { url: "https://example.com/reference" },
      screenshotEntry: {
        referenceId: "screenshot-ref",
        url: "https://example.com/reference",
        sourceUrl: "https://example.com/reference",
        diagnostic: true,
        diagnosticReasons: ["chrome_only"],
        authority: "diagnostic_only",
        evidenceAuthority: "diagnostic_only"
      }
    });
    try {
      expect(() => inspectInspiredesignStrictBundle(bundle.artifactPath, bundle.workflow))
        .toThrow("screenshot_index_entry_diagnostic:0");
    } finally {
      rmSync(bundle.root, { recursive: true, force: true });
    }
  });

  it("rejects snapshot authority that is not bound to a ranked reference", () => {
    const bundle = makeBundle({
      workflow: { evidenceAuthority: "snapshot_ready" },
      evidence: { references: [{ url: "https://example.com/reference" }] },
      rankedReference: { url: "https://example.com/reference" },
      screenshotEntry: {
        referenceId: "other-ref",
        url: "https://example.com/other",
        sourceUrl: "https://example.com/other"
      }
    });
    try {
      expect(() => inspectInspiredesignStrictBundle(bundle.artifactPath, bundle.workflow))
        .toThrow("snapshot_authority_not_bound_to_ranked_reference:0");
    } finally {
      rmSync(bundle.root, { recursive: true, force: true });
    }
  });
});
