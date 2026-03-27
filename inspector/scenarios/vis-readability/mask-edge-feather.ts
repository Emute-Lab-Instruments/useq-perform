import { defineScenario } from '../../framework/scenario';
import {
  groupIntoBlocks,
  buildBlockPolygonPath,
} from '@src/editors/extensions/visReadability';
import type { PixelLineBounds } from '@src/editors/extensions/visReadability';

/**
 * Side-by-side comparison of sharp vs feathered mask edges.
 * Uses the real buildBlockPolygonPath() to compute the staircase polygon,
 * then draws it twice: once with hard edges and once with a canvas blur
 * applied to the mask to simulate the readabilityFeather setting.
 */
export default defineScenario({
  category: 'Editor Decorations / Vis Readability',
  name: 'Mask edge feathering comparison',
  type: 'canary',
  sourceFiles: [
    'src/editors/extensions/visReadability.ts',
  ],
  description:
    'Two canvases side by side: left shows a staircase polygon mask with sharp edges ' +
    '(feather=0), right shows the same mask with softened/feathered edges (simulating ' +
    'readabilityFeather=10).  The mask clips a blurred vis background.  Verify the left ' +
    'mask has crisp polygon edges while the right has a smooth gradient falloff.',
  grepTerms: [
    'readabilityFeather',
    'readabilityPadding',
    'buildBlockPolygonPath',
    'groupIntoBlocks',
    'maskBuffer',
    'VisReadabilityPlugin',
  ],
  component: {
    component: () => {
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
    width: 570,
    height: 180,
  },
});
