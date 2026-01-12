import type { CommandResult } from "./commands/types";

export const EXIT_SUCCESS = 0;
export const EXIT_USAGE = 1;
export const EXIT_EXECUTION = 2;
export const EXIT_DISCONNECTED = 10;

export class CliError extends Error {
  exitCode: number;

  constructor(message: string, exitCode: number) {
    super(message);
    this.exitCode = exitCode;
  }
}

export function createUsageError(message: string): CliError {
  return new CliError(message, EXIT_USAGE);
}

export function createDisconnectedError(message: string): CliError {
  return new CliError(message, EXIT_DISCONNECTED);
}

export function toCliError(error: unknown, fallbackExitCode = EXIT_EXECUTION): CliError {
  if (error instanceof CliError) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  return new CliError(message, fallbackExitCode);
}

export type ErrorPayload = {
  success: false;
  error: string;
  exitCode: number;
};

export function formatErrorPayload(error: CliError): ErrorPayload {
  return {
    success: false,
    error: error.message,
    exitCode: error.exitCode
  };
}

export function resolveExitCode(result: CommandResult): number | null {
  if (result.exitCode === null) {
    return null;
  }
  if (typeof result.exitCode === "number") {
    return result.exitCode;
  }
  return result.success ? EXIT_SUCCESS : EXIT_EXECUTION;
}
