import type { CanvasLibraryAdapter, CanvasLibraryProjectionHint, CanvasLibrarySourceNodeContext } from "../types";

type PackageAdapterOptions = {
  id: string;
  kind: string;
  packages: string[];
};

function exactOrPrefixMatch(source: string, packages: string[]): boolean {
  return packages.some((entry) => source === entry || source.startsWith(`${entry}/`));
}

function buildImportProjection(id: string, source: string): CanvasLibraryProjectionHint {
  return {
    attributes: {
      "data-library-adapter": id,
      "data-library-source": source
    },
    metadata: {
      source
    }
  };
}

function createPackageImportAdapter(options: PackageAdapterOptions): CanvasLibraryAdapter {
  return {
    id: options.id,
    frameworkId: "react",
    kind: options.kind,
    resolutionStrategy: "import",
    capabilities: ["preview", "inventory_extract", "code_pull", "token_roundtrip"],
    packages: options.packages,
    sourceLocatorSchema: "import-specifier",
    matchesImport: (importDecl) => exactOrPrefixMatch(importDecl.source, options.packages),
    matchesSourceNode: ({ imports, componentName, tagName }) => {
      const candidate = componentName ?? tagName ?? "";
      if (!candidate) {
        return false;
      }
      return imports.some((entry) =>
        exactOrPrefixMatch(entry.source, options.packages) && (
          entry.specifiers.includes(candidate) ||
          entry.defaultImport === candidate ||
          entry.namespaceImport === candidate
        )
      );
    },
    buildInventoryItem: ({ componentName }) => componentName
      ? {
        description: `Resolved via ${options.id}`,
        metadata: {
          libraryAdapterId: options.id
        }
      }
      : null,
    buildProjectionDescriptor: ({ imports }) => {
      const matched = imports.find((entry) => exactOrPrefixMatch(entry.source, options.packages));
      return matched ? buildImportProjection(options.id, matched.source) : null;
    },
    emitSourceFragment: () => null,
    extractVariantInfo: () => [],
    extractTokenBindings: () => [],
    fallbackReason: ({ componentName, tagName }) => componentName ?? tagName ?? null
  };
}

const htmlIntrinsicAdapter: CanvasLibraryAdapter = {
  id: "builtin:react/html-intrinsic",
  frameworkId: "react",
  kind: "intrinsic",
  resolutionStrategy: "tag",
  capabilities: ["preview", "inventory_extract", "code_pull", "token_roundtrip"],
  sourceLocatorSchema: "jsx-tag-name",
  matchesSourceNode: ({ tagName }) => Boolean(tagName && tagName.toLowerCase() === tagName),
  buildInventoryItem: ({ tagName }) => tagName
    ? {
      componentName: tagName,
      description: `Intrinsic ${tagName} element`,
      metadata: {
        libraryAdapterId: "builtin:react/html-intrinsic"
      }
    }
    : null,
  buildProjectionDescriptor: ({ tagName }) => tagName
    ? {
      attributes: {
        "data-library-adapter": "builtin:react/html-intrinsic",
        "data-html-tag": tagName
      },
      metadata: {}
    }
    : null,
  emitSourceFragment: () => null,
  extractVariantInfo: () => [],
  extractTokenBindings: () => [],
  fallbackReason: ({ tagName }) => tagName ?? null
};

export const BUILT_IN_REACT_LIBRARY_ADAPTERS: CanvasLibraryAdapter[] = [
  htmlIntrinsicAdapter,
  createPackageImportAdapter({
    id: "builtin:react/shadcn-ui",
    kind: "components",
    packages: ["@/components/ui", "~/components/ui", "components/ui"]
  }),
  createPackageImportAdapter({
    id: "builtin:react/lucide-react",
    kind: "icons",
    packages: ["lucide-react"]
  }),
  createPackageImportAdapter({
    id: "builtin:react/framer-motion",
    kind: "motion",
    packages: ["framer-motion"]
  }),
  createPackageImportAdapter({
    id: "builtin:react/radix-ui",
    kind: "components",
    packages: ["@radix-ui/react-icons", "@radix-ui/react-slot", "@radix-ui/react-dialog", "@radix-ui/react-dropdown-menu"]
  }),
  createPackageImportAdapter({
    id: "builtin:react/tabler-icons",
    kind: "icons",
    packages: ["@tabler/icons-react"]
  }),
  createPackageImportAdapter({
    id: "builtin:react/fluent-icons",
    kind: "icons",
    packages: ["@fluentui/react-icons"]
  }),
  createPackageImportAdapter({
    id: "builtin:react/heroicons",
    kind: "icons",
    packages: ["@heroicons/react"]
  }),
  createPackageImportAdapter({
    id: "builtin:react/mui",
    kind: "components",
    packages: ["@mui/material", "@mui/icons-material"]
  }),
  createPackageImportAdapter({
    id: "builtin:react/chakra-ui",
    kind: "components",
    packages: ["@chakra-ui/react"]
  }),
  createPackageImportAdapter({
    id: "builtin:react/antd",
    kind: "components",
    packages: ["antd"]
  })
];
