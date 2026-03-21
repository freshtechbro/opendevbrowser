import { describe, expect, it } from "vitest";
import {
  collectCanvasTokenDefinitions,
  cssCustomPropertyToTokenPath,
  hasCanvasTokenReferences,
  normalizeCanvasTokenPath,
  readCanvasTokenPath,
  readTokenPathFromCssValue,
  resolveCanvasTokenValue,
  resolveTokenRefStyleValue,
  stringifyTokenCssValue,
  tokenPathToCssCustomProperty,
  tokenPathToCssVar
} from "../src/canvas/token-references";
import type { CanvasTokenStore } from "../src/canvas/types";

function createTokenStore(): CanvasTokenStore {
  return {
    values: {
      semantic: {
        text: "#222222",
        nested: {
          strong: true
        },
        ignored: ["skip-me"],
        empty: {}
      },
      primitive: {
        spacing: {
          sm: 4
        }
      }
    },
    collections: [
      {
        id: "collection-colors",
        name: "Colors",
        items: [
          {
            id: "item-primary",
            path: "palette/primary",
            value: "#ff0000",
            type: "color",
            description: null,
            modes: [
              {
                id: "dark",
                name: "Dark",
                value: "#000000",
                metadata: {}
              }
            ],
            metadata: {}
          },
          {
            id: "item-secondary",
            path: "palette/secondary",
            value: "#00ff00",
            type: "color",
            description: null,
            modes: [],
            metadata: {}
          }
        ],
        metadata: {}
      }
    ],
    aliases: [
      {
        path: "semantic/bg",
        targetPath: "palette/primary",
        modeId: "dark",
        metadata: {}
      },
      {
        path: "semantic/bg",
        targetPath: "palette/secondary",
        metadata: {}
      },
      {
        path: "semantic/loop-a",
        targetPath: "semantic/loop-b",
        metadata: {}
      },
      {
        path: "semantic/loop-b",
        targetPath: "semantic/loop-a",
        metadata: {}
      },
      {
        path: "semantic/missing",
        targetPath: "palette/missing",
        metadata: {}
      }
    ],
    bindings: [],
    metadata: {}
  };
}

