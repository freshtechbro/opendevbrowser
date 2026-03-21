import * as ts from "typescript";
import { hashCodeSyncValue } from "./hash";
import type {
  CanvasCodeSyncBindingMetadata,
  CodeSyncGraph,
  CodeSyncNode,
  CodeSyncRootLocator,
  CodeSyncSourceLocator,
  CodeSyncUnsupportedFragment
} from "./types";
import { normalizeCodeSyncBindingMetadata } from "./types";

type ParsedTsxBinding = {
  graph: CodeSyncGraph;
  rootLocator: CodeSyncRootLocator;
};

type BoundJsxRoot = {
  jsx: ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment;
  rootLocator: CodeSyncRootLocator;
  astPath: string;
};

type BuildState = {
  sourceFile: ts.SourceFile;
  sourceText: string;
  repoPath: string;
  bindingId: string;
  nodes: Record<string, CodeSyncNode>;
  unsupportedFragments: CodeSyncUnsupportedFragment[];
};

const isIntrinsicTag = (tagName: ts.JsxTagNameExpression): tagName is ts.Identifier => {
  if (!ts.isIdentifier(tagName)) {
    return false;
  }
  return tagName.text === tagName.text.toLowerCase();
};

const selectedLiteralAttribute = (name: string): boolean => ![
  "className",
  "style",
  "data-node-id",
  "data-binding-id"
].includes(name);

function createLocator(sourceFile: ts.SourceFile, repoPath: string, astPath: string, node: ts.Node): CodeSyncSourceLocator {
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
  return {
    sourcePath: repoPath,
    astPath,
    sourceSpan: {
      start: {
        offset: node.getStart(sourceFile),
        line: start.line + 1,
        column: start.character + 1
      },
      end: {
        offset: node.getEnd(),
        line: end.line + 1,
        column: end.character + 1
      }
    }
  };
}

function readLiteralExpression(expression: ts.Expression): string | number | null {
  if (ts.isStringLiteralLike(expression)) {
    return expression.text;
  }
  if (ts.isNumericLiteral(expression)) {
    return Number(expression.text);
  }
  if (expression.kind === ts.SyntaxKind.TrueKeyword) {
    return "true";
  }
  if (expression.kind === ts.SyntaxKind.FalseKeyword) {
    return "false";
  }
  return null;
}

function readStyleObject(expression: ts.Expression): Record<string, string | number> | null {
  if (!ts.isObjectLiteralExpression(expression)) {
    return null;
  }
  const style: Record<string, string | number> = {};
  for (const property of expression.properties) {
    if (!ts.isPropertyAssignment(property)) {
      return null;
    }
    const key = ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name)
      ? property.name.text
      : null;
    if (!key) {
      return null;
    }
    const value = readLiteralExpression(property.initializer);
    if (value === null) {
      return null;
    }
    style[key] = value;
  }
  return style;
}

function pushUnsupported(state: BuildState, reason: string, raw: string, locator?: CodeSyncSourceLocator): void {
  state.unsupportedFragments.push({
    key: `${reason}:${state.unsupportedFragments.length + 1}`,
    reason,
    raw,
    locator
  });
}

function buildUnsupportedNode(state: BuildState, astPath: string, node: ts.Node, reason: string): CodeSyncNode {
  const locator = createLocator(state.sourceFile, state.repoPath, astPath, node);
  const key = astPath;
  const raw = node.getText(state.sourceFile);
  pushUnsupported(state, reason, raw, locator);
  return {
    key,
    kind: "unsupported",
    bindingId: state.bindingId,
    locator,
    attributes: {},
    style: {},
    preservedAttributes: [],
    childKeys: [],
    raw,
    unsupportedReason: reason
  };
}

function buildTextNode(state: BuildState, astPath: string, node: ts.JsxText | ts.JsxExpression): CodeSyncNode | null {
  let text: string | null = null;
  if (ts.isJsxText(node)) {
    text = node.getText(state.sourceFile).replace(/\s+/g, " ").trim();
  } else if (node.expression) {
    const literal = readLiteralExpression(node.expression);
    if (literal !== null) {
      text = String(literal);
    }
  }
  if (!text) {
    return null;
  }
  const locator = createLocator(state.sourceFile, state.repoPath, astPath, node);
  return {
    key: astPath,
    kind: "text",
    bindingId: state.bindingId,
    locator,
    text,
    attributes: {},
    style: {},
    preservedAttributes: [],
    childKeys: []
  };
}

