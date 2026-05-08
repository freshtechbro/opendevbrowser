import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  productVideoWorkflowFailureDetail,
  validateProductVideoArtifactBundle
} from "../scripts/product-video-fixture-live-probe.mjs";

describe("product-video fixture live probe artifact validation", () => {
  it("requires product-video namespace and a real bundle manifest file", () => {
    const root = mkdtempSync(join(tmpdir(), "odb-product-video-fixture-"));
    try {
      const validRun = join(root, "product-video", "run-1");
      const wrongNamespaceRun = join(root, "product-assets", "run-1");
      const directoryManifestRun = join(root, "product-video", "run-2");
      mkdirSync(validRun, { recursive: true });
      mkdirSync(wrongNamespaceRun, { recursive: true });
      mkdirSync(directoryManifestRun, { recursive: true });
      writeFileSync(join(validRun, "bundle-manifest.json"), "{}\n");
      writeFileSync(join(wrongNamespaceRun, "bundle-manifest.json"), "{}\n");
      mkdirSync(join(directoryManifestRun, "bundle-manifest.json"));

      expect(validateProductVideoArtifactBundle(validRun)).toEqual({
        artifactPath: validRun,
        detail: null
      });
      expect(validateProductVideoArtifactBundle(wrongNamespaceRun)).toEqual({
        artifactPath: wrongNamespaceRun,
        detail: "product_video_artifact_namespace_mismatch"
      });
      expect(validateProductVideoArtifactBundle(directoryManifestRun)).toEqual({
        artifactPath: directoryManifestRun,
        detail: "product_video_bundle_manifest_missing"
      });
      expect(validateProductVideoArtifactBundle("")).toEqual({
        artifactPath: null,
        detail: "missing_product_video_artifact_path"
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
});
