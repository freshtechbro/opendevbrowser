import { readDaemonMetadata } from "./daemon";
import { CliError, createDisconnectedError, EXIT_EXECUTION } from "./errors";

export async function callDaemon(command: string, params?: Record<string, unknown>): Promise<unknown> {
  const metadata = readDaemonMetadata();
  if (!metadata) {
    throw createDisconnectedError("Daemon not running. Start with `opendevbrowser serve`.");
  }

  let response: Response;
  try {
    response = await fetch(`http://127.0.0.1:${metadata.port}/command`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${metadata.token}`
      },
      body: JSON.stringify({ name: command, params: params ?? {} })
    });
  } catch {
    throw createDisconnectedError("Daemon not running. Start with `opendevbrowser serve`.");
  }

  if (!response.ok) {
    const message = await response.text();
    throw new CliError(`Daemon error: ${message || response.status}`, EXIT_EXECUTION);
  }

  const payload = await response.json() as { ok?: boolean; data?: unknown; error?: string };
  if (!payload.ok) {
    throw new CliError(payload.error || "Daemon command failed.", EXIT_EXECUTION);
  }
  return payload.data;
}
