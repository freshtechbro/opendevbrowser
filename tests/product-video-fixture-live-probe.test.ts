import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createProductFixtureServer,
  productVideoWorkflowFailureDetail,
  validateProductVideoArtifactBundle,
  validateProductVideoReadinessBundle,
  validateProductVideoWorkflowReadinessArtifact
} from "../scripts/product-video-fixture-live-probe.mjs";

const passReadiness = {
  status: "pass",
  warnings: [],
  reasonCodes: ["positive_spec_promoted"],
  criteria: []
};

const bundleManifestFiles = [
  "images/widget-01.png",
  "manifest.json",
  "product.json",
  "presentation-readiness.json",
  "bundle-manifest.json"
];

type BundleOptions = {
  files?: string[];
  manifestRunId?: string;
  runId?: string;
  status?: string;
};

const writeReadinessBundle = (root: string, options: BundleOptions = {}) => {
  const runId = options.runId ?? "run-1";
  const status = options.status ?? "pass";
  const run = join(root, "product-video", runId);
  mkdirSync(run, { recursive: true });
  writeFileSync(join(run, "bundle-manifest.json"), `${JSON.stringify({
    run_id: options.manifestRunId ?? runId,
    files: options.files ?? bundleManifestFiles
  })}\n`);
  const readiness = { ...passReadiness, status };
  writeFileSync(join(run, "manifest.json"), `${JSON.stringify({
    readiness: {
      presentation: readiness,
      productVideo: readiness
    }
  })}\n`);
  writeFileSync(join(run, "presentation-readiness.json"), `${JSON.stringify({
    summary: { status },
    presentationReadiness: readiness,
    productVideoReadiness: readiness
  })}\n`);
  writeFileSync(join(run, "product.json"), `${JSON.stringify({
    presentationReadiness: readiness,
    productVideoReadiness: readiness
  })}\n`);
  return run;
};

const listenOnLocalhost = async (server: ReturnType<typeof createProductFixtureServer>): Promise<string> => {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("error", onError);
      reject(error);
    };
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError);
      resolve();
    });
  });

  const address = server.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("Fixture server did not return a TCP address.");
  }
  return `http://127.0.0.1:${address.port}`;
};

const closeServer = async (server: ReturnType<typeof createProductFixtureServer>): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
};

