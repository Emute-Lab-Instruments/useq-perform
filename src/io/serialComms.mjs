/**
 * Serial Communication Module
 * 
 * Handles communication with the uSEQ device via Web Serial API
 * including message parsing, sending commands, and managing the serial buffer.
 */
import { CircularBuffer } from "../utils/CircularBuffer.mjs";
import { Buffer } from 'buffer';
import { post } from './console.mjs';
import { upgradeCheck } from '../utils/upgradeCheck.mjs';

// Define variables first before exporting them
var serialport = null;
var serialVars = { capture: false, captureFunc: null };
const encoder = new TextEncoder();
const serialBuffers = Array.from({ length: 8 }, () => new CircularBuffer(100));
const serialMapFunctions = [];

// Export everything at once to avoid duplication
export { 
  serialport, 
  serialVars, 
  encoder, 
  serialBuffers, 
  serialMapFunctions, 
  setSerialPort, 
  getSerialPort, 
  sendTouSEQ, 
  serialReader,
  connectToSerialPort 
};

// Constants
const SERIAL_READ_MODES = {
  ANY: 0,
  TEXT: 1,
  SERIALSTREAM: 2
};

const MESSAGE_START_MARKER = 31;
const MESSAGE_TYPES = {
  STREAM: 0,
  // Any value other than 0 is treated as TEXT
};

// Console output storage
const consoleLines = [];
const MAX_CONSOLE_LINES = 50;

/**
 * Set the active serial port
 * @param {SerialPort} newport - The Web Serial port to use
 */
function setSerialPort(newport) {
  serialport = newport;
}

/**
 * Get the current serial port
 * @returns {SerialPort|null} The current Web Serial port or null
 */
function getSerialPort() {
  return serialport;
}

/**
 * Send code to the uSEQ device
 * @param {string} code - Code to send
 * @param {Function|null} capture - Optional callback for response capture
 */
function sendTouSEQ(code, capture = null) {
  // Remove comments (anything between ; and newline) and all newlines in a single step
  code = code.replace(/;[^\n]*(\n|$)|\n/g, match => match.startsWith(';') ? '' : '');

  if (serialport && serialport.writable) {
    const writer = serialport.writable.getWriter();
    console.log("writing...");
    
    if (capture) {
      serialVars.capture = true;
      serialVars.captureFunc = capture;
    }
    
    writer.write(encoder.encode(code)).then(() => {
      writer.releaseLock();
      console.log("written");
    });
  } else {
    post("uSEQ not connected");
    // Add attention-grabbing animation to connect button
    $("#btnConnect")
      .animate({ scale: 1.2 }, 200)
      .animate({ scale: 1 }, 200)
      .animate({ rotate: '-3deg' }, 100)
      .animate({ rotate: '3deg' }, 100)
      .animate({ rotate: '0deg' }, 100);
  }
}

/**
 * Process data received from serial port
 * @param {Uint8Array} byteArray - The bytes to process
 * @param {Object} state - Current processing state
 * @returns {Object} Updated processing state
 */
