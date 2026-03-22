import type { OutputFormat } from "./args";

export type OutputOptions = {
  format: OutputFormat;
  quiet?: boolean;
};

type ExitProcessLike = Pick<typeof process, "exit" | "exitCode" | "stdout" | "stderr">;

const normalizeExitCode = (code: number | null | undefined): number => {
  return Number.isInteger(code) ? Number(code) : 0;
};

const flushStream = (
  stream: ExitProcessLike["stdout"] | ExitProcessLike["stderr"] | undefined | null
): Promise<void> => {
  return new Promise((resolve) => {
    if (!stream || typeof stream.write !== "function") {
      resolve();
      return;
    }
    try {
      stream.write("", () => resolve());
    } catch {
      resolve();
    }
  });
};

export async function flushOutputAndExit(
  code: number | null | undefined,
  proc: ExitProcessLike = process,
  timeoutMs = 250
): Promise<void> {
  const finalCode = normalizeExitCode(code);
  proc.exitCode = finalCode;

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const timer = setTimeout(finish, Math.max(0, timeoutMs));
    timer.unref?.();
    void Promise.allSettled([flushStream(proc.stdout), flushStream(proc.stderr)]).finally(() => {
      clearTimeout(timer);
      finish();
    });
  });

  proc.exit(finalCode);
}

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
