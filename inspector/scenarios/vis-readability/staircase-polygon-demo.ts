import { defineScenario } from '../../framework/scenario';
import {
  getLineContentBounds,
  groupIntoBlocks,
  buildBlockPolygonPath,
} from '@src/editors/extensions/visReadability';
import type { PixelLineBounds } from '@src/editors/extensions/visReadability';

/**
 * Demonstrates the staircase polygon mask computation using the actual
 * pure functions from the vis readability extension.  Renders synthetic
 * line bounds on a canvas so reviewers can verify the polygon shapes
 * that would mask code regions in the real overlay.
 */
export default defineScenario({
  category: 'Editor Decorations / Vis Readability',
  name: 'Staircase polygon mask demo',
  type: 'contract',
  sourceFiles: [
    'src/editors/extensions/visReadability.ts',
  ],
  description:
    'Uses the real getLineContentBounds(), groupIntoBlocks(), and buildBlockPolygonPath() ' +
    'functions to compute staircase polygon paths from synthetic line bounds, then draws ' +
    'them on a canvas.  Verify that the polygon shapes hug the code regions tightly with ' +
    'staircase steps where line widths change, and that the two blocks are rendered as ' +
    'separate polygons with a gap between them (lines 4-5 are blank).',
  grepTerms: [
    'getLineContentBounds',
    'groupIntoBlocks',
    'buildBlockPolygonPath',
    'PixelLineBounds',
    'VisReadabilityPlugin',
    'buildClipPath',
  ],
  component: {
    component: () => {
      const container = document.createElement('div');
      container.style.cssText = 'display:flex; flex-direction:column; gap:12px; padding:16px; background:#0a0a14; font-family:monospace; color:#ccc;';

      // --- Synthetic code lines (varying indent/length) ---
      const codeLines = [
        '(defn fibonacci [n]',
        '  (if (<= n 1)',
        '    n',
        '    (+ (fibonacci (- n 1))',
        '',                          // blank line — gap
        '',                          // blank line — gap
        '       (fibonacci (- n 2)))))',
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
    width: 540,
    height: 320,
  },
});