function processSerialData(byteArray, state) {
  let { mode, processed, remainingBytes } = state;
  
  switch (mode) {
    case SERIAL_READ_MODES.ANY:
      if (byteArray[0] === MESSAGE_START_MARKER) {
        if (byteArray.length > 1) {
          // Check message type
          mode = byteArray[1] === MESSAGE_TYPES.STREAM 
            ? SERIAL_READ_MODES.SERIALSTREAM 
            : SERIAL_READ_MODES.TEXT;
        } else {
          // Not enough data yet, wait for more
          processed = true;
        }
      } else {
        // No marker, search for message start
        const startIndex = byteArray.findIndex((byte, i) => 
          i < byteArray.length - 1 && byte === MESSAGE_START_MARKER);
          
        if (startIndex >= 0) {
          // Found message start, keep from here onwards
          remainingBytes = byteArray.slice(startIndex);
        } else {
          // Nothing useful, discard everything
          remainingBytes = new Uint8Array(0);
        }
        processed = true;
      }
      break;
      
    case SERIAL_READ_MODES.TEXT:
      // Find end of line (CR+LF)
      for (let i = 2; i < byteArray.length - 1; i++) {
        if (byteArray[i] === 13 && byteArray[i + 1] === 10) {
          // Extract message text
          const msg = new TextDecoder().decode(byteArray.slice(2, i));
          console.log(msg);
          
          if (serialVars.capture) {
            console.log("captured");
            serialVars.captureFunc(msg);
            serialVars.capture = false;
          } else if (msg !== "") {
            post("uSEQ: " + msg);
          }
          
          // Move to next bytes and reset mode
          remainingBytes = byteArray.slice(i + 2);
          mode = SERIAL_READ_MODES.ANY;
          return { mode, processed: false, remainingBytes };
        }
      }
      processed = true;
      break;
      
    case SERIAL_READ_MODES.SERIALSTREAM:
      if (byteArray.length < 11) {
        // Not enough data yet
        processed = true;
      } else {
        // Read channel and value
        const channel = byteArray[2];
        const buf = Buffer.from(byteArray);
        const val = buf.readDoubleLE(3);
        
        // Store value in circular buffer for that channel
        const bufferIndex = channel - 1;
        if (bufferIndex >= 0 && bufferIndex < serialBuffers.length) {
          serialBuffers[bufferIndex].push(val);
          
          // Call any registered handler function
          if (serialMapFunctions[bufferIndex]) {
            serialMapFunctions[bufferIndex](serialBuffers[bufferIndex]);
          }
        }
        
        // Move to next data
        remainingBytes = byteArray.slice(11);
        mode = SERIAL_READ_MODES.ANY;
        return { mode, processed: false, remainingBytes };
      }
      break;
  }
  
  return { mode, processed, remainingBytes };
}

/**
 * Start reading from the serial port
 */
async function serialReader() {
  if (!serialport) return;
  console.log("reading...");
  
  let buffer = new Uint8Array(0);
  
  // Check if port is readable and not locked
  if (serialport.readable && !serialport.readable.locked) {
    const reader = serialport.readable.getReader();
    
    try {
      while (true) {
        const { value, done } = await reader.read();
        
        if (done) {
          // Reader has been canceled
          break;
        }
        
        let byteArray = new Uint8Array(value.buffer);
        
        // If there's unconsumed data from the last read, prepend to new data
        if (buffer.length > 0) {
          let newBuffer = new Uint8Array(buffer.length + byteArray.length);
          newBuffer.set(buffer);
          newBuffer.set(byteArray, buffer.length);
          byteArray = newBuffer;
        }
        
        // Process all complete messages in the byte array
        let state = { 
          mode: SERIAL_READ_MODES.ANY, 
          processed: false, 
          remainingBytes: byteArray 
        };
        
        while (state.remainingBytes.length > 0 && !state.processed) {
          state = processSerialData(state.remainingBytes, state);
        }
        
        // Save any remaining bytes for the next read
        buffer = state.remainingBytes;
      }
    } catch (error) {
      console.log("Serial read error:", error);
    } finally {
      reader.releaseLock();
    }
  } else {
    console.log("Serial port is not readable or is locked");
  }
}

/**
 * Connect to the serial port for uSEQ communication
 */
function connectToSerialPort(port) {
  port.open({ baudRate: 115200 }).then(() => {
    setSerialPort(port);
    serialReader();
    $("#btnConnect").hide(1000);
    console.log("checking version");
    sendTouSEQ("@(useq-report-firmware-info)", upgradeCheck);
  }).catch((err) => {
    console.log(err);
    //connection failed
    post("Connection failed. See <a href=\"https://www.emutelabinstruments.co.uk/useqinfo/useq-editor/#troubleshooting\">https://www.emutelabinstruments.co.uk/useqinfo/useq-editor/#troubleshooting</a>");
  });
}

export function checkForWebserialSupport() {
  console.log("Checking for Web Serial API support...");
  // Check for Web Serial API support
  if (!navigator.serial) {
    post("A Web Serial compatible browser such as Chrome, Edge or Opera is required, for connection to the uSEQ module");
    post("See https://caniuse.com/web-serial for more information");
    return false;
  } else {
    console.log("Web Serial API supported");
    // Set up serial connection event listeners
    navigator.serial.addEventListener('connect', e => {
      console.log(e);
      let port = getSerialPort();
      if (port) {
        post("uSEQ plugged in, use the connect button to re-connect");
      }
    });
    
    navigator.serial.addEventListener('disconnect', e => {
      $("#button-connect").show(1000);
      post("uSEQ disconnected");
    });
    return true;
  }
}