describe("product-video fixture live probe artifact validation", () => {
  it("serves fixture image URLs on the actual local server port", async () => {
    const server = createProductFixtureServer();
    const baseUrl = await listenOnLocalhost(server);
    try {
      const productResponse = await fetch(`${baseUrl}/product/widget-pro`);
      expect(productResponse.ok).toBe(true);
      const html = await productResponse.text();

      expect(html).toContain(`${baseUrl}/assets/widget-01.png`);
      expect(html).not.toContain("127.0.0.1:/assets/");

      const imageResponse = await fetch(`${baseUrl}/assets/widget-01.png`);
      expect(imageResponse.ok).toBe(true);
      expect(imageResponse.headers.get("content-type")).toBe("image/png");
      expect((await imageResponse.arrayBuffer()).byteLength).toBeGreaterThan(0);
    } finally {
      await closeServer(server);
    }
  });

  it("requires product-video namespace and a real bundle manifest file", () => {
    const root = mkdtempSync(join(tmpdir(), "odb-product-video-fixture-"));
    try {
      const validRun = writeReadinessBundle(root);
      const wrongNamespaceRun = join(root, "product-assets", "run-1");
      const directoryManifestRun = join(root, "product-video", "run-2");
      mkdirSync(wrongNamespaceRun, { recursive: true });
      mkdirSync(directoryManifestRun, { recursive: true });
      writeFileSync(join(wrongNamespaceRun, "bundle-manifest.json"), `${JSON.stringify({
        run_id: "run-1",
        files: bundleManifestFiles
      })}\n`);
      mkdirSync(join(directoryManifestRun, "bundle-manifest.json"));

      expect(validateProductVideoArtifactBundle(validRun, root)).toEqual({
        artifactPath: validRun,
        detail: null
      });
      expect(validateProductVideoArtifactBundle(wrongNamespaceRun, root)).toEqual({
        artifactPath: wrongNamespaceRun,
        detail: "product_video_artifact_namespace_mismatch"
      });
      expect(validateProductVideoArtifactBundle(directoryManifestRun, root)).toEqual({
        artifactPath: directoryManifestRun,
        detail: "product_video_bundle_manifest_missing"
      });
      expect(validateProductVideoArtifactBundle("", root)).toEqual({
        artifactPath: null,
        detail: "missing_product_video_artifact_path"
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects artifacts outside the expected output root", () => {
    const root = mkdtempSync(join(tmpdir(), "odb-product-video-outside-root-"));
    try {
      const expectedRoot = join(root, "expected-output");
      mkdirSync(expectedRoot, { recursive: true });
      const run = writeReadinessBundle(join(root, "actual-output"));

      expect(validateProductVideoArtifactBundle(run, expectedRoot)).toEqual({
        artifactPath: run,
        detail: "product_video_artifact_path_outside_expected_output_root"
      });
      expect(validateProductVideoWorkflowReadinessArtifact(0, run, expectedRoot)).toEqual({
        artifactPath: run,
        detail: "product_video_artifact_path_outside_expected_output_root",
        statuses: []
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects bundle manifests with a run_id mismatch", () => {
    const root = mkdtempSync(join(tmpdir(), "odb-product-video-run-id-"));
    try {
      const run = writeReadinessBundle(root, { manifestRunId: "other-run" });

      expect(validateProductVideoArtifactBundle(run, root)).toEqual({
        artifactPath: run,
        detail: "product_video_bundle_manifest_run_id_mismatch"
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects bundle manifests missing required sidecars", () => {
    const root = mkdtempSync(join(tmpdir(), "odb-product-video-sidecars-"));
    try {
      const run = writeReadinessBundle(root, {
        files: ["images/widget-01.png", "manifest.json", "product.json", "bundle-manifest.json"]
      });

      expect(validateProductVideoArtifactBundle(run, root)).toEqual({
        artifactPath: run,
        detail: "product_video_bundle_manifest_missing_required_file:presentation-readiness.json"
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports workflow command failures before artifact validation failures", () => {
    expect(productVideoWorkflowFailureDetail({
      status: 1,
      detail: "workflow_timeout"
    }, "missing_product_video_artifact_path")).toBe("workflow_timeout");
    expect(productVideoWorkflowFailureDetail({
      status: 0,
      detail: null
    }, "missing_product_video_artifact_path")).toBe("missing_product_video_artifact_path");
  });

  it("requires pass readiness across manifest, readiness sidecar, and product sidecar", () => {
    const root = mkdtempSync(join(tmpdir(), "odb-product-video-readiness-"));
    try {
      const run = writeReadinessBundle(root);

      expect(validateProductVideoReadinessBundle(run, root)).toMatchObject({
        artifactPath: run,
        detail: null,
        statuses: expect.arrayContaining([
          { label: "manifest.readiness.presentation.status", status: "pass" },
          { label: "presentation-readiness.json.summary.status", status: "pass" },
          { label: "product.json.productVideoReadiness.status", status: "pass" }
        ])
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails readiness validation when any production gate is partial", () => {
    const root = mkdtempSync(join(tmpdir(), "odb-product-video-readiness-partial-"));
    try {
      const run = writeReadinessBundle(root, { status: "partial" });

      expect(validateProductVideoReadinessBundle(run, root)).toEqual({
        artifactPath: run,
        detail: "product_video_readiness_not_pass:manifest.readiness.presentation.status=partial",
        statuses: [
          { label: "manifest.readiness.presentation.status", status: "partial" }
        ]
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails workflow artifact validation on partial sidecars before wrapper success can pass", () => {
    const root = mkdtempSync(join(tmpdir(), "odb-product-video-workflow-readiness-"));
    try {
      const run = writeReadinessBundle(root, { status: "partial" });

      expect(validateProductVideoWorkflowReadinessArtifact(0, run, root)).toEqual({
        artifactPath: run,
        detail: "product_video_readiness_not_pass:manifest.readiness.presentation.status=partial",
        statuses: [
          { label: "manifest.readiness.presentation.status", status: "partial" }
        ]
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
