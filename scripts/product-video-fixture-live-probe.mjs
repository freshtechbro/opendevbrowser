#!/usr/bin/env node
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  defaultArtifactPath,
  finalizeReport,
  pushStep,
  runCliAsync,
  writeJson
} from "./live-direct-utils.mjs";
import {
  closeHttpFixtureServer,
  startHttpFixtureServer,
  withTempHarness
} from "./skill-runtime-probe-utils.mjs";

const HELP_TEXT = [
  "Usage: node scripts/product-video-fixture-live-probe.mjs [options]",
  "",
  "Options:",
  "  --out <path>   Output JSON path",
  "  --quiet        Suppress per-step progress logging",
  "  --help         Show help"
].join("\n");

const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX1QAAAAASUVORK5CYII=",
  "base64"
);

function parseArgs(argv) {
  const options = {
    out: defaultArtifactPath("odb-product-video-fixture-live-probe"),
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

function createProductFixtureServer() {
  return http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname.startsWith("/assets/")) {
      response.writeHead(200, {
        "content-type": "image/png",
        "content-length": PNG_BYTES.length
      });
      response.end(PNG_BYTES);
      return;
    }

    if (url.pathname !== "/product/widget-pro") {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("not found");
      return;
    }

    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Widget Pro | Acme Labs</title>
    <meta name="description" content="Widget Pro is a compact desk accessory that combines cable routing, wireless charging, and quick-access storage.">
    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "Product",
        "name": "Widget Pro",
        "brand": {
          "@type": "Brand",
          "name": "Acme Labs"
        },
        "image": [
          "http://127.0.0.1:${url.port}/assets/widget-01.png",
          "http://127.0.0.1:${url.port}/assets/widget-02.png"
        ],
        "description": "Widget Pro keeps your desk clear with integrated charging and storage.",
        "offers": {
          "@type": "Offer",
          "priceCurrency": "USD",
          "price": "79.99",
          "availability": "https://schema.org/InStock"
        }
      }
    </script>
    <style>
      body { font-family: sans-serif; margin: 0; background: #eef2f7; color: #14213d; }
      main { max-width: 920px; margin: 0 auto; padding: 40px 24px 80px; display: grid; gap: 20px; }
      .hero { background: #fff; border-radius: 24px; padding: 28px; box-shadow: 0 14px 32px rgba(15, 23, 42, 0.08); }
      .hero img { width: 220px; height: 220px; border-radius: 20px; object-fit: cover; }
      .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; }
      ul { padding-left: 20px; }
      .price { font-size: 32px; font-weight: 700; }
      .brand { color: #52606d; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; }
    </style>
  </head>
  <body>
    <main>
      <section class="hero">
        <p class="brand">Acme Labs</p>
        <h1>Widget Pro</h1>
        <p class="price">$79.99</p>
        <p>Widget Pro is the all-in-one desktop organizer for creators who want fewer cables, cleaner lines, and instant charging access.</p>
        <img src="http://127.0.0.1:${url.port}/assets/widget-01.png" alt="Widget Pro front view">
      </section>
      <section class="grid">
        <article>
          <h2>Features</h2>
          <ul>
            <li>Integrated wireless charging pad for phones and earbuds</li>
            <li>Hidden tray for pens, adapters, and SD cards</li>
            <li>Magnetic cable channel keeps desks uncluttered</li>
          </ul>
        </article>
        <article>
          <h2>Why it works</h2>
          <p>Designed for hybrid desks, Widget Pro reduces clutter without taking over the workspace.</p>
          <img src="http://127.0.0.1:${url.port}/assets/widget-02.png" alt="Widget Pro lifestyle scene">
        </article>
      </section>
    </main>
  </body>
</html>`);
  });
}

function getReviewBundleRoot() {
  return path.join(process.cwd(), "artifacts", "skill-runtime-audit", "review-bundles", "product-video-fixture");
}

export function validateProductVideoArtifactBundle(artifactPath) {
  if (typeof artifactPath !== "string" || artifactPath.trim() === "") {
    return { artifactPath: null, detail: "missing_product_video_artifact_path" };
  }
  if (!fs.existsSync(artifactPath) || !fs.statSync(artifactPath).isDirectory()) {
    return { artifactPath, detail: "product_video_artifact_path_missing_on_disk" };
  }
  if (path.basename(path.dirname(artifactPath)) !== "product-video") {
    return { artifactPath, detail: "product_video_artifact_namespace_mismatch" };
  }
  const manifestPath = path.join(artifactPath, "bundle-manifest.json");
  if (!fs.existsSync(manifestPath) || !fs.statSync(manifestPath).isFile()) {
    return { artifactPath, detail: "product_video_bundle_manifest_missing" };
  }
  return { artifactPath, detail: null };
}

function persistArtifactBundle(sourcePath, runId, bundleName) {
  const targetPath = path.join(getReviewBundleRoot(), runId, bundleName);
  fs.rmSync(targetPath, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.cpSync(sourcePath, targetPath, { recursive: true });
  return targetPath;
}

async function runProbe(options) {
  const runId = path.basename(options.out, path.extname(options.out));
  const report = {
    startedAt: new Date().toISOString(),
    out: options.out,
    reviewBundleDir: path.join(getReviewBundleRoot(), runId),
    steps: []
  };

  await withTempHarness("odb-product-video-fixture", async ({ env, tempRoot }) => {
    const { server, baseUrl } = await startHttpFixtureServer(createProductFixtureServer);
    try {
      const productUrl = `${baseUrl}/product/widget-pro`;
      const outputDir = path.join(tempRoot, "product-video-output");

      pushStep(report, {
        id: "fixture.server",
        status: "pass",
        detail: null,
        data: { productUrl }
      }, { prefix: "[product-video-fixture]", logProgress: !options.quiet });

      const daemonStatus = await runCliAsync(["status", "--daemon"], {
        env,
        allowFailure: true,
        timeoutMs: 10_000
      });
      pushStep(report, {
        id: "infra.daemon_status",
        status: daemonStatus.status === 0 ? "pass" : "fail",
        detail: daemonStatus.status === 0 ? null : daemonStatus.detail
      }, { prefix: "[product-video-fixture]", logProgress: !options.quiet });
      if (daemonStatus.status !== 0) {
        return;
      }

      const metadataOnlyWorkflow = await runCliAsync([
        "product-video",
        "run",
        "--product-url",
        productUrl,
        "--output-dir",
        outputDir,
        "--include-screenshots=false",
        "--timeout-ms",
        "180000"
      ], {
        env,
        allowFailure: true,
        timeoutMs: 360_000
      });

      const metadataOnlyData = metadataOnlyWorkflow.json?.data ?? {};
      const metadataOnlyArtifactPath = typeof metadataOnlyData.artifact_path === "string" ? metadataOnlyData.artifact_path : null;
      const metadataOnlyArtifactValidation = validateProductVideoArtifactBundle(metadataOnlyArtifactPath);
      const persistedMetadataOnlyArtifactPath = metadataOnlyArtifactValidation.detail === null
        ? persistArtifactBundle(metadataOnlyArtifactPath, runId, "metadata-only")
        : null;
      const metadataOnlyOk = metadataOnlyWorkflow.status === 0
        && metadataOnlyArtifactValidation.detail === null
        && persistedMetadataOnlyArtifactPath
        && Array.isArray(metadataOnlyData.screenshots)
        && metadataOnlyData.screenshots.length === 0
        && typeof metadataOnlyData.manifest?.product?.title === "string"
        && metadataOnlyData.manifest.product.title.includes("Widget Pro")
        && typeof metadataOnlyData.manifest?.product?.brand === "string"
        && metadataOnlyData.manifest.product.brand.includes("Acme Labs");

      pushStep(report, {
        id: "workflow.product_video_run_no_screenshots",
        status: metadataOnlyOk ? "pass" : "fail",
        detail: metadataOnlyOk ? null : metadataOnlyArtifactValidation.detail ?? metadataOnlyWorkflow.detail,
        data: {
          artifactPath: persistedMetadataOnlyArtifactPath,
          sourceArtifactPath: metadataOnlyArtifactPath,
          images: Array.isArray(metadataOnlyData.images) ? metadataOnlyData.images.length : 0,
          screenshots: Array.isArray(metadataOnlyData.screenshots) ? metadataOnlyData.screenshots.length : 0,
          title: metadataOnlyData.manifest?.product?.title ?? null,
          brand: metadataOnlyData.manifest?.product?.brand ?? null
        }
      }, { prefix: "[product-video-fixture]", logProgress: !options.quiet });
      if (!metadataOnlyOk) {
        return;
      }

      const screenshotOutputDir = path.join(tempRoot, "product-video-output-with-screenshots");
      const workflow = await runCliAsync([
        "product-video",
        "run",
        "--product-url",
        productUrl,
        "--output-dir",
        screenshotOutputDir,
        "--timeout-ms",
        "180000"
      ], {
        env,
        allowFailure: true,
        timeoutMs: 360_000
      });

      const data = workflow.json?.data ?? {};
      const artifactPath = typeof data.artifact_path === "string" ? data.artifact_path : null;
      const artifactValidation = validateProductVideoArtifactBundle(artifactPath);
      const persistedArtifactPath = artifactValidation.detail === null
        ? persistArtifactBundle(artifactPath, runId, "with-screenshots")
        : null;
      const manifestPath = persistedArtifactPath ? path.join(persistedArtifactPath, "manifest.json") : null;
      const copyPath = persistedArtifactPath ? path.join(persistedArtifactPath, "copy.md") : null;
      const featuresPath = persistedArtifactPath ? path.join(persistedArtifactPath, "features.md") : null;
      const workflowOk = workflow.status === 0
        && artifactValidation.detail === null
        && persistedArtifactPath
        && manifestPath
        && copyPath
        && featuresPath
        && fs.existsSync(manifestPath)
        && fs.existsSync(copyPath)
        && fs.existsSync(featuresPath)
        && Array.isArray(data.screenshots)
        && data.screenshots.length > 0
        && typeof data.manifest?.product?.title === "string"
        && data.manifest.product.title.includes("Widget Pro")
        && typeof data.manifest?.product?.brand === "string"
        && data.manifest.product.brand.includes("Acme Labs");

      pushStep(report, {
        id: "workflow.product_video_run",
        status: workflowOk ? "pass" : "fail",
        detail: workflowOk ? null : artifactValidation.detail ?? workflow.detail,
        data: {
          artifactPath: persistedArtifactPath,
          sourceArtifactPath: artifactPath,
          images: Array.isArray(data.images) ? data.images.length : 0,
          screenshots: Array.isArray(data.screenshots) ? data.screenshots.length : 0,
          title: data.manifest?.product?.title ?? null,
          brand: data.manifest?.product?.brand ?? null
        }
      }, { prefix: "[product-video-fixture]", logProgress: !options.quiet });
    } finally {
      await closeHttpFixtureServer(server);
    }
  });

  finalizeReport(report);
  writeJson(options.out, report);
  return report;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = await runProbe(options);
  console.log(JSON.stringify({
    ok: report.ok,
    counts: report.counts,
    summary: {
      status: report.ok ? "pass" : "fail",
      artifactPath: options.out
    }
  }, null, 2));
  if (!report.ok) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