function walkJsx(state: BuildState, astPath: string, node: ts.JsxChild | ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment): CodeSyncNode {
  if (ts.isJsxText(node) || ts.isJsxExpression(node)) {
    const textNode = buildTextNode(state, astPath, node);
    if (textNode) {
      state.nodes[textNode.key] = textNode;
      return textNode;
    }
    const unsupported = buildUnsupportedNode(state, astPath, node, "unsupported_jsx_expression");
    state.nodes[unsupported.key] = unsupported;
    return unsupported;
  }

  if (ts.isJsxFragment(node)) {
    const locator = createLocator(state.sourceFile, state.repoPath, astPath, node);
    const fragmentNode: CodeSyncNode = {
      key: astPath,
      kind: "element",
      bindingId: state.bindingId,
      locator,
      tagName: "fragment",
      attributes: {},
      style: {},
      preservedAttributes: [],
      childKeys: []
    };
    node.children.forEach((child, index) => {
      const childNode = walkJsx(state, `${astPath}.child.${index}`, child);
      fragmentNode.childKeys.push(childNode.key);
    });
    state.nodes[fragmentNode.key] = fragmentNode;
    return fragmentNode;
  }

  const opening = ts.isJsxElement(node) ? node.openingElement : node;
  if (!isIntrinsicTag(opening.tagName)) {
    const unsupported = buildUnsupportedNode(state, astPath, node, "unsupported_component_tag");
    state.nodes[unsupported.key] = unsupported;
    return unsupported;
  }

  const locator = createLocator(state.sourceFile, state.repoPath, astPath, node);
  const elementNode: CodeSyncNode = {
    key: astPath,
    kind: "element",
    bindingId: state.bindingId,
    locator,
    tagName: opening.tagName.text,
    attributes: {},
    style: {},
    preservedAttributes: [],
    childKeys: []
  };

  for (const attribute of opening.attributes.properties) {
    if (ts.isJsxSpreadAttribute(attribute)) {
      elementNode.preservedAttributes.push(attribute.getText(state.sourceFile));
      continue;
    }
    const attributeName = ts.isIdentifier(attribute.name) || ts.isStringLiteral(attribute.name)
      ? attribute.name.text
      : attribute.name.getText(state.sourceFile);
    if (!attribute.initializer) {
      if (selectedLiteralAttribute(attributeName)) {
        elementNode.attributes[attributeName] = "true";
      } else {
        elementNode.preservedAttributes.push(attribute.getText(state.sourceFile));
      }
      continue;
    }
    if (ts.isStringLiteral(attribute.initializer)) {
      if (attributeName === "className") {
        elementNode.attributes.className = attribute.initializer.text;
      } else if (selectedLiteralAttribute(attributeName)) {
        elementNode.attributes[attributeName] = attribute.initializer.text;
      } else {
        elementNode.preservedAttributes.push(attribute.getText(state.sourceFile));
      }
      continue;
    }
    if (!ts.isJsxExpression(attribute.initializer) || !attribute.initializer.expression) {
      elementNode.preservedAttributes.push(attribute.getText(state.sourceFile));
      continue;
    }
    if (attributeName === "style") {
      const style = readStyleObject(attribute.initializer.expression);
      if (style) {
        elementNode.style = style;
        continue;
      }
    }
    const literal = readLiteralExpression(attribute.initializer.expression);
    if (literal !== null && selectedLiteralAttribute(attributeName)) {
      elementNode.attributes[attributeName] = String(literal);
      continue;
    }
    elementNode.preservedAttributes.push(attribute.getText(state.sourceFile));
  }

  if (ts.isJsxElement(node)) {
    node.children.forEach((child, index) => {
      if (ts.isJsxText(child) && child.getText(state.sourceFile).trim().length === 0) {
        return;
      }
      const childNode = walkJsx(state, `${astPath}.child.${index}`, child);
      elementNode.childKeys.push(childNode.key);
    });
  }

  state.nodes[elementNode.key] = elementNode;
  return elementNode;
}

