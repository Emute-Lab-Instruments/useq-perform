// Lightweight radial picker: two side-by-side radial selectors.
// Left stick selects category slice; right stick selects item slice.

import { dbg } from "../utils.ts";

const TAU = Math.PI * 2;

function angleFromVec(x, y) {
  // y is inverted in many gamepad APIs; treat up as negative y
  const ang = Math.atan2(-y, x);
  return (ang + TAU) % TAU; // 0..TAU
}

function sectorFromAngle(angle, count) {
  if (!count || count <= 0) return 0;
  const size = TAU / count;
  let idx = Math.floor(angle / size);
  if (idx < 0) idx = 0;
  if (idx >= count) idx = count - 1;
  return idx;
}

function createElement(tag, opts: any = {}) {
  const el = document.createElement(tag);
  if (opts.class) el.className = opts.class;
  if (opts.text) el.textContent = opts.text;
  if (opts.width) el.width = opts.width;
  if (opts.height) el.height = opts.height;
  return el;
}

export function showRadialPickerMenu({ categories, title = 'Create', onSelect }) {
  if (!Array.isArray(categories) || categories.length === 0) return () => {};

  const overlay = createElement('div', { class: 'picker-menu-overlay radial-picker-overlay' });
  const menu = createElement('div', { class: 'radial-picker' });
  if (title) menu.appendChild(createElement('div', { class: 'picker-menu-title', text: title }));

  const row = createElement('div', { class: 'radial-picker-row' });
  const left = createElement('canvas', { class: 'radial-canvas radial-left', width: 220, height: 220 }) as HTMLCanvasElement;
  const right = createElement('canvas', { class: 'radial-canvas radial-right', width: 220, height: 220 }) as HTMLCanvasElement;
  row.appendChild(left);
  row.appendChild(right);
  menu.appendChild(row);
  overlay.appendChild(menu);
  document.body.appendChild(overlay);

  let activeCat = 0;
  let activeItem = 0;
  let items = Array.isArray(categories[0]?.items) ? categories[0].items : [];

  function drawRadial(canvas: HTMLCanvasElement, count, activeIndex, labels) {
    try {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const r = 100; const cx = 110; const cy = 110;
      ctx.clearRect(0,0,220,220);
      ctx.save();
      for (let i=0; i<count; i++) {
        const start = i * (TAU / count) - Math.PI/2;
        const end = (i+1) * (TAU / count) - Math.PI/2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, r, start, end);
        ctx.closePath();
        ctx.fillStyle = (i === activeIndex) ? 'rgba(0,255,65,0.35)' : 'rgba(255,255,255,0.07)';
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.lineWidth = 1;
        ctx.fill();
        ctx.stroke();
        // label
        if (labels && labels[i]) {
          const mid = (start+end)/2;
          const lx = cx + Math.cos(mid) * (r * 0.6);
          const ly = cy + Math.sin(mid) * (r * 0.6);
          ctx.fillStyle = 'var(--text-primary, #ddd)';
          ctx.font = '12px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(labels[i]).slice(0,10), lx, ly);
        }
      }
      ctx.restore();
    } catch (e) { dbg('radial draw error', e); }
  }

  function render() {
    drawRadial(left, categories.length, activeCat, categories.map(c => c.label));
    drawRadial(right, Math.max(1, items.length), Math.min(activeItem, Math.max(0, items.length-1)), items.map(i => i.label));
  }

  function close() {
    overlay.classList.remove('visible');
    menu.classList.remove('visible');
    setTimeout(() => overlay.remove(), 150);
    window.removeEventListener('gamepadpickerinput', onPickerEvent);
  }

  function confirm() {
    const entry = items[Math.min(activeItem, items.length-1)];
    if (!entry) return;
    close();
    onSelect?.(entry.special === 'number' ? { label: '0', value: 0, insertText: '0' } : (entry.insertText ? entry : { ...entry, insertText: `(${entry.value} )` }));
  }

  function onPickerEvent(e) {
    const { action, leftStick, rightStick, direction } = e.detail || {};
    if (action === 'cancel') return close();
    if (action === 'select') return confirm();

    // Allow D-pad fallback to cycle
    if (direction === 'left') { activeCat = (activeCat + categories.length - 1) % categories.length; items = categories[activeCat].items || []; activeItem = 0; render(); return; }
    if (direction === 'right') { activeCat = (activeCat + 1) % categories.length; items = categories[activeCat].items || []; activeItem = 0; render(); return; }
    if (direction === 'up') { if (items.length) { activeItem = (activeItem + items.length - 1) % items.length; render(); } return; }
    if (direction === 'down') { if (items.length) { activeItem = (activeItem + 1) % items.length; render(); } return; }

    const catCount = categories.length;
    if (leftStick && (Math.hypot(leftStick.x||0, leftStick.y||0) > 0.5)) {
      const ang = angleFromVec(leftStick.x||0, leftStick.y||0);
      const idx = sectorFromAngle(ang, catCount);
      if (idx !== activeCat) {
        activeCat = idx;
        items = categories[activeCat].items || [];
        activeItem = 0;
        render();
      }
    }
    const itemCount = Math.max(1, items.length);
    if (rightStick && (Math.hypot(rightStick.x||0, rightStick.y||0) > 0.5)) {
      const ang = angleFromVec(rightStick.x||0, rightStick.y||0);
      const idx = sectorFromAngle(ang, itemCount);
      if (idx !== activeItem) {
        activeItem = idx;
        render();
      }
    }
  }

  window.addEventListener('gamepadpickerinput', onPickerEvent);

  setTimeout(() => { overlay.classList.add('visible'); menu.classList.add('visible'); render(); }, 10);
  return close;
}
