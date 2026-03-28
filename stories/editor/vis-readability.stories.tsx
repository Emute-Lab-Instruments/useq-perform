import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import {
  getLineContentBounds,
  groupIntoBlocks,
  buildBlockPolygonPath,
} from '@src/editors/extensions/visReadability';
import type { PixelLineBounds } from '@src/editors/extensions/visReadability';

const meta: Meta = {
  title: 'Editor/Vis Readability',
  tags: ['autodocs'],
};
export default meta;
type Story = StoryObj;

/** Staircase polygon mask computation demo. */
export const StaircasePolygonDemo: Story = {
  render: () => {
    const container = document.createElement('div');
    container.style.cssText = 'display:flex; flex-direction:column; gap:12px; padding:16px; background:#0a0a14; font-family:monospace; color:#ccc;';

    // --- Synthetic code lines (varying indent/length) ---
    const codeLines = [
      '(defn fibonacci [n]',
      '  (if (<= n 1)',
      '    n',
      '    (+ (fibonacci (- n 1))',
      '', // blank line — gap
      '', // blank line — gap
      '       (fibonacci (- n 2))))',
      '(fibonacci 10)',
    ];

    // Show content bounds analysis
    const boundsInfo = document.createElement('div');
    boundsInfo.style.cssText = 'font-size:11px; opacity:0.6; margin-bottom:4px;';
    boundsInfo.textContent = 'getLineContentBounds() results:';
    container.appendChild(boundsInfo);

    const boundsTable = document.createElement('div');
    boundsTable.style.cssText = 'font-size:10px; opacity:0.5; margin-bottom:8px; line-height:1.4;';
    for (let i = 0; i < codeLines.length; i++) {
      const { start, end } = getLineContentBounds(codeLines[i]);
      const row = document.createElement('div');
      row.textContent = `  line ${i + 1}: start=${start} end=${end}${start >= end ? ' (blank)' : ''}`;
      boundsTable.appendChild(row);
    }
    container.appendChild(boundsTable);

    // --- Build PixelLineBounds from synthetic metrics ---
    const LINE_HEIGHT = 20;
    const CHAR_WIDTH = 8;
    const X_OFFSET = 40;

    const lineBounds: PixelLineBounds[] = [];
    for (let i = 0; i < codeLines.length; i++) {
      const { start, end } = getLineContentBounds(codeLines[i]);
      if (start >= end) continue; // skip blank lines
      lineBounds.push({
        lineIndex: i + 1,
        left: X_OFFSET + start * CHAR_WIDTH,
        right: X_OFFSET + end * CHAR_WIDTH,
        top: i * LINE_HEIGHT,
        bottom: (i + 1) * LINE_HEIGHT,
      });
    }

    // --- Group into blocks and build polygon paths ---
    const blocks = groupIntoBlocks(lineBounds);

    // --- Canvas rendering ---
    const canvasWidth = 500;
    const canvasHeight = codeLines.length * LINE_HEIGHT + 20;
    const canvas = document.createElement('canvas');
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    canvas.style.cssText = 'border:1px solid rgba(255,255,255,0.1); border-radius:4px;';

    const ctx = canvas.getContext('2d');
    if (ctx) {
      // Draw a faux vis background (gradient to simulate waveform canvas)
      const grad = ctx.createLinearGradient(0, 0, canvasWidth, canvasHeight);
      grad.addColorStop(0, '#001a00');
      grad.addColorStop(0.5, '#003300');
      grad.addColorStop(1, '#001a00');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);

      // Draw faint waveform lines to simulate vis canvas content
      ctx.strokeStyle = 'rgba(0, 255, 65, 0.15)';
      ctx.lineWidth = 1;
      for (let wave = 0; wave < 3; wave++) {
        ctx.beginPath();
        for (let x = 0; x <= canvasWidth; x += 2) {
          const y = canvasHeight / 2 + Math.sin(x * 0.02 + wave * 2) * (canvasHeight * 0.3) + wave * 15;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }

      // Draw the staircase polygons as semi-transparent masks
      const PADDING = 4;
      const colors = ['rgba(0, 120, 255, 0.3)', 'rgba(255, 120, 0, 0.3)'];
      const borderColors = ['rgba(0, 120, 255, 0.8)', 'rgba(255, 120, 0, 0.8)'];

      for (let bi = 0; bi < blocks.length; bi++) {
        const pathStr = buildBlockPolygonPath(blocks[bi], PADDING);
        if (!pathStr) continue;

        const path2d = new Path2D(pathStr);

        // Fill
        ctx.fillStyle = colors[bi % colors.length];
        ctx.fill(path2d);

        // Stroke
        ctx.strokeStyle = borderColors[bi % borderColors.length];
        ctx.lineWidth = 1.5;
        ctx.stroke(path2d);
      }

      // Draw code text on top
      ctx.font = '13px monospace';
      ctx.fillStyle = '#e0e0e0';
      for (let i = 0; i < codeLines.length; i++) {
        if (codeLines[i].length > 0) {
          ctx.fillText(codeLines[i], X_OFFSET, i * LINE_HEIGHT + 14);
        }
      }

      // Draw line numbers
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.font = '10px monospace';
      for (let i = 0; i < codeLines.length; i++) {
        ctx.fillText(String(i + 1), 8, i * LINE_HEIGHT + 14);
      }
    }

    container.appendChild(canvas);

    // Legend
    const legend = document.createElement('div');
    legend.style.cssText = 'font-size:11px; display:flex; gap:16px; opacity:0.7;';
    legend.innerHTML =
      '<span style="color:rgba(0,120,255,0.9)">&#9632;</span> Block 1 (lines 1-4) ' +
      '<span style="color:rgba(255,120,0,0.9)">&#9632;</span> Block 2 (lines 7-8) ' +
      '<span style="opacity:0.5">Gap at blank lines 5-6</span>';
    container.appendChild(legend);

    return container;
  },
};

