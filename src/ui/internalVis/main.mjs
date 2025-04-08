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




/// Drawing

let linePosition = 0.0;
let plotNeedsRedrawing = true;



function drawPlot() {
  dbg("Drawing plot");
  
  // Setup
  const ctx = plotCtx;
  const c = ctx.canvas;
  
  // Enable antialiasing
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  
  const amplitudeMultiplier = 0.9;
  const zeroY = c.height / 2;
  const gap = c.width / serialBuffers[0].bufferLength;
  ctx.clearRect(0, 0, c.width, c.height);

  const mapValueToY = (value) =>
    zeroY - (value * amplitudeMultiplier * zeroY);

  // Draw dashed 0-line
  ctx.strokeStyle = "#777777";
  ctx.lineWidth = 0.5;
  ctx.setLineDash([5, 3]);
  ctx.beginPath();
  ctx.moveTo(0, zeroY);
  ctx.lineTo(c.width, zeroY);
  ctx.stroke();

  ctx.setLineDash([]);
  ctx.font = "10px Arial";
  ctx.fillStyle = "#777777";
  ctx.textAlign = "right";

  // Draw quarter amplitude lines & labels
  for (let i = -1; i <= 1; i += 0.25) {
    const y = zeroY - i * amplitudeMultiplier * zeroY;
    ctx.beginPath();
    ctx.moveTo(c.width - 10, y);
    ctx.lineTo(c.width, y);
    ctx.stroke();
    const textY = i > 0 ? y - 4 : i < 0 ? y + 12 : y + 12;
    ctx.fillText(i.toFixed(2), c.width - 12, textY);
  }

  ctx.lineWidth = 1;

  // Pre-calculate interpolation steps
  const segments = 5;
  const step = 1 / segments;
  const interpolationSteps = Array.from({ length: segments + 1 }, (_, i) => i * step);

  // Draw all channels
  for (let ch = 0; ch < activeBuffer.length; ch++) {
    const channelValues = activeBuffer[ch];
    
    // Create points array - do this once per channel
    const points = new Array(channelValues.length);
    for (let i = 0; i < channelValues.length; i++) {
      points[i] = {
        x: gap * i,
        y: mapValueToY(channelValues[i])
      };
    }

    ctx.beginPath();
    // Use theme-aware palette
    ctx.strokeStyle = serialVisPalette[ch];
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // Draw curve with Catmull-Rom interpolation
    ctx.moveTo(points[0].x, points[0].y);
    
    for (let i = 0; i < points.length - 3; i++) {
      const p0 = points[Math.max(0, i)];
      const p1 = points[i + 1];
      const p2 = points[i + 2];
      const p3 = points[Math.min(points.length - 1, i + 3)];

      // Use pre-calculated steps
      for (const t of interpolationSteps) {
        const pt = getCatmullRomPoint(p0, p1, p2, p3, t);
        ctx.lineTo(pt.x, pt.y);
      }
    }
    
    ctx.stroke();
  }
}

let time = 0;

function drawTimeLine() {
  const ctx = lineCtx;
  const c = ctx.canvas;

  const x = c.width * (time/3000.0 % 1.0);

  // Clear the line canvas
  ctx.clearRect(0, 0, c.width, c.height);

  // Set up the line style
  ctx.strokeStyle = "red";
  ctx.lineWidth = 2;

  // Draw the vertical line
  ctx.beginPath();
  ctx.moveTo(x, 0);
  ctx.lineTo(x, c.height);
  ctx.stroke();

  // FIXME
}

export function drawSerialVisInternal() {
  // FIXME get time from module every now and then
  time = Date.now();

  if (plotNeedsRedrawing) {
    drawPlot();
    plotNeedsRedrawing = false;
  }

  drawTimeLine();

  window.requestAnimationFrame(drawSerialVis);
}
