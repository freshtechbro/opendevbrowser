export type ConnectionStatus = "connected" | "disconnected";

export type PopupMessage =
  | { type: "connect" }
  | { type: "disconnect" }
  | { type: "status" };

export type BackgroundMessage = {
  type: "status";
  status: ConnectionStatus;
};

export type RelayCommand = {
  id: string | number;
  method: "forwardCDPCommand";
  params: {
    method: string;
    params?: unknown;
    sessionId?: string;
  };
};

export type RelayEvent = {
  method: "forwardCDPEvent";
  params: {
    method: string;
    params?: unknown;
    sessionId?: string;
  };
};

export type RelayResponse = {
  id: string | number;
  result?: unknown;
  error?: { message: string };
  sessionId?: string;
};

export type RelayHandshake = {
  type: "handshake";
  payload: {
    tabId: number;
    url?: string;
    title?: string;
    groupId?: number;
    pairingToken?: string;
  };
};