describe("canvas token references", () => {
  it("encodes and decodes css token references while rejecting malformed values", () => {
    const customProperty = tokenPathToCssCustomProperty(" tokens.brand.primary ");

    expect(normalizeCanvasTokenPath(" tokens.brand.primary ")).toBe("brand.primary");
    expect(customProperty).toContain("--odb-token-");
    expect(cssCustomPropertyToTokenPath(customProperty)).toBe("brand.primary");
    expect(readTokenPathFromCssValue(tokenPathToCssVar("tokens.brand.primary"))).toBe("brand.primary");
    expect(cssCustomPropertyToTokenPath("--not-odb-token")).toBeNull();
    expect(readTokenPathFromCssValue("rgb(0, 0, 0)")).toBeNull();
  });

  it("reads token paths and resolves aliases, modes, raw values, and recursion guards", () => {
    const tokens = createTokenStore();

    expect(readCanvasTokenPath(" tokens.semantic.text ")).toBe("semantic.text");
    expect(readCanvasTokenPath({ tokenPath: " tokens.semantic/bg " })).toBe("semantic/bg");
    expect(readCanvasTokenPath({ path: " tokens.semantic.text " })).toBe("semantic.text");
    expect(readCanvasTokenPath(0)).toBeNull();
    expect(readCanvasTokenPath({ tokenPath: "" })).toBeNull();

    expect(resolveCanvasTokenValue(tokens, "semantic/bg", "dark")).toBe("#000000");
    expect(resolveCanvasTokenValue(tokens, "semantic/bg", "light")).toBe("#00ff00");
    expect(resolveCanvasTokenValue(tokens, "palette/primary", "dark")).toBe("#000000");
    expect(resolveCanvasTokenValue(tokens, "semantic.text")).toBe("#222222");
    expect(resolveCanvasTokenValue(tokens, "semantic.nested.strong")).toBe(true);
    expect(resolveCanvasTokenValue(tokens, "semantic/loop-a")).toBeUndefined();
    expect(resolveCanvasTokenValue(tokens, "semantic/missing")).toBeUndefined();
  });

  it("collects base and mode token definitions while skipping array payloads", () => {
    const tokens = createTokenStore();
    const definitions = collectCanvasTokenDefinitions(tokens);
    const baseValues = Object.fromEntries(definitions.base.map((entry) => [entry.path, entry.value]));
    const darkValues = Object.fromEntries((definitions.byMode.get("dark") ?? []).map((entry) => [entry.path, entry.value]));

    expect(baseValues).toMatchObject({
      "semantic.text": "#222222",
      "semantic.nested.strong": true,
      "primitive.spacing.sm": 4,
      "palette/primary": "#ff0000",
      "palette/secondary": "#00ff00"
    });
    expect(baseValues["semantic.ignored"]).toBeUndefined();
    expect(baseValues["semantic.empty"]).toEqual({});
    expect(darkValues).toEqual({
      "palette/primary": "#000000"
    });

    const malformedArrayValues = collectCanvasTokenDefinitions({
      ...tokens,
      values: ["legacy-array"] as unknown as Record<string, unknown>
    });
    const malformedScalarValues = collectCanvasTokenDefinitions({
      ...tokens,
      values: "legacy-scalar" as unknown as Record<string, unknown>
    });

    expect(malformedArrayValues.base.map((entry) => entry.path)).toContain("palette/primary");
    expect(malformedScalarValues.base.map((entry) => entry.path)).toContain("palette/secondary");
  });

  it("stringifies css values and resolves node style references against the token store", () => {
    const tokens = createTokenStore();

    expect(stringifyTokenCssValue("12px")).toBe("12px");
    expect(stringifyTokenCssValue(12)).toBe("12");
    expect(stringifyTokenCssValue(false)).toBe("false");
    expect(stringifyTokenCssValue({ invalid: true })).toBeNull();

    expect(hasCanvasTokenReferences({
      color: "semantic/bg",
      borderColor: { tokenPath: "palette/primary" }
    })).toBe(true);
    expect(hasCanvasTokenReferences({ color: 12 })).toBe(false);

    expect(resolveTokenRefStyleValue(tokens, "backgroundColor", {
      backgroundColor: { tokenPath: "semantic/bg" }
    }, "dark")).toBe("#000000");
    expect(resolveTokenRefStyleValue(tokens, "color", {
      color: { path: "semantic.text" }
    })).toBe("#222222");
    expect(resolveTokenRefStyleValue(tokens, "missing", {}, "dark")).toBeUndefined();
  });

  it("covers blank token slugs, empty decodes, mode-map reuse, and undefined token values", () => {
    const tokens = createTokenStore();
    const whitespaceProperty = `--odb-token-token__${Buffer.from("   ", "utf8").toString("base64url")}`;

    expect(tokenPathToCssCustomProperty(" tokens.!!! ")).toContain("--odb-token-token__");
    expect(cssCustomPropertyToTokenPath(whitespaceProperty)).toBeNull();
    expect(resolveCanvasTokenValue(tokens, "palette/secondary")).toBe("#00ff00");
    expect(stringifyTokenCssValue(true)).toBe("true");

    const edgeTokens: CanvasTokenStore = {
      ...tokens,
      collections: [
        ...tokens.collections,
        {
          id: "collection-edge",
          name: "Edge",
          items: [
            {
              id: "item-mode-fallback",
              path: "palette/mode-fallback",
              value: "#abcdef",
              type: "color",
              description: null,
              modes: [
                {
                  id: "dark",
                  name: "Dark",
                  value: undefined,
                  metadata: {}
                }
              ],
              metadata: {}
            },
            {
              id: "item-mode-only",
              path: "palette/mode-only",
              value: undefined,
              type: "color",
              description: null,
              modes: [
                {
                  id: "dark",
                  name: "Dark",
                  value: undefined,
                  metadata: {}
                }
              ],
              metadata: {}
            },
            {
              id: "item-mode-reuse",
              path: "palette/mode-reuse",
              value: "#123456",
              type: "color",
              description: null,
              modes: [
                {
                  id: "dark",
                  name: "Dark",
                  value: "#654321",
                  metadata: {}
                }
              ],
              metadata: {}
            }
          ],
          metadata: {}
        }
      ]
    };

    expect(resolveCanvasTokenValue(edgeTokens, "palette/mode-fallback", "dark")).toBe("#abcdef");
    expect(resolveCanvasTokenValue(edgeTokens, "palette/mode-only", "dark")).toBeUndefined();

    const definitions = collectCanvasTokenDefinitions(edgeTokens);
    const darkValues = Object.fromEntries((definitions.byMode.get("dark") ?? []).map((entry) => [entry.path, entry.value]));
    expect(darkValues["palette/mode-reuse"]).toBe("#654321");
    expect(darkValues["palette/mode-only"]).toBeUndefined();
  });

  it("ignores scalar root token bags without emitting empty token paths", () => {
    const definitions = collectCanvasTokenDefinitions({
      values: "legacy-root" as unknown as Record<string, unknown>,
      collections: [],
      aliases: [],
      bindings: [],
      metadata: {}
    });

    expect(definitions.base).toEqual([]);
    expect(definitions.byMode.size).toBe(0);
  });
});
