import { serialBuffers } from "../io/serialComms.mjs";
import { toggleAuxPanel } from './ui.mjs';

export function drawSerialVis() {
    const palette = ["#00429d", "#45a5ad", "#ace397", "#fcbf5d", "#ff809f", "#ff005e", "#c9004c", "#93003a"];
    const c = document.getElementById("serialcanvas");
    const ctx = c.getContext("2d");
    const amplitudeMultiplier = 0.9;
    const zeroY = c.height / 2;
    const gap = c.width / serialBuffers[0].bufferLength;
    ctx.clearRect(0, 0, c.width, c.height);

    const mapValueToY = (value) => zeroY - (value * 2 - 1) * amplitudeMultiplier * zeroY;

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

    if ($("#serialvis").is(":visible")) {
        $(".header").css("right", "50px");
    } else {
        $(".header").css("right", "20px");
    }

    // Draw quarter amplitude lines
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

    const oldestValues = Array(8).fill().map((_, ch) => {
        const buffer = serialBuffers[ch];
        return Array(buffer.bufferLength - 1).fill().map((_2, i) => buffer.oldest(i));
    });

    for (let ch = 0; ch < 8; ch++) {
        const channelValues = oldestValues[ch];
        ctx.beginPath();
        ctx.strokeStyle = palette[ch];
        ctx.moveTo(0, mapValueToY(channelValues[0]));
        for (let i = 1; i < channelValues.length; i++) {
            ctx.lineTo(gap * i, mapValueToY(channelValues[i]));
        }
        ctx.stroke();
    }

    window.requestAnimationFrame(drawSerialVis);
}

export function initVisPanel() {
    // Start animation loop for serial visualization
    window.requestAnimationFrame(drawSerialVis);

    // Handle toggling visibility
    $("#visButton").on("click", () => {
        toggleAuxPanel("#panel-vis");
        const $serialvis = $("#serialvis");
        
        // Apply positioning when visible
        if ($serialvis.is(":visible")) {
            $serialvis.css({
                "top": 0,
                "left": 0,
                "width": "100%",
                "height": "100%"
            });
        }
    });

    // Handle ESC key to close panel 
    $(document).on("keydown", (e) => {
        if (e.key === "Escape" && $("#serialvis").is(":visible")) {
            toggleAuxPanel("#panel-vis");
        }
    });
}