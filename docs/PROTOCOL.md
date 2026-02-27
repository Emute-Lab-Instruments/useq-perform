# uSEQ Serial Protocol Specification

**Version**: 1.2.0
**Status**: Current
**Sources**: `src/legacy/io/serialComms.ts`, `src-useq/uSEQ/src/utils/serial_message.h`

---

## Overview

uSEQ communicates with editor software over USB CDC serial at 115200 baud. The protocol has two modes:

- **Legacy mode** — plain-text LISP evaluation, used when firmware < 1.2.0 or JSON negotiation fails.
- **JSON mode** — structured request/response with IDs, error propagation, and stream configuration. Available on firmware ≥ 1.2.0.

The mode is negotiated automatically at connect time via the `hello` handshake.

---

## Physical Layer

| Parameter | Value |
|-----------|-------|
| Interface | USB CDC (virtual serial port) |
| Baud rate | 115,200 |
| Data bits | 8 |
| Stop bits | 1 |
| Parity | None |
| Flow control | None |

---

## Wire-Level Framing

### Message Start Marker

All structured messages from the **firmware to the editor** begin with byte `0x1F` (31, ASCII Unit Separator).

```
Byte 0: 0x1F  — message start marker
Byte 1: type  — message type byte (see table below)
Byte 2+: payload
```

### Firmware → Editor Message Types

| Type byte | Decimal | Name | Format |
|-----------|---------|------|--------|
| `0x00` | 0 | `STREAM` | `[0x1F][0x00][channel: u8][value: f64 LE]` — 11 bytes total |
| `0x20` | 32 | `TEXT` | `[0x1F][0x20][text bytes]\r\n` — variable length |
| `0x64` | 100 | `MSG_TO_EDITOR` | `[0x1F][0x64][text bytes]\r\n` — variable length |
| `0x65` | 101 | `JSON` | `[0x1F][0x65][json bytes]\r\n` — variable length |

**Note**: Any byte other than `0x00` (STREAM) or `0x65` (JSON) after the start marker is treated as a TEXT message by the editor.

### STREAM frame layout (11 bytes)

```
[0x1F] [0x00] [channel: u8] [value: 8 bytes, float64 little-endian]
  0       1       2             3..10
```

Channel numbering is 1-based (`[1, NUM_SERIAL_INS]`) to match the firmware `(ssin N)` builtin.

> **Documentation correction**: The firmware user manual (`docs/useq.md`) incorrectly states the stream frame is 10 bytes. The correct frame size is **11 bytes** (1 marker + 1 type + 1 channel + 8 data).

### TEXT / MSG_TO_EDITOR / JSON frame layout

```
[0x1F] [type] [payload bytes] [0x0D 0x0A]
  0       1      2..N-2          N-1, N
```

Terminator is CR+LF (`\r\n`, bytes `13` and `10`).

---

## Editor → Firmware Messages

### 1. LISP Code (plain text, both modes)

Send raw ASCII text ending with `\n`:

```
(a1 0.5)\n
```

- Without `@` prefix: code is scheduled for the next bar boundary.
- With `@` prefix: code executes immediately (bypasses bar scheduler).

```
@(a1 0.5)\n
```

### 2. JSON Requests (JSON mode only, firmware ≥ 1.2.0)

All JSON requests are sent as a single-line JSON object followed by `\n`. Every request must include a `requestId` field; the editor generates these automatically.

```json
{"type":"hello","client":"editor","version":"1.2.0","requestId":"req-1"}\n
```

#### Request types

| `type` | Description |
|--------|-------------|
| `hello` | Protocol negotiation handshake |
| `eval` | Evaluate LISP code |
| `ping` | Keepalive / heartbeat probe |
| `stream-config` | Configure serial stream channels |

### 3. Stream Input (binary, both modes)

Host-to-device serial stream (for `(ssin N)` in firmware):

```
[0x1F] [channel: u8] [value: 8 bytes, float64 little-endian]
  0        1            2..9
```

**Frame size: 10 bytes** — note this is *different* from the device-to-host stream frame (11 bytes), as it has no type byte.

---

## JSON Protocol Mode

### Handshake (hello)

Triggered automatically after connecting when firmware version ≥ 1.2.0.

**Request** (editor → firmware):

```json
{
  "type": "hello",
  "client": "editor",
  "version": "1.2.0",
  "requestId": "req-1"
}
```

**Response** (firmware → editor, success):

```json
{
  "requestId": "req-1",
  "success": true,
  "mode": "json",
  "fw": "1.2.0",
  "config": {
    "inputs": [{"index": 1, "name": "in1"}, ...],
    "outputs": [{"index": 1, "name": "out1"}, ...]
  }
}
```

**Response** (firmware → editor, fallback to legacy):

```json
{
  "requestId": "req-1",
  "success": false,
  "text": "<reason>"
}
```

If `success` is `false` or the response `mode` is not `"json"`, the editor falls back to legacy mode.

### Eval Request

**Request**:

```json
{
  "type": "eval",
  "code": "(a1 0.5)",
  "requestId": "req-2"
}
```

Optional fields:
- `exec`: `"immediate"` — execute immediately (equivalent to `@` prefix in legacy mode).

**Response**:

