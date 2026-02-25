#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const CWS_UPLOAD_URL = "https://www.googleapis.com/upload/chromewebstore/v1.1/items";
const CWS_ITEM_URL = "https://www.googleapis.com/chromewebstore/v1.1/items";

function parseArgs(argv) {
  const options = {
    zipPath: "opendevbrowser-extension.zip",
    publish: false,
    publishTarget: "default"
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--zip") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--zip requires a value");
      }
      options.zipPath = value;
      index += 1;
      continue;
    }

    if (arg === "--publish") {
      options.publish = true;
      continue;
    }

    if (arg === "--publish-target") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--publish-target requires a value");
      }
      options.publishTarget = value;
      index += 1;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!["default", "trustedTesters"].includes(options.publishTarget)) {
    throw new Error("--publish-target must be one of: default, trustedTesters");
  }

  return options;
}

function printUsage() {
  console.log(`Usage: node scripts/chrome-store-publish.mjs [options]\n\nOptions:\n  --zip <path>                Path to extension zip (default: opendevbrowser-extension.zip)\n  --publish                   Publish after upload (default: upload only)\n  --publish-target <target>   Publish target: default | trustedTesters (default: default)\n  --help                      Show this help\n\nRequired env vars:\n  CWS_CLIENT_ID\n  CWS_CLIENT_SECRET\n  CWS_REFRESH_TOKEN\n  CWS_EXTENSION_ID`);
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

async function fetchJson(url, init) {
  const response = await fetch(url, init);
  const text = await response.text();

  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }

  if (!response.ok) {
    const details = JSON.stringify(payload);
    throw new Error(`HTTP ${response.status} for ${url}: ${details}`);
  }

  return payload;
}

function summarizeUploadResult(payload) {
  const itemError = Array.isArray(payload?.itemError) ? payload.itemError : [];
  const errors = itemError.map((entry) => ({
    error_code: entry?.error_code ?? "unknown",
    error_detail: entry?.error_detail ?? "unknown"
  }));

  return {
    uploadState: payload?.uploadState ?? "unknown",
    itemErrorCount: errors.length,
    itemErrors: errors
  };
}

async function getAccessToken({ clientId, clientSecret, refreshToken }) {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token"
  });

  const payload = await fetchJson(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  const accessToken = String(payload.access_token ?? "");
  if (!accessToken) {
    throw new Error("OAuth token response did not include access_token");
  }

  return accessToken;
}

async function uploadZip({ extensionId, accessToken, zipPath }) {
  const zipBuffer = await readFile(zipPath);

  const payload = await fetchJson(`${CWS_UPLOAD_URL}/${encodeURIComponent(extensionId)}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "x-goog-api-version": "2",
      "Content-Type": "application/zip"
    },
    body: zipBuffer
  });

  return summarizeUploadResult(payload);
}

async function publishItem({ extensionId, accessToken, publishTarget }) {
  const payload = await fetchJson(
    `${CWS_ITEM_URL}/${encodeURIComponent(extensionId)}/publish?publishTarget=${encodeURIComponent(publishTarget)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "x-goog-api-version": "2"
      }
    }
  );

  return {
    status: Array.isArray(payload?.status) ? payload.status : []
  };
}

async function getItemStatus({ extensionId, accessToken }) {
  const payload = await fetchJson(`${CWS_ITEM_URL}/${encodeURIComponent(extensionId)}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "x-goog-api-version": "2"
    }
  });

  return {
    kind: payload?.kind ?? "unknown",
    item_id: payload?.id ?? extensionId,
    published: payload?.published ?? "unknown"
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  const extensionId = requiredEnv("CWS_EXTENSION_ID");
  const clientId = requiredEnv("CWS_CLIENT_ID");
  const clientSecret = requiredEnv("CWS_CLIENT_SECRET");
  const refreshToken = requiredEnv("CWS_REFRESH_TOKEN");

  const zipPath = resolve(process.cwd(), options.zipPath);
  const accessToken = await getAccessToken({ clientId, clientSecret, refreshToken });

  console.log(`Uploading ${basename(zipPath)} to Chrome Web Store item ${extensionId}...`);
  const uploadSummary = await uploadZip({ extensionId, accessToken, zipPath });

  if (uploadSummary.uploadState !== "SUCCESS") {
    console.error(JSON.stringify(uploadSummary, null, 2));
    throw new Error("Chrome Web Store upload failed");
  }

  let publishSummary = null;
  if (options.publish) {
    console.log(`Publishing extension to target: ${options.publishTarget}`);
    publishSummary = await publishItem({ extensionId, accessToken, publishTarget: options.publishTarget });
  }

  const statusSummary = await getItemStatus({ extensionId, accessToken });

  const output = {
    extensionId,
    zipPath,
    upload: uploadSummary,
    publish: publishSummary,
    status: statusSummary
  };

  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