/** Sharp vs feathered mask edge comparison. */
export const MaskEdgeFeather: Story = {
  render: () => {
    const container = document.createElement('div');
    container.style.cssText =
      'display:flex; flex-direction:column; gap:10px; padding:16px; background:#0a0a14; font-family:monospace; color:#ccc;';

    // --- Synthetic line bounds (a code block with varying widths) ---
    const LINE_HEIGHT = 18;
    const CHAR_WIDTH = 7.5;
    const X_OFFSET = 10;

    const codeLines = [
      '(defn mix [a b t]',
      '  (+ (* a (- 1 t))',
      '     (* b t)))',
      '(mix (sine a1) (saw a2) 0.5)',
    ];

    const lineBounds: PixelLineBounds[] = codeLines.map((text, i) => {
      let start = 0;
      while (start < text.length && text[start] === ' ') start++;
      let end = text.length;
      while (end > start && text[end - 1] === ' ') end--;
      return {
        lineIndex: i + 1,
        left: X_OFFSET + start * CHAR_WIDTH,
        right: X_OFFSET + end * CHAR_WIDTH,
        top: 10 + i * LINE_HEIGHT,
        bottom: 10 + (i + 1) * LINE_HEIGHT,
      };
    });

    const blocks = groupIntoBlocks(lineBounds);
    const PADDING = 6;

    const canvasW = 260;
    const canvasH = 110;

    // Helper: draw a vis background with waveforms
    function drawVisBackground(ctx: CanvasRenderingContext2D, w: number, h: number) {
      const grad = ctx.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, '#001a00');
      grad.addColorStop(0.5, '#003300');
      grad.addColorStop(1, '#001a00');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      // Waveform lines
      ctx.lineWidth = 1.5;
      const colors = ['rgba(0,255,65,0.25)', 'rgba(255,100,0,0.2)', 'rgba(0,150,255,0.2)'];
      for (let wave = 0; wave < 3; wave++) {
        ctx.strokeStyle = colors[wave];
        ctx.beginPath();
        for (let x = 0; x <= w; x += 2) {
          const y = h / 2 + Math.sin(x * 0.03 + wave * 2.5) * (h * 0.35) + wave * 5;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }

    // Helper: draw text labels on code
    function drawCodeText(ctx: CanvasRenderingContext2D) {
      ctx.font = '12px monospace';
      ctx.fillStyle = '#e0e0e0';
      for (let i = 0; i < codeLines.length; i++) {
        ctx.fillText(codeLines[i], X_OFFSET, 10 + i * LINE_HEIGHT + 13);
      }
    }

    // Build the polygon path
    const polyPaths: Path2D[] = [];
    for (const block of blocks) {
      const pathStr = buildBlockPolygonPath(block, PADDING);
      if (pathStr) polyPaths.push(new Path2D(pathStr));
    }

    const row = document.createElement('div');
    row.style.cssText = 'display:flex; gap:12px;';

    // --- LEFT: Sharp mask (feather=0) ---
    const leftCol = document.createElement('div');
    leftCol.style.cssText = 'display:flex; flex-direction:column; gap:4px; align-items:center;';

    const leftLabel = document.createElement('div');
    leftLabel.style.cssText = 'font-size:11px; opacity:0.6;';
    leftLabel.textContent = 'feather: 0 (sharp)';
    leftCol.appendChild(leftLabel);

    const leftCanvas = document.createElement('canvas');
    leftCanvas.width = canvasW;
    leftCanvas.height = canvasH;
    leftCanvas.style.cssText = 'border:1px solid rgba(255,255,255,0.1); border-radius:4px;';

    const leftCtx = leftCanvas.getContext('2d');
    if (leftCtx) {
      // Draw blurred vis into a temp buffer
      const blurBuf = document.createElement('canvas');
      blurBuf.width = canvasW;
      blurBuf.height = canvasH;
      const blurCtx = blurBuf.getContext('2d');
      if (blurCtx) {
        drawVisBackground(blurCtx, canvasW, canvasH);
        blurCtx.filter = 'blur(8px) brightness(0.4)';
        blurCtx.drawImage(blurBuf, 0, 0);
        blurCtx.filter = 'none';
      }

      // Draw blurred vis clipped to sharp polygon
      leftCtx.save();
      for (const p of polyPaths) leftCtx.clip(p);
      leftCtx.drawImage(blurBuf, 0, 0);
      leftCtx.restore();

      // Draw vis background outside mask (faintly, for context)
      leftCtx.save();
      leftCtx.globalAlpha = 0.15;
      drawVisBackground(leftCtx, canvasW, canvasH);
      leftCtx.restore();

      // Re-draw clipped area on top (it was partially overwritten)
      leftCtx.save();
      for (const p of polyPaths) leftCtx.clip(p);
      leftCtx.drawImage(blurBuf, 0, 0);
      leftCtx.restore();

      drawCodeText(leftCtx);
    }
    leftCol.appendChild(leftCanvas);
    row.appendChild(leftCol);

    // --- RIGHT: Feathered mask (feather=10) ---
    const rightCol = document.createElement('div');
    rightCol.style.cssText = 'display:flex; flex-direction:column; gap:4px; align-items:center;';

    const rightLabel = document.createElement('div');
    rightLabel.style.cssText = 'font-size:11px; opacity:0.6;';
    rightLabel.textContent = 'feather: 10 (soft)';
    rightCol.appendChild(rightLabel);

    const rightCanvas = document.createElement('canvas');
    rightCanvas.width = canvasW;
    rightCanvas.height = canvasH;
    rightCanvas.style.cssText = 'border:1px solid rgba(255,255,255,0.1); border-radius:4px;';

    const rightCtx = rightCanvas.getContext('2d');
    if (rightCtx) {
      // Blurred vis buffer
      const blurBuf = document.createElement('canvas');
      blurBuf.width = canvasW;
      blurBuf.height = canvasH;
      const blurCtx = blurBuf.getContext('2d');
      if (blurCtx) {
        drawVisBackground(blurCtx, canvasW, canvasH);
        blurCtx.filter = 'blur(8px) brightness(0.4)';
        blurCtx.drawImage(blurBuf, 0, 0);
        blurCtx.filter = 'none';
      }

      // Build a feathered mask: draw polygon to mask buffer, then blur it
      const maskBuf = document.createElement('canvas');
      maskBuf.width = canvasW;
      maskBuf.height = canvasH;
      const maskCtx = maskBuf.getContext('2d');
      if (maskCtx) {
        maskCtx.fillStyle = '#fff';
        for (const p of polyPaths) maskCtx.fill(p);

        // Blur the mask for feathered edges
        const tempBuf = document.createElement('canvas');
        tempBuf.width = canvasW;
        tempBuf.height = canvasH;
        const tempCtx = tempBuf.getContext('2d');
        if (tempCtx) {
          tempCtx.drawImage(maskBuf, 0, 0);
          maskCtx.clearRect(0, 0, canvasW, canvasH);
          maskCtx.filter = 'blur(10px)';
          maskCtx.drawImage(tempBuf, 0, 0);
          maskCtx.filter = 'none';
        }
      }

      // Composite: draw blurred vis, then mask with destination-in
      rightCtx.drawImage(blurBuf, 0, 0);
      rightCtx.globalCompositeOperation = 'destination-in';
      rightCtx.drawImage(maskBuf, 0, 0);
      rightCtx.globalCompositeOperation = 'source-over';

      // Faint vis background for context
      rightCtx.save();
      rightCtx.globalAlpha = 0.15;
      drawVisBackground(rightCtx, canvasW, canvasH);
      rightCtx.restore();

      // Re-composite the feathered mask on top
      const compositeBuf = document.createElement('canvas');
      compositeBuf.width = canvasW;
      compositeBuf.height = canvasH;
      const compCtx = compositeBuf.getContext('2d');
      if (compCtx) {
        compCtx.drawImage(blurBuf, 0, 0);
        compCtx.globalCompositeOperation = 'destination-in';
        compCtx.drawImage(maskBuf, 0, 0);
        compCtx.globalCompositeOperation = 'source-over';
      }
      rightCtx.drawImage(compositeBuf, 0, 0);

      drawCodeText(rightCtx);
    }
    rightCol.appendChild(rightCanvas);
    row.appendChild(rightCol);

    container.appendChild(row);

    // Description
    const desc = document.createElement('div');
    desc.style.cssText = 'font-size:10px; opacity:0.4; margin-top:2px;';
    desc.textContent = 'Left: hard clip boundary. Right: blurred mask creates smooth falloff at polygon edges.';
    container.appendChild(desc);

    return container;
  },
};

/** Blur radius and tint opacity settings matrix. */
export const BlurSettingsMatrix: Story = {
  render: () => {
    const blurLevels = [
      { label: 'Blur: 2px', value: 2 },
      { label: 'Blur: 10px', value: 10 },
      { label: 'Blur: 25px', value: 25 },
    ];
    const tintLevels = [
      { label: 'Tint: 0.0', value: 0 },
      { label: 'Tint: 0.5', value: 0.5 },
      { label: 'Tint: 1.0', value: 1.0 },
    ];

    const cellWidth = 180;
    const cellHeight = 100;

    // Generate a sine wave SVG path for the sample waveform
    const wavePoints: string[] = [];
    for (let x = 0; x <= cellWidth; x += 2) {
      const t = (x / cellWidth) * Math.PI * 6;
      const y = cellHeight / 2 - Math.sin(t) * (cellHeight * 0.35);
      wavePoints.push(`${x},${y.toFixed(1)}`);
    }
    const waveD = `M${wavePoints.join(' L')}`;

    // Second wave for visual richness
    const wave2Points: string[] = [];
    for (let x = 0; x <= cellWidth; x += 2) {
      const t = (x / cellWidth) * Math.PI * 4 + 1;
      const y = cellHeight / 2 - Math.sin(t) * (cellHeight * 0.2) + 10;
      wave2Points.push(`${x},${y.toFixed(1)}`);
    }
    const wave2D = `M${wave2Points.join(' L')}`;

    return (
      <div
        style={{
          display: 'flex',
          'flex-direction': 'column',
          gap: '8px',
          padding: '16px',
          background: '#0a0a14',
          'font-family': 'monospace',
          color: '#ccc',
        }}
      >
        {/* Column headers */}
        <div style={{ display: 'flex', gap: '6px', 'margin-left': '70px' }}>
          {blurLevels.map((b) => (
            <div
              style={{
                width: `${cellWidth}px`,
                'text-align': 'center',
                'font-size': '11px',
                opacity: '0.6',
              }}
            >
              {b.label}
            </div>
          ))}
        </div>

        {/* Grid rows */}
        {tintLevels.map((tint) => (
          <div style={{ display: 'flex', gap: '6px', 'align-items': 'center' }}>
            {/* Row label */}
            <div
              style={{
                width: '64px',
                'text-align': 'right',
                'font-size': '11px',
                opacity: '0.6',
                'flex-shrink': '0',
              }}
            >
              {tint.label}
            </div>

            {/* Cells */}
            {blurLevels.map((blur) => {
              const brightness = 1 - tint.value * 0.85;

              return (
                <div
                  style={{
                    width: `${cellWidth}px`,
                    height: `${cellHeight}px`,
                    position: 'relative',
                    overflow: 'hidden',
                    'border-radius': '4px',
                    border: '1px solid rgba(255,255,255,0.1)',
                  }}
                >
                  {/* Blurred waveform layer */}
                  <div
                    style={{
                      position: 'absolute',
                      inset: '0',
                      filter: `blur(${blur.value}px) brightness(${brightness})`,
                    }}
                  >
                    <svg width={cellWidth} height={cellHeight} style={{ background: '#001500' }}>
                      <path d={waveD} stroke="#00ff41" stroke-width="2" fill="none" />
                      <path d={wave2D} stroke="#ff6600" stroke-width="1.5" fill="none" />
                    </svg>
                  </div>

                  {/* Code text overlay to show readability */}
                  <div
                    style={{
                      position: 'absolute',
                      inset: '0',
                      display: 'flex',
                      'align-items': 'center',
                      'justify-content': 'center',
                      'font-size': '11px',
                      color: '#e0e0e0',
                      'text-shadow': '0 0 2px rgba(0,0,0,0.5)',
                      'white-space': 'pre',
                    }}
                  >
                    {'(sine a1 440)'}
                  </div>
                </div>
              );
            })}
          </div>
        ))}

        {/* Description */}
        <div style={{ 'font-size': '10px', opacity: '0.4', 'margin-top': '4px', 'margin-left': '70px' }}>
          Higher blur + tint makes code more readable against the vis background
        </div>
      </div>
    );
  },
};
