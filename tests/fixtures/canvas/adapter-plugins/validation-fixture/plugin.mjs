function createSourceSpan(sourceText) {
  const lines = sourceText.split(/\r?\n/);
  const lastLine = lines[lines.length - 1] ?? "";
  return {
    start: { offset: 0, line: 1, column: 1 },
    end: {
      offset: sourceText.length,
      line: lines.length,
      column: lastLine.length + 1
    }
  };
}

export async function createCanvasAdapterPlugin({ manifest }) {
  const descriptor = manifest.frameworkAdapters[0];
  if (!descriptor) {
    throw new Error("missing_framework_descriptor");
  }

  return {
    manifest,

    async initialize() {},

    async validateWorkspace() {},

    async registerFrameworkAdapters(registry) {
      registry.register({
        id: descriptor.id,
        displayName: manifest.displayName,
        sourceFamily: descriptor.sourceFamily,
        sourceDialects: ["html"],
        fileMatchers: [/\.html$/i],
        capabilities: [...descriptor.capabilities],

        detectEntrypoint(filePath, sourceText, { metadata }) {
          return {
            filePath,
            sourceText,
            rootLocator: metadata.rootLocator
          };
        },

        parseSource(entrypoint, sourceText, parseContext) {
          return {
            graph: {
              adapter: parseContext.metadata.adapter,
              frameworkAdapterId: parseContext.metadata.frameworkAdapterId,
              frameworkId: parseContext.metadata.frameworkId,
              sourceFamily: parseContext.metadata.sourceFamily,
              bindingId: parseContext.bindingId,
              repoPath: parseContext.metadata.repoPath,
              rootKey: "root",
              nodes: {
                root: {
                  key: "root",
                  kind: "element",
                  bindingId: parseContext.bindingId,
                  locator: {
                    sourcePath: entrypoint.filePath,
                    astPath: "root",
                    sourceSpan: createSourceSpan(sourceText)
                  },
                  tagName: "main",
                  attributes: {},
                  style: {},
                  preservedAttributes: [],
                  childKeys: []
                }
              },
              sourceHash: `validation-fixture:${sourceText.length}`,
              unsupportedFragments: [],
              libraryAdapterIds: [],
              declaredCapabilities: [...parseContext.metadata.declaredCapabilities],
              grantedCapabilities: parseContext.metadata.grantedCapabilities.map((entry) => ({ ...entry }))
            },
            rootLocator: parseContext.metadata.rootLocator,
            imports: [],
            libraryAdapterIds: [],
            feedback: []
          };
        },

        emitSource() {
          return null;
        },

        buildProjectionDescriptor() {
          return {
            frameworkId: "html",
            adapterId: descriptor.id,
            sourceFamily: descriptor.sourceFamily,
            attributes: {
              "data-framework-id": "html",
              "data-framework-adapter": descriptor.id
            },
            metadata: {
              pluginId: manifest.pluginId
            }
          };
        },

        readTokenRefs() {
          return {};
        },

        emitTokenRefs() {
          return {};
        },

        emitThemeBindings() {
          return {};
        },

        resolveLibraryAdapters() {
          return [];
        },

        fallbackReason() {
          return null;
        }
      });
    },

    async registerLibraryAdapters() {},

    async onBind() {},

    async onUnbind() {},

    async dispose() {}
  };
}
