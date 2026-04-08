import type { DesktopFailureCode } from "./types";

export class DesktopRuntimeError extends Error {
  readonly code: DesktopFailureCode;

  constructor(code: DesktopFailureCode, message: string) {
    super(message);
    this.name = "DesktopRuntimeError";
    this.code = code;
  }
}

export const isDesktopRuntimeError = (value: unknown): value is DesktopRuntimeError => {
  return value instanceof DesktopRuntimeError;
};

