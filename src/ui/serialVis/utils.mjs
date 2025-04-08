import { serialBuffers, serialMapFunctions } from "../../io/serialComms.mjs";
import { dbg } from "../../utils.mjs";

/**
 * Generates a sine wave data point at a specific time
 * @param {number} frequency - The frequency of the sine wave in Hz
 * @param {number} time - The time in seconds
 * @param {number} amplitude - The amplitude of the sine wave (default: 1.0)
 * @param {number} phase - The phase offset in radians (default: 0)
 * @returns {number} The sine wave value at the given time
 */
function sineWaveAt(frequency, time, amplitude = 1.0, phase = 0) {
  return amplitude * Math.sin(2 * Math.PI * frequency * time + phase);
}

/**
 * Creates sine wave data for a buffer
 * @param {number} frequency - The frequency of the sine wave in Hz
 * @param {number} duration - Duration in seconds
 * @param {number} sampleRate - Samples per second
 * @param {number} amplitude - The amplitude of the sine wave
 * @param {number} phase - The phase offset in radians
 * @returns {Array<number>} Array of sine wave values
 */
function createSineWaveData(frequency, duration, sampleRate, amplitude = 1.0, phase = 0) {
  const numSamples = Math.floor(duration * sampleRate);
  return Array.from({ length: numSamples }, (_, i) => {
    const time = i / sampleRate;
    return sineWaveAt(frequency, time, amplitude, phase);
  });
}

/**
 * Fills the serial buffers with sine waves of different frequencies for testing purposes
 * @param {number} duration - Duration of test data in seconds (default: 2.0)
 * @param {number} sampleRate - Samples per second (default: 100)
 * @returns {Array<CircularBuffer>} The filled circular buffers
 */
export function fillSerialBuffersDefault(duration = 2.0, sampleRate = 100) {
  // Base frequency and multipliers for each channel (creating harmonic relationships)
  const baseFreq = 0.5; // 0.5 Hz for the first buffer
  const freqMultipliers = [1, 1.5, 2, 2.5, 3, 4, 5, 6];
  
  // Generate different amplitudes for visual distinction
  const amplitudes = [1.0, 0.8, 0.7, 0.9, 0.6, 0.85, 0.75, 0.65];
  
  // Create different phase offsets for each channel
  const phaseOffsets = Array.from({ length: 8 }, (_, i) => i * Math.PI / 4);
  
  // Clear existing buffers and fill with new data
  serialBuffers.forEach((buffer, index) => {
    buffer.clear();
    
    const frequency = baseFreq * freqMultipliers[index];
    const amplitude = amplitudes[index];
    const phase = phaseOffsets[index];
    
    const waveData = createSineWaveData(frequency, duration, sampleRate, amplitude, phase);
    waveData.forEach(value => buffer.push(value));
    
    // Trigger the map function if one is registered
    if (serialMapFunctions[index]) {
      serialMapFunctions[index](buffer);
    }
  });
  
  dbg("Filled serial buffers with test sine waves");
  return serialBuffers;
}