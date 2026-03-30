import { afterEach, describe, expect, it } from "vitest";
import {
  createPopupFixtureServer,
  parseArgs
} from "../scripts/popup-fixture-server.mjs";

let activeServer: ReturnType<typeof createPopupFixtureServer> | null = null;

async function startServer(port = 0) {
  const server = createPopupFixtureServer({ host: "127.0.0.1", port });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });
  activeServer = server;
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Fixture server did not expose a TCP address.");
  }
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  if (!activeServer) return;
  const server = activeServer;
  activeServer = null;
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
});

describe("popup-fixture-server script", () => {
  it("parses defaults for the original popup host", () => {
    expect(parseArgs([])).toEqual({
      host: "127.0.0.1",
      port: 8124,
      outputFormat: "text",
      quiet: false
    });
  });

  it("serves the original popup root and child paths", async () => {
    const baseUrl = await startServer();
    const rootResponse = await fetch(`${baseUrl}/popup-root-anchor.html`);
    const childResponse = await fetch(`${baseUrl}/popup-child.html`);
    const rootBody = await rootResponse.text();
    const childBody = await childResponse.text();

    expect(rootResponse.status).toBe(200);
    expect(rootBody).toContain("Open Popup Window");
    expect(rootBody).toContain("/popup-frame.html");

    expect(childResponse.status).toBe(200);
    expect(childBody).toContain("Close Popup Window");
  });

  it("redirects the root path to popup-root-anchor.html", async () => {
    const baseUrl = await startServer();
    const response = await fetch(baseUrl, { redirect: "manual" });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/popup-root-anchor.html");
  });

  it("supports HEAD checks on the original popup root path", async () => {
    const baseUrl = await startServer();
    const response = await fetch(`${baseUrl}/popup-root-anchor.html`, { method: "HEAD" });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toBe("");
  });
});
