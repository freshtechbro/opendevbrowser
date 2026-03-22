import { readFileSync } from "fs";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenDevBrowserConfig } from "../src/config";
import { FigmaClient, FigmaClientError, isFigmaClientError } from "../src/integrations/figma/client";

const BASE_CONFIG: Pick<OpenDevBrowserConfig, "integrations"> = {
  integrations: {
    figma: {}
  }
};

function readFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(process.cwd(), "tests", "fixtures", "figma", name), "utf8"));
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json"
    },
    ...init
  });
}

describe("FigmaClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("builds successful file, node, image, and variable requests", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse(readFixture("file-response.json")))
      .mockResolvedValueOnce(jsonResponse(readFixture("nodes-response.json")))
      .mockResolvedValueOnce(jsonResponse({
        images: {
          "5:1": "https://cdn.example.com/5-1.png"
        }
      }))
      .mockResolvedValueOnce(jsonResponse(readFixture("variables-response.json")));
    const client = new FigmaClient({
      config: BASE_CONFIG,
      env: {
        FIGMA_ACCESS_TOKEN: "test-token"
      },
      fetchImpl: fetchImpl as unknown as typeof fetch
    });

    const filePayload = await client.getFile("AbCdEf12345", {
      branchData: false,
      geometryPaths: true
    });
    const nodePayload = await client.getNodes("AbCdEf12345", ["2:1"], {
      branchData: false,
      depth: 2.7,
      geometryPaths: true
    });
    const images = await client.getImages("AbCdEf12345", ["5:1"], "png");
    const variables = await client.getLocalVariables("AbCdEf12345");

    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe("https://api.figma.com/v1/files/AbCdEf12345?geometry=paths");
    expect(String(fetchImpl.mock.calls[1]?.[0])).toContain("/files/AbCdEf12345/nodes?");
    expect(String(fetchImpl.mock.calls[1]?.[0])).toContain("ids=2%3A1");
    expect(String(fetchImpl.mock.calls[1]?.[0])).toContain("depth=2");
    expect(String(fetchImpl.mock.calls[1]?.[0])).toContain("geometry=paths");
    expect(String(fetchImpl.mock.calls[2]?.[0])).toContain("/images/AbCdEf12345?ids=5%3A1&format=png");
    expect(String(fetchImpl.mock.calls[3]?.[0])).toBe("https://api.figma.com/v1/files/AbCdEf12345/variables/local");
    expect(filePayload.fileKey).toBe("AbCdEf12345");
    expect(nodePayload.rootNodes).toHaveLength(1);
    expect(images).toEqual({
      "5:1": "https://cdn.example.com/5-1.png"
    });
    expect(variables.collections.length).toBeGreaterThan(0);
  });

  it("short-circuits empty image requests and fails fast when no access token is configured", async () => {
    const fetchImpl = vi.fn();
    const missingTokenClient = new FigmaClient({
      config: BASE_CONFIG,
      env: {},
      fetchImpl: fetchImpl as unknown as typeof fetch
    });
    const tokenError = await missingTokenClient.getFile("AbCdEf12345").catch((error: unknown) => error);
    const downloadError = await missingTokenClient.downloadAsset("https://cdn.example.com/asset.png").catch((error: unknown) => error);

    expect(await missingTokenClient.getImages("AbCdEf12345", [], "svg")).toEqual({});
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(tokenError).toMatchObject({
      code: "missing_token",
      details: {
        endpoint: "/files/AbCdEf12345?branch_data=true",
        requiredScope: "file_content:read"
      }
    });
    expect(downloadError).toMatchObject({
      code: "missing_token"
    });
  });

  it("classifies rate-limited and missing-node responses", async () => {
    const rateLimitedFetch = vi.fn().mockResolvedValueOnce(new Response("Retry-After 17", {
      status: 429
    }));
    const rateLimitedClient = new FigmaClient({
      config: BASE_CONFIG,
      env: {
        FIGMA_ACCESS_TOKEN: "test-token"
      },
      fetchImpl: rateLimitedFetch as unknown as typeof fetch
    });

    await expect(rateLimitedClient.getFile("AbCdEf12345")).rejects.toMatchObject({
      code: "rate_limited",
      status: 429,
      retryAfterMs: 17_000
    });

    const missingNodeFetch = vi.fn().mockResolvedValueOnce(new Response("missing node", {
      status: 404
    }));
    const missingNodeClient = new FigmaClient({
      config: BASE_CONFIG,
      env: {
        FIGMA_ACCESS_TOKEN: "test-token"
      },
      fetchImpl: missingNodeFetch as unknown as typeof fetch
    });

    await expect(missingNodeClient.getNodes("AbCdEf12345", [])).rejects.toMatchObject({
      code: "node_not_found"
    });
    await expect(missingNodeClient.getNodes("AbCdEf12345", ["2:1"])).rejects.toMatchObject({
      code: "node_not_found",
      status: 404
    });
  });

  it("drops non-finite retry-after hints from rate-limited responses", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response(`Retry-After ${"9".repeat(400)}`, {
      status: 429
    }));
    const client = new FigmaClient({
      config: BASE_CONFIG,
      env: {
        FIGMA_ACCESS_TOKEN: "test-token"
      },
      fetchImpl: fetchImpl as unknown as typeof fetch
    });

    await expect(client.getFile("AbCdEf12345")).rejects.toMatchObject({
      code: "rate_limited",
      retryAfterMs: null
    });
  });

  it.each([
    {
      label: "scope-denied",
      body: "missing scope permission",
      expectedCode: "scope_denied"
    },
    {
      label: "plan-limited",
      body: "variables are plan limited",
      expectedCode: "plan_limited"
    },
    {
      label: "account-limited",
      body: "seat entitlement account issue",
      expectedCode: "account_limited"
    },
    {
      label: "variables-unavailable",
      body: "temporary upstream issue",
      expectedCode: "variables_unavailable"
    }
  ])("classifies variable endpoint failures for $label responses", async ({ body, expectedCode }) => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response(body, {
      status: 403
    }));
    const client = new FigmaClient({
      config: BASE_CONFIG,
      env: {
        FIGMA_ACCESS_TOKEN: "test-token"
      },
      fetchImpl: fetchImpl as unknown as typeof fetch
    });

    await expect(client.getLocalVariables("AbCdEf12345")).rejects.toMatchObject({
      code: expectedCode,
      status: 403
    });
  });

  it("classifies generic auth failures, download failures, and error typing", async () => {
    const authFetch = vi.fn().mockResolvedValueOnce(new Response("forbidden", {
      status: 403
    }));
    const authClient = new FigmaClient({
      config: BASE_CONFIG,
      env: {
        FIGMA_ACCESS_TOKEN: "test-token"
      },
      fetchImpl: authFetch as unknown as typeof fetch
    });
    const authError = await authClient.getFile("AbCdEf12345").catch((error: unknown) => error);

    expect(isFigmaClientError(authError)).toBe(true);
    expect(authError).toMatchObject({
      code: "scope_denied",
      status: 403
    });
    expect(isFigmaClientError(new Error("not a figma client error"))).toBe(false);

    const brokenResponse = {
      ok: false,
      status: 500,
      headers: new Headers(),
      text: async () => {
        throw new Error("read failed");
      },
      json: async () => ({}),
      arrayBuffer: async () => new ArrayBuffer(0)
    } as unknown as Response;
    const assetFetch = vi.fn().mockResolvedValueOnce(brokenResponse);
    const assetClient = new FigmaClient({
      config: BASE_CONFIG,
      env: {
        FIGMA_ACCESS_TOKEN: "test-token"
      },
      fetchImpl: assetFetch as unknown as typeof fetch
    });

    await expect(assetClient.downloadAsset("https://cdn.example.com/asset.png")).rejects.toMatchObject({
      code: "asset_fetch_failed",
      status: 500,
      details: {
        bodyText: ""
      }
    });
  });

  it("preserves download metadata when assets succeed", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response("svg-bytes", {
      status: 200,
      headers: {
        "content-type": "image/svg+xml"
      }
    }));
    const client = new FigmaClient({
      config: BASE_CONFIG,
      env: {
        FIGMA_ACCESS_TOKEN: "test-token"
      },
      fetchImpl: fetchImpl as unknown as typeof fetch
    });

    const asset = await client.downloadAsset("https://cdn.example.com/asset.svg");

    expect(asset.contentType).toBe("image/svg+xml");
    expect(asset.buffer.toString("utf8")).toBe("svg-bytes");
  });
});
