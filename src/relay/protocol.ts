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

export type RelayHandshakeAck = {
  type: "handshakeAck";
  payload: {
    instanceId: string;
    relayPort: number;
    pairingRequired: boolean;
  };
};

export type RelayHttpStatus = {
  instanceId: string;
  running: boolean;
  port?: number;
  extensionConnected: boolean;
  extensionHandshakeComplete: boolean;
  cdpConnected: boolean;
  pairingRequired: boolean;
};

export type RelayHttpConfig = {
  relayPort: number;
  pairingRequired: boolean;
  instanceId: string;
  discoveryPort: number | null;
};

export type RelayHttpPair = {
  token: string | null;
  instanceId: string;
};
