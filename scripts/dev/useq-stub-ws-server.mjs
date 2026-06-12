#!/usr/bin/env node
/**
 * uSEQ stub WebSocket bridge — the smallest server that makes the editor
 * believe it is talking to real hardware.
 *
 * It speaks just enough of the uSEQ wire protocol (docs/specs/wire-protocol.md)
 * for the handshake + heartbeat to succeed: emits `ready` on connect, answers
 * `hello` with a `mode:json` response, and acks `ping`/`eval`/`stream-config`.
 * There is NO engine behind it — eval replies are echoes. Its only job is to
 * de-risk the transport: prove that a loopback WebSocket, fronted by
 * WebSocketSerialPort + the `?nativeBridge` bootstrap hook, flips the editor
 * to a connected/hardware state over the HTTPS dev origin.
 *
 * Usage:
 *   node scripts/dev/useq-stub-ws-server.mjs [port]   (default 17890)
 * Then load the editor with `?nativeBridge=<port>` (or `?nativeBridge` for the
 * default port).
 *
 * The real replacement for this is the native VCV Rack plugin's bridge thread
 * (bead useq-perform-ezh3).
 */

import { WebSocketServer } from "ws";

const port = Number(process.argv[2] ?? 17890);
const FW_VERSION = "1.2.0";

// v1.0 variant I/O config, advertised as {index,name} arrays (NOT counts).
const HELLO_CONFIG = {
  inputs: [
    { index: 1, name: "ssin1" },
    { index: 2, name: "ssin2" },
  ],
  outputs: [
    { index: 1, name: "time" },
    { index: 2, name: "s1" },
    { index: 3, name: "s2" },
    { index: 4, name: "s3" },
    { index: 5, name: "s4" },
    { index: 6, name: "s5" },
    { index: 7, name: "s6" },
    { index: 8, name: "s7" },
    { index: 9, name: "s8" },
  ],
};

const wss = new WebSocketServer({ host: "127.0.0.1", port });

wss.on("listening", () => {
  console.log(`[useq-stub] listening on ws://127.0.0.1:${port}`);
  console.log(`[useq-stub] load the editor with ?nativeBridge=${port}`);
});

wss.on("connection", (ws, req) => {
  console.log(`[useq-stub] client connected (origin: ${req.headers.origin})`);

  const sendJson = (obj) => ws.send(JSON.stringify(obj) + "\n");

  // Unsolicited ready frame on connect (triggers the editor's retryHelloOnReady).
  sendJson({ type: "ready", version: FW_VERSION });

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString("utf8").trim());
    } catch {
      console.warn("[useq-stub] non-JSON message ignored");
      return;
    }
    const requestId = msg.requestId;
    switch (msg.type) {
      case "hello":
        console.log("[useq-stub] hello ->  responding mode:json");
        sendJson({
          type: "response",
          success: true,
          mode: "json",
          fw: FW_VERSION,
          config: HELLO_CONFIG,
          requestId,
        });
        break;
      case "ping":
        sendJson({ type: "response", success: true, console: "", text: "", meta: null, requestId });
        break;
      case "stream-config":
        sendJson({ type: "response", success: true, requestId });
        break;
      case "set-live-inputs":
        if (requestId) sendJson({ type: "response", success: true, applied: 0, requestId });
        break;
      case "eval":
      default:
        // Echo eval (no engine): report success with the code as text.
        sendJson({
          type: "response",
          success: true,
          text: `stub-eval: ${msg.code ?? ""}`,
          console: "",
          meta: null,
          diagnostics: [],
          requestId,
        });
        break;
    }
  });

  ws.on("close", () => console.log("[useq-stub] client disconnected"));
});

wss.on("error", (err) => {
  console.error("[useq-stub] server error:", err.message);
  process.exit(1);
});
