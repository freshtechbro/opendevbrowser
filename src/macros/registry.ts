import { ProviderRuntimeError } from "../providers/errors";
import type {
  JsonValue,
  ProviderOperation,
  ProviderSelection,
  ProviderSource,
  TraceContext
} from "../providers/types";

export type MacroValue = string | number | boolean;

export interface ParsedMacro {
  name: string;
  positional: MacroValue[];
  named: Record<string, MacroValue>;
  raw: string;
}

export interface MacroAction {
  source: ProviderSelection;
  operation: ProviderOperation;
  input: Record<string, JsonValue>;
}

export interface MacroProvenance {
  macro: string;
  resolvedQuery: string;
  provider: string;
  pack: string;
  args: {
    positional: MacroValue[];
    named: Record<string, MacroValue>;
  };
}

export interface MacroResolution {
  action: MacroAction;
  provenance: MacroProvenance;
}

export interface MacroResolveContext {
  trace?: Partial<TraceContext>;
  preferredSource?: ProviderSource;
}

export interface MacroDefinition {
  name: string;
  pack: string;
  description?: string;
  resolve: (parsed: ParsedMacro, context: MacroResolveContext) => MacroAction | Promise<MacroAction>;
}

const MACRO_NAME_RE = /^@([a-zA-Z][\w.-]*)(?:\((.*)\))?$/s;

const parseValue = (value: string): MacroValue => {
  const trimmed = value.trim();
  if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1).replace(/\\(["'])/g, "$1");
  }

  if (trimmed === "true") return true;
  if (trimmed === "false") return false;

  const asNumber = Number(trimmed);
  if (!Number.isNaN(asNumber) && /^-?\d+(\.\d+)?$/.test(trimmed)) {
    return asNumber;
  }

  return trimmed;
};

const splitArguments = (rawArgs: string): string[] => {
  if (!rawArgs.trim()) return [];

  const chunks: string[] = [];
  let current = "";
  let quote: "\"" | "'" | null = null;
  let escaped = false;

  for (const char of rawArgs) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      current += char;
      escaped = true;
      continue;
    }

    if ((char === "\"" || char === "'") && (quote === null || quote === char)) {
      quote = quote === null ? char : null;
      current += char;
      continue;
    }

    if (char === "," && quote === null) {
      chunks.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  if (quote !== null) {
    throw new ProviderRuntimeError("invalid_input", "Unterminated macro string argument", {
      retryable: false
    });
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }
  return chunks;
};

export const parseMacro = (expression: string): ParsedMacro => {
  const trimmed = expression.trim();

  if (!trimmed.startsWith("@")) {
    throw new ProviderRuntimeError("invalid_input", "Macro expression must start with '@'", {
      retryable: false,
      details: { expression: trimmed }
    });
  }

  const openParen = trimmed.indexOf("(");
  const closeParen = trimmed.lastIndexOf(")");
  if ((openParen >= 0 && closeParen !== trimmed.length - 1) || (openParen === -1 && closeParen >= 0)) {
    throw new ProviderRuntimeError("invalid_input", "Macro expression has unbalanced parentheses", {
      retryable: false,
      details: { expression: trimmed }
    });
  }

  const tokenEnd = openParen >= 0 ? openParen : trimmed.length;
  const token = trimmed.slice(1, tokenEnd).trim();
  if (!token || /\s/.test(token)) {
    throw new ProviderRuntimeError("invalid_input", "Invalid macro token", {
      retryable: false,
      details: { expression: trimmed }
    });
  }

  const match = trimmed.match(MACRO_NAME_RE);
  if (!match) {
    throw new ProviderRuntimeError("invalid_input", "Invalid macro expression", {
      retryable: false,
      details: { expression: trimmed }
    });
  }

  const [, macroName, argsRaw] = match;
  if (!macroName) {
    throw new ProviderRuntimeError("invalid_input", "Invalid macro expression", {
      retryable: false,
      details: { expression: trimmed }
    });
  }

  const pieces = splitArguments(argsRaw ?? "");

  const positional: MacroValue[] = [];
  const named: Record<string, MacroValue> = {};

  for (const piece of pieces) {
    const equalsIndex = findNamedAssignmentIndex(piece);
    if (equalsIndex > 0) {
      const key = piece.slice(0, equalsIndex).trim();
      const rawValue = piece.slice(equalsIndex + 1);
      if (!/^[a-zA-Z][\w-]*$/.test(key)) {
        throw new ProviderRuntimeError("invalid_input", "Invalid macro argument name", {
          retryable: false,
          details: { argument: key }
        });
      }
      named[key] = parseValue(rawValue);
      continue;
    }

    positional.push(parseValue(piece));
  }

  return {
    name: macroName,
    positional,
    named,
    raw: trimmed
  };
};

const findNamedAssignmentIndex = (piece: string): number => {
  let quote: "\"" | "'" | null = null;
  let escaped = false;

  for (let index = 0; index < piece.length; index += 1) {
    const char = piece[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if ((char === "\"" || char === "'") && (quote === null || quote === char)) {
      quote = quote === null ? char : null;
      continue;
    }
    if (char === "=" && quote === null) {
      return index;
    }
  }

  return -1;
};

export class MacroRegistry {
  private readonly definitions = new Map<string, MacroDefinition>();

  register(definition: MacroDefinition): void {
    if (this.definitions.has(definition.name)) {
      throw new Error(`Macro already registered: ${definition.name}`);
    }
    this.definitions.set(definition.name, definition);
  }

  registerMany(definitions: MacroDefinition[]): void {
    for (const definition of definitions) {
      this.register(definition);
    }
  }

  registerPack(definitions: MacroDefinition[]): void {
    this.registerMany(definitions);
  }

  list(): MacroDefinition[] {
    return [...this.definitions.values()].sort((left, right) => left.name.localeCompare(right.name));
  }

  has(name: string): boolean {
    return this.definitions.has(name);
  }

  async resolve(input: string | ParsedMacro, context: MacroResolveContext = {}): Promise<MacroResolution> {
    const parsed = typeof input === "string" ? parseMacro(input) : input;
    const definition = this.definitions.get(parsed.name);
    if (!definition) {
      throw new ProviderRuntimeError("not_supported", `Unknown macro: ${parsed.name}`, {
        retryable: false
      });
    }

    const action = await definition.resolve(parsed, context);
    const resolvedQuery = inferResolvedQuery(action);
    const provider = inferProvider(action, context.preferredSource);

    return {
      action,
      provenance: {
        macro: parsed.name,
        resolvedQuery,
        provider,
        pack: definition.pack,
        args: {
          positional: parsed.positional,
          named: parsed.named
        }
      }
    };
  }
}

const inferResolvedQuery = (action: MacroAction): string => {
  const query = action.input.query;
  if (typeof query === "string" && query.trim()) {
    return query;
  }

  const url = action.input.url;
  if (typeof url === "string" && url.trim()) {
    return url;
  }

  return JSON.stringify(action.input);
};

const inferProvider = (action: MacroAction, preferredSource: ProviderSource | undefined): string => {
  const providerId = action.input.providerId;
  if (typeof providerId === "string" && providerId.trim()) {
    return providerId;
  }

  const platform = action.input.platform;
  if (typeof platform === "string" && platform.trim()) {
    return `social/${platform}`;
  }

  return action.source === "auto" ? preferredSource ?? "web" : action.source;
};
