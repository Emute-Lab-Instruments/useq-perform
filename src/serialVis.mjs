import { serialBuffers } from "./serialComms.mjs";
import { interfaceStates, panelStates } from "./panelStates.mjs";
export { drawSerialVis };

function drawSerialVis() {
  const palette = ['#00429d', '#45a5ad', '#ace397', '#fcbf5d', '#ff809f', '#ff005e', '#c9004c', '#93003a'];
  const c = document.getElementById("serialcanvas");
  const ctx = c.getContext("2d");
  const amplitudeMultiplier = 0.9;
  const zeroY = c.height / 2;
  const gap = c.width / serialBuffers[0].bufferLength;
  
  // Clear canvas
  ctx.clearRect(0, 0, c.width, c.height);
  
  // Helper function for mapping values to Y coordinates
  const mapValueToY = value => zeroY - ((value * 2 - 1) * amplitudeMultiplier * zeroY);
  
  // Draw 0 axis dotted line
  ctx.strokeStyle = '#777777';
  ctx.lineWidth = 0.5;
  ctx.setLineDash([5, 3]);
  ctx.beginPath();
  ctx.moveTo(0, zeroY);
  ctx.lineTo(c.width, zeroY);
  ctx.stroke();
  
  // Draw y-axis markings on right side
  ctx.setLineDash([]);
  ctx.font = '10px Arial';
  ctx.fillStyle = '#777777';
  ctx.textAlign = 'right';  // Right-align text
  
  // Move header buttons left when visualization panel is active
  if (interfaceStates.serialVisPanelState === panelStates.PANEL) {
    $(".header").css("right", "50px"); // Add space for scale markings
  } else {
    $(".header").css("right", "20px"); // Restore original position
  }
  
  for (let i = -1; i <= 1; i += 0.25) {
    const y = zeroY - (i * amplitudeMultiplier * zeroY);
    ctx.beginPath();
    ctx.moveTo(c.width - 10, y);  // Start from right side
    ctx.lineTo(c.width, y);       // Draw to edge
    ctx.stroke();
    
    // Position text above or below the marking based on which side of x-axis it's on
    const textY = i > 0 ? y - 4 : (i < 0 ? y + 12 : y + 12); // Special case for 0
    ctx.fillText(i.toFixed(2), c.width - 12, textY);
  }
  
  // Draw data traces
  ctx.lineWidth = 1;
  
  // Pre-calculate oldest values once for each channel to avoid repeated method calls
  const oldestValues = Array(8).fill().map((_, ch) => {
    const buffer = serialBuffers[ch];
    return Array(buffer.bufferLength - 1).fill().map((_, i) => buffer.oldest(i));
  });
  
  // Draw each channel
  for (let ch = 0; ch < 8; ch++) {
    const channelValues = oldestValues[ch];
    
    ctx.beginPath();
    ctx.strokeStyle = palette[ch];
    
    // Plot first point
    ctx.moveTo(0, mapValueToY(channelValues[0]));
    
    // Plot remaining points
    for (let i = 1; i < channelValues.length; i++) {
      ctx.lineTo(gap * i, mapValueToY(channelValues[i]));
    }
    
    ctx.stroke();
  }
  
  window.requestAnimationFrame(drawSerialVis);
}
