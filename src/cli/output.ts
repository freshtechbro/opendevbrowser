import type { OutputFormat } from "./args";

export type OutputOptions = {
  format: OutputFormat;
  quiet?: boolean;
};

export function writeOutput(payload: unknown, options: OutputOptions): void {
  if (options.quiet) {
    return;
  }

  if (options.format === "text") {
    if (typeof payload === "string") {
      console.log(payload);
    } else {
      console.log(JSON.stringify(payload, null, 2));
    }
    return;
  }

  if (options.format === "stream-json") {
    if (Array.isArray(payload)) {
      for (const entry of payload) {
        console.log(JSON.stringify(entry));
      }
      return;
    }
  }

  console.log(JSON.stringify(payload));
}
