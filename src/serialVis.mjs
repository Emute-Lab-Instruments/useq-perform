import { serialBuffers } from "./serialComms.mjs";
export { drawSerialVis };

function drawSerialVis() {
  const palette = ['#00429d', '#45a5ad', '#ace397', '#fcbf5d', '#ff809f', '#ff005e', '#c9004c', '#93003a'];
  var c = document.getElementById("serialcanvas");
  var ctx = c.getContext("2d");
  ctx.clearRect(0, 0, c.width, c.height);
  const gap = c.width * 1.0 / serialBuffers[0].bufferLength;
  for (let ch = 0; ch < 8; ch++) {
    ctx.beginPath();
    ctx.moveTo(0, c.height - (c.height * serialBuffers[ch].oldest(0)));
    for (let i = 1; i < serialBuffers[ch].bufferLength - 1; i++) {
      ctx.lineTo(gap * i, c.height - (c.height * serialBuffers[ch].oldest(i)));
    }
    // ctx.closePath();
    ctx.strokeStyle = palette[ch];
    ctx.stroke();
  }
  window.requestAnimationFrame(drawSerialVis);
}
