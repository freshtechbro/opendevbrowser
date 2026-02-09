export function ensureLocalEndpoint(endpoint: string, allowNonLocal: boolean): void {
  if (allowNonLocal) return;

  const allowedProtocols = new Set(["ws:", "wss:", "http:", "https:"]);
  const localHostnames = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new Error("Invalid CDP endpoint URL.");
  }

  if (!allowedProtocols.has(parsed.protocol)) {
    throw new Error(`Disallowed protocol "${parsed.protocol}" for CDP endpoint. Allowed: ws, wss, http, https.`);
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!localHostnames.has(hostname) && !hostname.startsWith("::ffff:127.")) {
    throw new Error("Non-local CDP endpoints are disabled by default.");
  }
}
