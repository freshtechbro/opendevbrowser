import type { OpenDevBrowserConfig } from "../../config";
import type { CanvasImportFailureCode } from "../../canvas/types";
import { resolveFigmaAccessToken } from "./auth";
import {
  type NormalizedFigmaImportPayload,
  type NormalizedFigmaVariablePayload,
  normalizeFigmaFilePayload,
  normalizeFigmaImagesPayload,
  normalizeFigmaNodesPayload,
  normalizeFigmaVariablesPayload
} from "./normalize";

const FIGMA_API_BASE = "https://api.figma.com/v1";

export class FigmaClientError extends Error {
  readonly code: CanvasImportFailureCode;
  readonly status: number | null;
  readonly retryAfterMs: number | null;
  readonly details: Record<string, unknown>;

  constructor(
    code: CanvasImportFailureCode,
    message: string,
    options: { status?: number | null; retryAfterMs?: number | null; details?: Record<string, unknown> } = {}
  ) {
    super(message);
    this.name = "FigmaClientError";
    this.code = code;
    this.status = options.status ?? null;
    this.retryAfterMs = options.retryAfterMs ?? null;
    this.details = options.details ?? {};
  }
}

export type FigmaClientOptions = {
  config: Pick<OpenDevBrowserConfig, "integrations">;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
};

export class FigmaClient {
  private readonly accessToken: string | null;
  private readonly fetchImpl: typeof fetch;

