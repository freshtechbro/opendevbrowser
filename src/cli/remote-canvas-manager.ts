import type { CanvasManagerLike } from "../browser/canvas-manager";
import { DaemonClient } from "./daemon-client";

export class RemoteCanvasManager implements CanvasManagerLike {
  private client: DaemonClient;

  constructor(client: DaemonClient) {
    this.client = client;
  }

  execute(command: string, params: Record<string, unknown> = {}): Promise<unknown> {
    return this.client.call("canvas.execute", { command, params });
  }
}
