import { serialBuffers } from "../io/serialComms.mjs";
import { toggleAuxPanel } from "./ui.mjs";
import {
  plotCtx,
  lineCtx,
  activeBuffer,
  swapBuffer,
} from "./internalVis/main.mjs";

let linePosition = 0.0;
let plotNeedsRedrawing = true;

// TODO internalVisBuffers

function drawPlot() {
  console.log("Drawing plot");
  const palette = [
    "#00429d",
    "#45a5ad",
    "#ace397",
    "#fcbf5d",
    "#ff809f",
    "#ff005e",
    "#c9004c",
    "#93003a",
  ];
  // Setup
  const ctx = plotCtx;
  const c = ctx.canvas;
  const amplitudeMultiplier = 0.9;
  const zeroY = c.height / 2;
  const gap = c.width / serialBuffers[0].bufferLength;
  ctx.clearRect(0, 0, c.width, c.height);

  const mapValueToY = (value) =>
    zeroY - (value * 2 - 1) * amplitudeMultiplier * zeroY;

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

  //   if ($("#serialvis").is(":visible")) {
  //     $(".header").css("right", "50px");
  //   } else {
  //     $(".header").css("right", "20px");
  //   }

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

  // Draw all channels
  for (let ch = 0; ch < activeBuffer.length; ch++) {
    const channelValues = activeBuffer[ch];
    ctx.beginPath();
    ctx.strokeStyle = palette[ch];
    ctx.moveTo(0, mapValueToY(channelValues[0]));
    for (let i = 1; i < channelValues.length; i++) {
      ctx.lineTo(gap * i, mapValueToY(channelValues[i]));
    }
    ctx.stroke();
  }
}

let time = 0;

function drawTimeLine() {
  const ctx = lineCtx;
  const c = ctx.canvas;

  const x = time % 1.0;

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

export function drawSerialVis() {
  // FIXME get time from module every now and then
  time = Date.now();

  if (plotNeedsRedrawing) {
    drawPlot();
    plotNeedsRedrawing = false;
  }

  drawTimeLine();

  window.requestAnimationFrame(drawSerialVis);
}

export function initVisPanel() {
  console.log("Initializing serial visualization panel");
  // Start animation loop for serial visualization
  window.requestAnimationFrame(drawSerialVis);

  //   // Handle toggling visibility
  //   $("#visButton").on("click", () => {
  //     toggleAuxPanel("#panel-vis");
  //   });

  //   // Handle ESC key to close panel
  //   $(document).on("keydown", (e) => {
  //     if (e.key === "Escape" && $("#serialvis").is(":visible")) {
  //       toggleAuxPanel("#panel-vis");
  //     }
  //   });
}