  constructor(options: FigmaClientOptions) {
    this.accessToken = resolveFigmaAccessToken(options.config, options.env);
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async getFile(
    fileKey: string,
    options: {
      branchData?: boolean;
      geometryPaths?: boolean;
    } = {}
  ): Promise<NormalizedFigmaImportPayload> {
    const params = new URLSearchParams();
    if (options.branchData !== false) {
      params.set("branch_data", "true");
    }
    if (options.geometryPaths) {
      params.set("geometry", "paths");
    }
    const raw = await this.requestJson(`/files/${encodeURIComponent(fileKey)}?${params.toString()}`, "file_content:read");
    return normalizeFigmaFilePayload(fileKey, raw);
  }

  async getNodes(
    fileKey: string,
    nodeIds: string[],
    options: {
      branchData?: boolean;
      depth?: number | null;
      geometryPaths?: boolean;
    } = {}
  ): Promise<NormalizedFigmaImportPayload> {
    if (nodeIds.length === 0) {
      throw new FigmaClientError("node_not_found", "Figma node import requires at least one node id.");
    }
    const params = new URLSearchParams({
      ids: nodeIds.join(",")
    });
    if (options.branchData !== false) {
      params.set("branch_data", "true");
    }
    if (typeof options.depth === "number" && Number.isFinite(options.depth) && options.depth > 0) {
      params.set("depth", String(Math.floor(options.depth)));
    }
    if (options.geometryPaths) {
      params.set("geometry", "paths");
    }
    const raw = await this.requestJson(`/files/${encodeURIComponent(fileKey)}/nodes?${params.toString()}`, "file_content:read");
    return normalizeFigmaNodesPayload(fileKey, raw);
  }

  async getImages(
    fileKey: string,
    nodeIds: string[],
    format: "png" | "svg"
  ): Promise<Record<string, string>> {
    if (nodeIds.length === 0) {
      return {};
    }
    const params = new URLSearchParams({
      ids: nodeIds.join(","),
      format
    });
    const raw = await this.requestJson(`/images/${encodeURIComponent(fileKey)}?${params.toString()}`, "file_content:read");
    return normalizeFigmaImagesPayload(raw);
  }

  async getLocalVariables(fileKey: string): Promise<NormalizedFigmaVariablePayload> {
    const raw = await this.requestJson(`/files/${encodeURIComponent(fileKey)}/variables/local`, "file_variables:read");
    return normalizeFigmaVariablesPayload(raw);
  }

  async downloadAsset(url: string): Promise<{ buffer: Buffer; contentType: string | null }> {
    if (!this.accessToken) {
      throw new FigmaClientError("missing_token", "Figma import requires FIGMA_ACCESS_TOKEN or integrations.figma.accessToken.");
    }
    const response = await this.fetchImpl(url, {
      headers: {
        "X-Figma-Token": this.accessToken
      }
    });
    if (!response.ok) {
      throw buildFigmaError({
        endpoint: url,
        status: response.status,
        bodyText: await safeReadText(response)
      }, "asset_fetch_failed");
    }
    const arrayBuffer = await response.arrayBuffer();
    return {
      buffer: Buffer.from(arrayBuffer),
      contentType: response.headers.get("content-type")
    };
  }

  private async requestJson(endpoint: string, requiredScope: string): Promise<unknown> {
    if (!this.accessToken) {
      throw new FigmaClientError("missing_token", "Figma import requires FIGMA_ACCESS_TOKEN or integrations.figma.accessToken.", {
        details: { endpoint, requiredScope }
      });
    }
    const response = await this.fetchImpl(`${FIGMA_API_BASE}${endpoint}`, {
      headers: {
        "X-Figma-Token": this.accessToken
      }
    });
    if (!response.ok) {
      throw buildFigmaError({
        endpoint,
        status: response.status,
        bodyText: await safeReadText(response)
      });
    }
    return await response.json();
  }
}

export function isFigmaClientError(value: unknown): value is FigmaClientError {
  return value instanceof FigmaClientError;
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

function buildFigmaError(
  input: {
    endpoint: string;
    status: number;
    bodyText: string;
  },
  fallbackCode: CanvasImportFailureCode = "variables_unavailable"
): FigmaClientError {
  const retryAfterMs = parseRetryAfterMs(input.bodyText);
  const lower = input.bodyText.toLowerCase();
  if (input.status === 429) {
    return new FigmaClientError("rate_limited", "Figma rate limited the import request.", {
      status: input.status,
      retryAfterMs,
      details: { endpoint: input.endpoint, bodyText: input.bodyText }
    });
  }
  if (input.status === 404 && input.endpoint.includes("/nodes")) {
    return new FigmaClientError("node_not_found", "Requested Figma node was not found.", {
      status: input.status,
      details: { endpoint: input.endpoint, bodyText: input.bodyText }
    });
  }
  if (input.endpoint.endsWith("/variables/local")) {
    if (lower.includes("scope")) {
      return new FigmaClientError("scope_denied", "Figma denied variables access because the token scope is missing.", {
        status: input.status,
        details: { endpoint: input.endpoint, bodyText: input.bodyText }
      });
    }
    if (lower.includes("plan")) {
      return new FigmaClientError("plan_limited", "Figma variables access is limited by the current plan.", {
        status: input.status,
        details: { endpoint: input.endpoint, bodyText: input.bodyText }
      });
    }
    if (lower.includes("seat") || lower.includes("entitlement") || lower.includes("account")) {
      return new FigmaClientError("account_limited", "Figma variables access is limited by the current account.", {
        status: input.status,
        details: { endpoint: input.endpoint, bodyText: input.bodyText }
      });
    }
    return new FigmaClientError("variables_unavailable", "Figma variables are unavailable for this import.", {
      status: input.status,
      details: { endpoint: input.endpoint, bodyText: input.bodyText }
    });
  }
  if (input.status === 401 || input.status === 403) {
    return new FigmaClientError("scope_denied", "Figma denied the import request.", {
      status: input.status,
      details: { endpoint: input.endpoint, bodyText: input.bodyText }
    });
  }
  return new FigmaClientError(fallbackCode, "Figma import request failed.", {
    status: input.status,
    retryAfterMs,
    details: { endpoint: input.endpoint, bodyText: input.bodyText }
  });
}

function parseRetryAfterMs(bodyText: string): number | null {
  const match = bodyText.match(/retry[- ]after[^0-9]*([0-9]+)/i);
  if (!match) {
    return null;
  }
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) ? seconds * 1000 : null;
}
