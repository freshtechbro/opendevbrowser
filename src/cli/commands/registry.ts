import type { CommandDefinition } from "./types";

const registry = new Map<string, CommandDefinition>();

export function registerCommand(definition: CommandDefinition): void {
  registry.set(definition.name, definition);
}

export function getCommand(name: string): CommandDefinition | undefined {
  return registry.get(name);
}

export function listCommands(): CommandDefinition[] {
  return Array.from(registry.values());
}