```json
{
  "requestId": "req-2",
  "success": true,
  "console": "optional console output text",
  "text": "optional plain text result",
  "meta": { }
}
```

The `meta` field, when present, carries transport state updates and is dispatched as a `useq-json-meta` DOM event.

### Ping (heartbeat)

**Request**:

```json
{"type": "ping", "requestId": "req-3"}
```

**Response**:

```json
{"requestId": "req-3", "success": true}
```

The editor sends a ping every **60 seconds** while in JSON mode. If no response arrives within **10 seconds**, the connection is flagged as potentially lost.

### Stream Config

Sent automatically after a successful `hello` response using I/O config from the `hello` response body.

**Request**:

```json
{
  "type": "stream-config",
  "maxRateHz": 30,
  "channels": [
    {"id": 1, "name": "in1", "enabled": true, "maxRateHz": 30},
    {"id": 2, "name": "in2", "enabled": true, "maxRateHz": 30}
  ],
  "requestId": "req-4"
}
```

**Response**:

```json
{"requestId": "req-4", "success": true}
```

---

## Protocol State Machine

```
connect
  └─> sendTouSEQ("@(useq-report-firmware-info)", handleFirmwareInfo)
        └─> firmware replies with version string (TEXT message)
              └─> versionAtLeast(fw, 1.2.0)?
                    yes ──> send hello request (timeout: 5 s)
                              ├─ success=true, mode="json" ──> JSON mode
                              │   └─> send stream-config
                              │   └─> start heartbeat (60 s)
                              └─ failure / timeout ──> legacy mode
                    no  ──> legacy mode
```

---

## Response Field Reference

| Field | Type | Description |
|-------|------|-------------|
| `requestId` | string | Echoed from the request. Used to match responses to pending requests. |
| `success` | boolean | Whether the request succeeded. |
| `type` | string | Response type (e.g., `"response"`). |
| `mode` | string | Protocol mode in use (`"json"` or `"legacy"`). Present in `hello` response. |
| `fw` | string | Firmware version string. Present in `hello` response. |
| `config` | object | I/O configuration. Present in `hello` response when `success` is `true`. |
| `text` | string | Plain-text result or console output. |
| `console` | string | Console output from code evaluation. Preferred over `text` for display. |
| `admin` | string | Administrative message (not displayed by default). |
| `meta` | object | Transport state or other structured metadata. Dispatched as `useq-json-meta` event. |

---

## Connection Management

### Port Persistence

The editor stores `usbVendorId` and `usbProductId` in `localStorage` (`key: "uSEQ-Serial-Port-Info"`) after a successful connection. On the next load, it attempts to reconnect to the matching port automatically.

### Disconnect

On disconnect, all pending JSON requests are rejected with `"Connection reset"`, protocol state is reset to legacy mode, and the heartbeat is stopped.

### Bootloader Mode

The editor can trigger DFU bootloader mode by:
1. Disconnecting the current port.
2. Reopening at 1200 baud.
3. Closing immediately.
4. Waiting 1 s for the device to reappear as a USB mass-storage drive.

---

## Constants Reference

From `src-useq/uSEQ/src/utils/serial_message.h`:

```cpp
namespace SerialMsg {
  constexpr uint8_t message_begin_marker = 31;   // 0x1F
  constexpr uint8_t message_end_marker   = 3;    // 0x03 (unused in practice)
  constexpr char    execute_now_marker   = '@';

  enum serial_message_types {
    STREAM        = 0,
    TEXT          = 32,   // 0x20
    MSG_TO_EDITOR = 100,  // 0x64
    JSON          = 101,  // 0x65
  };
}
```

From `src/legacy/io/serialComms.ts`:

```typescript
const MESSAGE_START_MARKER = 31;       // 0x1F
const MESSAGE_TYPES = { STREAM: 0, JSON: 101 };
const JSON_PROTOCOL_MIN_VERSION = { major: 1, minor: 2, patch: 0 };
const EDITOR_VERSION = '1.2.0';
const HEARTBEAT_INTERVAL_MS = 60000;
const HEARTBEAT_TIMEOUT_MS  = 10000;
```

---

## Known Differences: useqedit vs useq-perform

| Feature | useqedit (deprecated Python) | useq-perform (current) |
|---------|------------------------------|------------------------|
| Transport | pyserial | Web Serial API |
| Protocol modes | Legacy only | Legacy + JSON (auto-negotiated) |
| Version negotiation | None | JSON handshake at fw ≥ 1.2.0 |
| Request tracking | None | Request IDs + Promise-based timeouts |
| Stream input | Send only | Bidirectional |
| Heartbeat | None | 60 s interval, 10 s timeout |
| Port persistence | None | `localStorage` by USB VID/PID |

---

## Known Issues / Errata

1. **Stream frame size mismatch in docs**: `docs/useq.md` (firmware) states the stream frame is "10 bytes". The actual device→host stream frame is **11 bytes**. The host→device stream frame is 10 bytes (no type byte). This should be corrected in `docs/useq.md`.

2. **MSG_TO_EDITOR (0x64)**: Defined in firmware constants and `serial_message.h` but the editor does not distinguish it from TEXT (0x20) — both are handled by the same TEXT branch in `processAnyModeData`. If firmware sends editor-specific messages via this type, they are processed identically to console TEXT.
