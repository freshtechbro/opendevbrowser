import { ConnectionManager } from "./services/ConnectionManager";
import type { BackgroundMessage, PopupMessage } from "./types";

const connection = new ConnectionManager();

chrome.runtime.onMessage.addListener((message: PopupMessage, _sender, sendResponse) => {
  const respond = (status: BackgroundMessage) => {
    sendResponse(status);
  };

  if (message.type === "status") {
    respond({ type: "status", status: connection.getStatus() });
    return true;
  }

  if (message.type === "connect") {
    (async () => {
      await connection.connect();
      respond({ type: "status", status: connection.getStatus() });
    })().catch(() => {
      connection.disconnect();
      respond({ type: "status", status: connection.getStatus() });
    });
    return true;
  }

  if (message.type === "disconnect") {
    (async () => {
      await connection.disconnect();
      respond({ type: "status", status: connection.getStatus() });
    })().catch(() => {
      connection.disconnect();
      respond({ type: "status", status: connection.getStatus() });
    });
    return true;
  }

  return false;
});
