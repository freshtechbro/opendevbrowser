#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const net = require("net");
const crypto = require("crypto");
const os = require("os");

const IS_WINDOWS = process.platform === "win32";
const DEFAULT_BASE_DIR = IS_WINDOWS ? os.tmpdir() : "/tmp";
const BASE_DIR = process.env.OPD_NATIVE_BASE_DIR || DEFAULT_BASE_DIR;
const MAX_MESSAGE_BYTES = 8 * 1024 * 1024;
const LOG_ROTATE_BYTES = 5 * 1024 * 1024;

const buildPaths = (baseDir, pid) => {
  const socketPath = IS_WINDOWS
    ? `\\\\.\\pipe\\opendevbrowser-${pid}.sock`
    : path.join(baseDir, `opendevbrowser-${pid}.sock`);
  return {
    tokenPath: path.join(baseDir, `opendevbrowser-${pid}.token`),
    socketPath,
    logPath: path.join(baseDir, "opendevbrowser-native.log")
  };
};

const redactLogLine = (line, token) => {
  let output = line;
  if (token) {
    output = output.split(token).join("[redacted]");
  }
  output = output.replace(/Authorization\\s*[:=]\\s*Bearer\\s+[^\\s"\']+/gi, "Authorization: Bearer [redacted]");
  output = output.replace(/\"token\"\\s*:\\s*\"[^\"]+\"/gi, "\"token\":\"[redacted]\"");
  return output;
};

const rotateLogIfNeeded = (logPath) => {
  try {
    const stat = fs.statSync(logPath);
    if (stat.size <= LOG_ROTATE_BYTES) return false;
    const rotated = `${logPath}.1`;
    fs.renameSync(logPath, rotated);
    return true;
  } catch {
    return false;
  }
};

const writeLog = (logPath, message, token) => {
  rotateLogIfNeeded(logPath);
  const line = redactLogLine(message, token);
  fs.appendFileSync(logPath, `${line}\\n`, { encoding: "utf8" });
};

const writeTokenFile = (tokenPath) => {
  const token = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(tokenPath, token, { encoding: "utf8", mode: 0o600 });
  return token;
};

const parseNativeMessages = (buffer) => {
  const messages = [];
  let offset = 0;
  while (buffer.length >= offset + 4) {
    const size = buffer.readUInt32LE(offset);
    if (size > MAX_MESSAGE_BYTES) {
      return { error: new Error("Message exceeds size limit"), remainder: Buffer.alloc(0) };
    }
    if (buffer.length < offset + 4 + size) {
      break;
    }
    const slice = buffer.slice(offset + 4, offset + 4 + size);
    offset += 4 + size;
    try {
      messages.push(JSON.parse(slice.toString("utf8")));
    } catch {
      // Ignore invalid JSON.
    }
  }
  return { messages, remainder: buffer.slice(offset) };
};

const sendNativeMessage = (payload) => {
  const json = JSON.stringify(payload);
  const data = Buffer.from(json, "utf8");
  if (data.length > MAX_MESSAGE_BYTES) {
    return false;
  }
  const header = Buffer.alloc(4);
  header.writeUInt32LE(data.length, 0);
  process.stdout.write(Buffer.concat([header, data]));
  return true;
};

const runHost = () => {
  fs.mkdirSync(BASE_DIR, { recursive: true });
  const { tokenPath, socketPath, logPath } = buildPaths(BASE_DIR, process.pid);
  const token = writeTokenFile(tokenPath);

  let socketClient = null;
  let socketAuthorized = false;
  let socketBuffer = "";

  const cleanup = () => {
    try {
      if (socketClient) {
        socketClient.destroy();
      }
    } catch {}
    if (!IS_WINDOWS) {
      try {
        if (fs.existsSync(socketPath)) {
          fs.unlinkSync(socketPath);
        }
      } catch {}
    }
    try {
      if (fs.existsSync(tokenPath)) {
        fs.unlinkSync(tokenPath);
      }
    } catch {}
  };

  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });
  process.on("exit", () => {
    cleanup();
  });

  const server = net.createServer((socket) => {
    if (socketClient) {
      socketClient.destroy();
    }
    socketClient = socket;
    socketAuthorized = false;
    socketBuffer = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      socketBuffer += chunk;
      const lines = socketBuffer.split("\\n");
      socketBuffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let message = null;
        try {
          message = JSON.parse(trimmed);
        } catch {
          socket.write(JSON.stringify({ type: "error", code: "invalid_json", message: "Invalid JSON" }) + "\\n");
          continue;
        }
        if (!socketAuthorized) {
          if (message?.type === "auth" && message?.token === token) {
            socketAuthorized = true;
            socket.write(JSON.stringify({ type: "auth_ok" }) + "\\n");
            continue;
          }
          socket.write(JSON.stringify({ type: "error", code: "unauthorized", message: "Unauthorized" }) + "\\n");
          socket.destroy();
          return;
        }
        const encoded = Buffer.from(JSON.stringify(message), "utf8");
        if (encoded.length > MAX_MESSAGE_BYTES) {
          socket.write(JSON.stringify({ type: "error", code: "host_message_too_large", message: "Message too large" }) + "\\n");
          continue;
        }
        sendNativeMessage(message);
      }
    });
    socket.on("error", () => {});
    socket.on("close", () => {
      if (socketClient === socket) {
        socketClient = null;
        socketAuthorized = false;
      }
    });
  });

  server.listen(socketPath, () => {
    if (!IS_WINDOWS) {
      try {
        fs.chmodSync(socketPath, 0o600);
      } catch {}
    }
    writeLog(logPath, "Native host ready", token);
  });

  let nativeBuffer = Buffer.alloc(0);
  process.stdin.on("data", (chunk) => {
    nativeBuffer = Buffer.concat([nativeBuffer, chunk]);
    const result = parseNativeMessages(nativeBuffer);
    if (result.error) {
      sendNativeMessage({ type: "error", code: "host_message_too_large", message: result.error.message });
      nativeBuffer = Buffer.alloc(0);
      return;
    }
    nativeBuffer = result.remainder;
    for (const message of result.messages ?? []) {
      if (message?.type === "ping" && typeof message.id === "string") {
        sendNativeMessage({ type: "pong", id: message.id });
        continue;
      }
      if (socketClient && socketAuthorized) {
        const line = JSON.stringify(message);
        socketClient.write(line + "\\n");
      }
    }
  });
};

if (require.main === module) {
  runHost();
}

module.exports = {
  runHost,
  __test__: {
    buildPaths,
    redactLogLine,
    rotateLogIfNeeded,
    writeTokenFile,
    parseNativeMessages
  }
};