function findBoundJsxRoot(sourceFile: ts.SourceFile, sourceText: string, metadata: CanvasCodeSyncBindingMetadata): BoundJsxRoot {
  if (!metadata.exportName) {
    throw new Error("React TSX bindings require codeSync.exportName.");
  }
  const exportName = metadata.exportName;
  const statements = sourceFile.statements;
  for (const statement of statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === exportName) {
      const jsx = readReturnedJsx(statement.body);
      if (jsx) {
        return { jsx, rootLocator: { kind: "react-export", exportName }, astPath: `export:${exportName}` };
      }
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || declaration.name.text !== exportName || !declaration.initializer) {
          continue;
        }
        const jsx = readReturnedJsxFromExpression(declaration.initializer);
        if (jsx) {
          return { jsx, rootLocator: { kind: "react-export", exportName }, astPath: `export:${exportName}` };
        }
      }
    }
    if (ts.isExportAssignment(statement)) {
      const jsx = readReturnedJsxFromExpression(statement.expression);
      if (jsx && exportName === "default") {
        return { jsx, rootLocator: { kind: "react-export", exportName }, astPath: "export:default" };
      }
    }
  }
  throw new Error(`Unable to locate TSX export root: ${exportName}`);
}

function readReturnedJsx(body: ts.Block | undefined): ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment | null {
  if (!body) {
    return null;
  }
  for (const statement of body.statements) {
    if (!ts.isReturnStatement(statement) || !statement.expression) {
      continue;
    }
    if (ts.isJsxElement(statement.expression) || ts.isJsxSelfClosingElement(statement.expression) || ts.isJsxFragment(statement.expression)) {
      return statement.expression;
    }
  }
  return null;
}

function readReturnedJsxFromExpression(
  expression: ts.Expression
): ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment | null {
  if (ts.isParenthesizedExpression(expression)) {
    return readReturnedJsxFromExpression(expression.expression);
  }
  if (ts.isJsxElement(expression) || ts.isJsxSelfClosingElement(expression) || ts.isJsxFragment(expression)) {
    return expression;
  }
  if (ts.isArrowFunction(expression)) {
    if (ts.isBlock(expression.body)) {
      return readReturnedJsx(expression.body);
    }
    return readReturnedJsxFromExpression(expression.body);
  }
  if (ts.isFunctionExpression(expression)) {
    return readReturnedJsx(expression.body);
  }
  return null;
}

export function parseTsxCodeSyncBinding(
  sourceText: string,
  repoPath: string,
  bindingId: string,
  metadata: CanvasCodeSyncBindingMetadata
): ParsedTsxBinding {
  const normalizedMetadata = normalizeCodeSyncBindingMetadata(metadata);
  const sourceFile = ts.createSourceFile(repoPath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const diagnostics = (sourceFile as ts.SourceFile & { parseDiagnostics: readonly ts.DiagnosticWithLocation[] }).parseDiagnostics
    .filter((diagnostic: ts.DiagnosticWithLocation) => diagnostic.category === ts.DiagnosticCategory.Error);
  if (diagnostics.length > 0) {
    const message = ts.flattenDiagnosticMessageText(diagnostics[0]!.messageText, "\n");
    throw new Error(`TSX parse failed: ${message}`);
  }
  const boundRoot = findBoundJsxRoot(sourceFile, sourceText, normalizedMetadata);
  const state: BuildState = {
    sourceFile,
    sourceText,
    repoPath,
    bindingId,
    nodes: {},
    unsupportedFragments: []
  };
  const rootNode = walkJsx(state, boundRoot.astPath, boundRoot.jsx);
  return {
    graph: {
      adapter: normalizedMetadata.adapter,
      frameworkAdapterId: normalizedMetadata.frameworkAdapterId,
      frameworkId: normalizedMetadata.frameworkId,
      sourceFamily: normalizedMetadata.sourceFamily,
      bindingId,
      repoPath,
      rootKey: rootNode.key,
      nodes: state.nodes,
      sourceHash: hashCodeSyncValue(sourceText),
      unsupportedFragments: state.unsupportedFragments,
      libraryAdapterIds: [...normalizedMetadata.libraryAdapterIds],
      declaredCapabilities: [...normalizedMetadata.declaredCapabilities],
      grantedCapabilities: normalizedMetadata.grantedCapabilities.map((entry) => ({ ...entry }))
    },
    rootLocator: boundRoot.rootLocator
  };
}
