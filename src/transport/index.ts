/**
 * Transport layer barrel re-exports.
 *
 * Consumers should import from here rather than reaching into individual
 * transport modules.
 */

// ── Types ────────────────────────────────────────────────────────────
export type {
  CaptureCallback,
  SerialProcessingState,
  PendingRequest,
  JsonResponse,
  WriteJsonRequestOptions,
  SendJsonEvalOptions,
  ProtocolState,
  SerialVars,
  BufferMapFunction,
} from "./types.ts";

export {
  PROTOCOL_MODES,
  SERIAL_READ_MODES,
  MESSAGE_START_MARKER,
  MESSAGE_TYPES,
  EDITOR_VERSION,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
} from "./types.ts";

// ── Connector (port lifecycle) ───────────────────────────────────────
export {
  toggleConnect,
  askForPortAndConnect,
  setConnectedToModule,
  isConnectedToModule,
  announceRuntimeSession,
  setSerialPort,
  getSerialPort,
  connectToSerialPort,
  disconnect,
  checkForSavedPortAndMaybeConnect,
  checkForWebserialSupport,
  enterBootloaderMode,
} from "./connector.ts";

// ── JSON protocol driver ────────────────────────────────────────────
export {
  getProtocolMode,
  isJsonProtocolActive,
  getIoConfig,
  sendStreamConfig,
  sendSerialInputStreamValue,
  handleJsonMessage,
  handleFirmwareInfo,
  resetProtocolState,
  protocolState,
} from "./json-protocol.ts";

// ── Legacy text protocol driver ─────────────────────────────────────
export { sendTouSEQ } from "./legacy-text-protocol.ts";

// ── Stream parser ───────────────────────────────────────────────────
export {
  serialBuffers,
  serialMapFunctions,
  serialReader,
  readingActive,
  serialOutputBufferRouting,
  setSerialOutputBufferRouting,
} from "./stream-parser.ts";
