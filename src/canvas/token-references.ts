import type { CanvasTokenStore } from "./types";

type TokenDefinition = {
  path: string;
  value: unknown;
  cssCustomProperty: string;
};

const TOKEN_CSS_PREFIX = "--odb-token-";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function normalizeCanvasTokenPath(path: string): string {
  return path.trim().replace(/^tokens\./, "");
}

function slugifyTokenPath(path: string): string {
  const slug = normalizeCanvasTokenPath(path)
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return slug.length > 0 ? slug : "token";
}

function encodeTokenPath(path: string): string {
  return Buffer.from(normalizeCanvasTokenPath(path), "utf8").toString("base64url");
}

function decodeTokenPath(value: string): string | null {
  try {
    const decoded = Buffer.from(value, "base64url").toString("utf8");
    return decoded.trim().length > 0 ? decoded : null;
  } catch {
    return null;
  }
}

export function tokenPathToCssCustomProperty(path: string): string {
  const normalized = normalizeCanvasTokenPath(path);
  return `${TOKEN_CSS_PREFIX}${slugifyTokenPath(normalized)}__${encodeTokenPath(normalized)}`;
}

export function tokenPathToCssVar(path: string): string {
  return `var(${tokenPathToCssCustomProperty(path)})`;
}

export function cssCustomPropertyToTokenPath(property: string): string | null {
  const match = property.trim().match(/^--odb-token-[a-z0-9-]+__([a-zA-Z0-9_-]+)$/);
  if (!match?.[1]) {
    return null;
  }
  return decodeTokenPath(match[1]);
}

export function readTokenPathFromCssValue(value: string): string | null {
  const match = value.trim().match(/^var\(\s*(--[a-zA-Z0-9_-]+)(?:\s*,[^)]*)?\s*\)$/);
  if (!match?.[1]) {
    return null;
  }
  return cssCustomPropertyToTokenPath(match[1]);
}

export function readCanvasTokenPath(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return normalizeCanvasTokenPath(value);
  }
  if (!isRecord(value)) {
    return null;
  }
  if (typeof value.tokenPath === "string" && value.tokenPath.trim().length > 0) {
    return normalizeCanvasTokenPath(value.tokenPath);
  }
  if (typeof value.path === "string" && value.path.trim().length > 0) {
    return normalizeCanvasTokenPath(value.path);
  }
  return null;
}

function readNestedRecordValue(record: Record<string, unknown>, path: string): unknown {
  let current: unknown = record;
  for (const segment of normalizeCanvasTokenPath(path).split(".").filter(Boolean)) {
    if (!isRecord(current) || !(segment in current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

function resolveAlias(
  tokens: CanvasTokenStore,
  path: string,
  modeId?: string | null
): string | null {
  const normalized = normalizeCanvasTokenPath(path);
  const modeMatch = tokens.aliases.find((entry) => entry.path === normalized && entry.modeId === modeId);
  if (modeMatch) {
    return normalizeCanvasTokenPath(modeMatch.targetPath);
  }
  const sharedMatch = tokens.aliases.find((entry) => entry.path === normalized && !entry.modeId);
  return sharedMatch ? normalizeCanvasTokenPath(sharedMatch.targetPath) : null;
}

function findCollectionItem(tokens: CanvasTokenStore, path: string) {
  const normalized = normalizeCanvasTokenPath(path);
  for (const collection of tokens.collections) {
    const match = collection.items.find((item) => item.path === normalized);
    if (match) {
      return match;
    }
  }
  return null;
}

export function resolveCanvasTokenValue(
  tokens: CanvasTokenStore,
  path: string,
  modeId?: string | null,
  seen: Set<string> = new Set()
): unknown {
  const normalized = normalizeCanvasTokenPath(path);
  const visitKey = `${normalized}:${modeId ?? ""}`;
  if (seen.has(visitKey)) {
    return undefined;
  }
  seen.add(visitKey);

  const aliasPath = resolveAlias(tokens, normalized, modeId);
  if (aliasPath) {
    const aliased = resolveCanvasTokenValue(tokens, aliasPath, modeId, seen);
    if (aliased !== undefined) {
      return aliased;
    }
  }

  const collectionItem = findCollectionItem(tokens, normalized);
  if (collectionItem) {
    if (modeId) {
      const modeValue = collectionItem.modes.find((entry) => entry.id === modeId)?.value;
      if (modeValue !== undefined) {
        return modeValue;
      }
    }
    if (collectionItem.value !== undefined) {
      return collectionItem.value;
    }
  }

  return readNestedRecordValue(tokens.values, normalized);
}

function collectLeafTokenValues(
  value: unknown,
  prefix: string,
  target: Map<string, unknown>
): void {
  if (Array.isArray(value)) {
    return;
  }
  if (!isRecord(value)) {
    if (prefix.length > 0) {
      target.set(prefix, value);
    }
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    const nextPath = prefix ? `${prefix}.${key}` : key;
    if (isRecord(entry) && Object.keys(entry).length > 0) {
      collectLeafTokenValues(entry, nextPath, target);
      continue;
    }
    if (Array.isArray(entry)) {
      continue;
    }
    target.set(nextPath, entry);
  }
}

export function collectCanvasTokenDefinitions(tokens: CanvasTokenStore): {
  base: TokenDefinition[];
  byMode: Map<string, TokenDefinition[]>;
} {
  const baseValues = new Map<string, unknown>();
  collectLeafTokenValues(tokens.values, "", baseValues);
  for (const collection of tokens.collections) {
    for (const item of collection.items) {
      if (item.value !== undefined) {
        baseValues.set(normalizeCanvasTokenPath(item.path), item.value);
      }
    }
  }

  const modeValues = new Map<string, Map<string, unknown>>();
  for (const collection of tokens.collections) {
    for (const item of collection.items) {
      for (const mode of item.modes) {
        if (mode.value === undefined) {
          continue;
        }
        let entries = modeValues.get(mode.id);
        if (!entries) {
          entries = new Map<string, unknown>();
          modeValues.set(mode.id, entries);
        }
        entries.set(normalizeCanvasTokenPath(item.path), mode.value);
      }
    }
  }

  return {
    base: [...baseValues.entries()].map(([path, value]) => ({
      path,
      value,
      cssCustomProperty: tokenPathToCssCustomProperty(path)
    })),
    byMode: new Map(
      [...modeValues.entries()].map(([modeId, values]) => [
        modeId,
        [...values.entries()].map(([path, value]) => ({
          path,
          value,
          cssCustomProperty: tokenPathToCssCustomProperty(path)
        }))
      ])
    )
  };
}

export function stringifyTokenCssValue(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return null;
}

export function hasCanvasTokenReferences(tokenRefs: Record<string, unknown>): boolean {
  return Object.values(tokenRefs).some((value) => readCanvasTokenPath(value) !== null);
}

export function resolveTokenRefStyleValue(
  tokens: CanvasTokenStore,
  property: string,
  tokenRefs: Record<string, unknown>,
  modeId?: string | null
): unknown {
  const path = readCanvasTokenPath(tokenRefs[property]);
  return path ? resolveCanvasTokenValue(tokens, path, modeId) : undefined;
}
