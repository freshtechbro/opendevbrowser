import { describe, expect, it } from "vitest";
import { FigmaClient, isFigmaClientError } from "../src/integrations/figma/client";
import { mapFigmaImportToCanvas } from "../src/integrations/figma/mappers";
import { normalizeFigmaImportRequest } from "../src/integrations/figma/url";
import { mapFigmaVariablesToTokenStore } from "../src/integrations/figma/variables";

const FIGMA_ACCESS_TOKEN = process.env.FIGMA_ACCESS_TOKEN ?? "";
const FIGMA_SOURCE_URL = process.env.CANVAS_FIGMA_LIVE_URL ?? "";

describe("canvas figma live smoke", () => {
  it.skipIf(FIGMA_ACCESS_TOKEN.length === 0 || FIGMA_SOURCE_URL.length === 0)(
    "imports a live figma payload into non-empty canvas state",
    async () => {
      const client = new FigmaClient({
        config: {
          integrations: {
            figma: {
              accessToken: FIGMA_ACCESS_TOKEN
            }
          }
        }
      });
      const request = normalizeFigmaImportRequest({
        sourceUrl: FIGMA_SOURCE_URL,
        mode: "append_pages"
      });
      const payload = request.nodeIds.length > 0
        ? await client.getNodes(request.fileKey, request.nodeIds, {
          branchData: request.branchData,
          depth: request.depth,
          geometryPaths: request.geometryPaths
        })
        : await client.getFile(request.fileKey, {
          branchData: request.branchData,
          geometryPaths: request.geometryPaths
        });
      let variables = null;
      try {
        variables = request.includeVariables
          ? mapFigmaVariablesToTokenStore(await client.getLocalVariables(request.fileKey))
          : null;
      } catch (error) {
        if (
          !isFigmaClientError(error)
          || !["scope_denied", "plan_limited", "account_limited", "variables_unavailable"].includes(error.code)
        ) {
          throw error;
        }
      }

      const mapping = mapFigmaImportToCanvas({
        payload,
        assets: [],
        variables
      });

      expect(mapping.pages.length + mapping.componentInventory.length).toBeGreaterThan(0);
    }
  );
});
