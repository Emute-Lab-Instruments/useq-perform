/**
 * Re-export from canonical location.
 * Legacy code should migrate to import from src/transport/serial-utils.ts directly.
 */
export {
  setCodeHighlightColor,
  cleanCode,
  combineBuffers,
  findMessageStartMarker,
  updateRemainingBytes,
  extractMessageText,
  isSerialPortValid,
  isPortReadableAndUnlocked,
  isPortWritable,
  smoothingSettings,
  createPreviousValuesArray,
  applySmoothing,
  applyInterpolation,
} from "../../transport/serial-utils.ts";
export type { SmoothingConfig, PushableBuffer } from "../../transport/serial-utils.ts";
