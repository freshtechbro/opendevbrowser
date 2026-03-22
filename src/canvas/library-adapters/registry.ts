import { BUILT_IN_REACT_LIBRARY_ADAPTERS } from "./react/index";
import type { CanvasLibraryAdapter, CanvasLibrarySourceContext, CanvasSourceImport } from "./types";

const IMPORT_RE = /import\s+(?:type\s+)?(?:(?<clause>[^;]*?)\s+from\s+)?["'](?<source>[^"']+)["'];?/g;

function parseImportClause(clause: string | undefined): Pick<CanvasSourceImport, "defaultImport" | "namespaceImport" | "specifiers"> {
  const trimmed = clause?.trim();
  if (!trimmed) {
    return { specifiers: [] };
  }
  if (trimmed.startsWith("* as ")) {
    return {
      namespaceImport: trimmed.slice(5).trim(),
      specifiers: []
    };
  }
  if (!trimmed.includes("{")) {
    return {
      defaultImport: trimmed.replace(/,$/, "").trim(),
      specifiers: []
    };
  }
  const [defaultImportCandidate = "", namedBlockCandidate = ""] = trimmed.split("{", 2);
  const defaultImport = defaultImportCandidate.replace(/,$/, "").trim() || undefined;
  const namedBlock = namedBlockCandidate.split("}", 1).join("");
  return {
    ...(defaultImport ? { defaultImport } : {}),
    specifiers: namedBlock
      .split(",")
      .map((entry) => {
        const normalized = entry.trim();
        const aliasSegments = normalized.split(/\s+as\s+/i);
        return aliasSegments[aliasSegments.length - 1]!;
      })
      .map((entry) => entry.trim())
      .filter(Boolean)
  };
}

export function extractSourceImports(sourceText: string): CanvasSourceImport[] {
  const imports: CanvasSourceImport[] = [];
  for (const match of sourceText.matchAll(IMPORT_RE)) {
    const source = match.groups?.source?.trim();
    if (!source) {
      continue;
    }
    const clause = parseImportClause(match.groups?.clause);
    imports.push({
      source,
      specifiers: clause.specifiers,
      ...(clause.defaultImport ? { defaultImport: clause.defaultImport } : {}),
      ...(clause.namespaceImport ? { namespaceImport: clause.namespaceImport } : {})
    });
  }
  return imports;
}

export class CanvasLibraryAdapterRegistry {
  private readonly adapters = new Map<string, CanvasLibraryAdapter>();

  register(adapter: CanvasLibraryAdapter): void {
    if (this.adapters.has(adapter.id)) {
      throw new Error(`duplicate_adapter_id:${adapter.id}`);
    }
    this.adapters.set(adapter.id, adapter);
  }

  get(id: string): CanvasLibraryAdapter | null {
    return this.adapters.get(id) ?? null;
  }

  list(): CanvasLibraryAdapter[] {
    return [...this.adapters.values()];
  }

  resolveForSource(context: CanvasLibrarySourceContext): CanvasLibraryAdapter[] {
    return this.list().filter((adapter) => {
      if (adapter.frameworkId !== context.frameworkId) {
        return false;
      }
      if (adapter.resolutionStrategy !== "import") {
        return false;
      }
      return context.imports.some((importDecl) => adapter.matchesImport?.(importDecl) === true);
    });
  }
}

export function createLibraryAdapterRegistry(): CanvasLibraryAdapterRegistry {
  const registry = new CanvasLibraryAdapterRegistry();
  for (const adapter of BUILT_IN_REACT_LIBRARY_ADAPTERS) {
    registry.register(adapter);
  }
  return registry;
}
