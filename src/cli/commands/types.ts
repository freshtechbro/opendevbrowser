import type { ParsedArgs } from "../args";

export type CommandResult = {
  success: boolean;
  message?: string;
  data?: unknown;
  exitCode?: number | null;
};

export type CommandDefinition = {
  name: string;
  description: string;
  run: (args: ParsedArgs) => Promise<CommandResult> | CommandResult;
};
