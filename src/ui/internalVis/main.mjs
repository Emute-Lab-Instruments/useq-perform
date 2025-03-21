function create2DFloatBuffer(numChannels, numSamples) {
    const buffer = new Array(numChannels);
    
    for (let channel = 0; channel < numChannels; channel++) {
        buffer[channel] = new Float32Array(numSamples);
        
        // Calculate frequency for this channel (higher channel = higher frequency)
        const frequency = (channel + 1) * 2; // Hz
        const sampleRate = 250;
        
        for (let sample = 0; sample < numSamples; sample++) {
            // Create sine wave: amplitude * sin(2π * frequency * time)
            const time = sample / sampleRate;
            buffer[channel][sample] = Math.sin(2 * Math.PI * frequency * time);
        }
    }
    
    return buffer;
}

const numChannels = 8;
const numSamples = 2048;
export let activeBuffer = create2DFloatBuffer(numChannels, numSamples);
export let swapBuffer = create2DFloatBuffer(numChannels, numSamples);


const plotCanvas = document.getElementById('canvas-plot');
const lineCanvas = document.getElementById('canvas-timeline');

export const plotCtx = plotCanvas.getContext('2d');
export const lineCtx = lineCanvas.getContext('2d');