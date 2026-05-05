import { createSignal, onMount, onCleanup } from "solid-js";
import {
  installVirtualGamepad,
  uninstallVirtualGamepad,
  setVirtualButton,
  setVirtualAxis,
  resetAllVirtualAxes,
  releaseAllVirtualButtons,
  BUTTON,
  AXIS,
} from "./virtualGamepadApi";

// ── Joystick sub-component ─────────────────────────────────────

interface JoystickProps {
  svgRef: () => SVGSVGElement | null;
  centerX: number;
  centerY: number;
  axisXIndex: number;
  axisYIndex: number;
  children: any;
}

const Joystick = (props: JoystickProps) => {
  const [pos, setPos] = createSignal({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = createSignal(false);
  const maxRadius = 35;
  let groupRef!: SVGGElement;

  const startDrag = (e: PointerEvent) => {
    setIsDragging(true);
    groupRef.setPointerCapture(e.pointerId);
  };

  const drag = (e: PointerEvent) => {
    if (!isDragging()) return;
    e.preventDefault();

    const svg = props.svgRef();
    if (!svg) return;

    let pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    let svgP = pt.matrixTransform(svg.getScreenCTM()!.inverse());

    let dx = svgP.x - props.centerX;
    let dy = svgP.y - props.centerY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance > maxRadius) {
      dx = dx * (maxRadius / distance);
      dy = dy * (maxRadius / distance);
    }

    setPos({ x: dx, y: dy });
    setVirtualAxis(props.axisXIndex, dx / maxRadius);
    setVirtualAxis(props.axisYIndex, dy / maxRadius);
  };

  const endDrag = (e: PointerEvent) => {
    if (!isDragging()) return;
    setIsDragging(false);
    groupRef.releasePointerCapture(e.pointerId);
    setPos({ x: 0, y: 0 });
    setVirtualAxis(props.axisXIndex, 0);
    setVirtualAxis(props.axisYIndex, 0);
  };

  return (
    <g
      ref={groupRef}
      class={`stick ${!isDragging() ? "snap-back" : ""}`}
      transform={`translate(${pos().x}, ${pos().y})`}
      onPointerDown={startDrag}
      onPointerMove={drag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {props.children}
    </g>
  );
};

// ── Button helper ──────────────────────────────────────────────

function buttonHandlers(index: number) {
  return {
    onPointerDown: () => setVirtualButton(index, 1),
    onPointerUp: () => setVirtualButton(index, 0),
    onPointerLeave: () => setVirtualButton(index, 0),
    onPointerCancel: () => setVirtualButton(index, 0),
  };
}

// ── Main controller ────────────────────────────────────────────

export default function XboxController() {
  const [svgRef, setSvgRef] = createSignal<SVGSVGElement | null>(null);

  onMount(() => {
    installVirtualGamepad();
  });

  onCleanup(() => {
    releaseAllVirtualButtons();
    resetAllVirtualAxes();
    uninstallVirtualGamepad();
  });

  return (
    <svg
      ref={setSvgRef}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 800 600"
      style={{ "max-width": "100%", height: "auto", background: "transparent" }}
    >
      <defs>
        <linearGradient id="vgp-bodyGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#363636" />
          <stop offset="30%" stop-color="#242424" />
          <stop offset="100%" stop-color="#121212" />
        </linearGradient>

        <linearGradient id="vgp-bumperGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#1a1a1a" />
          <stop offset="100%" stop-color="#0a0a0a" />
        </linearGradient>

        <radialGradient id="vgp-stickGrad" cx="50%" cy="50%" r="50%">
          <stop offset="60%" stop-color="#141414" />
          <stop offset="100%" stop-color="#2a2a2a" />
        </radialGradient>

        <filter id="vgp-dropShadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="15" stdDeviation="15" flood-color="#000000" flood-opacity="0.6" />
        </filter>

        <filter id="vgp-buttonGlow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <style>
        {`
          .vgp-interactive { cursor: pointer; }
          .vgp-btn { transition: all 0.15s cubic-bezier(0.4, 0.0, 0.2, 1); }
          .vgp-btn:hover { filter: brightness(1.3); }
          .vgp-btn:active { transform: scale(0.92); }

          #vgp-btn-y { transform-origin: 570px 220px; }
          #vgp-btn-b { transform-origin: 615px 260px; }
          #vgp-btn-a { transform-origin: 570px 300px; }
          #vgp-btn-x { transform-origin: 525px 260px; }
          #vgp-btn-nexus { transform-origin: 400px 180px; }
          #vgp-btn-view { transform-origin: 330px 250px; }
          #vgp-btn-menu { transform-origin: 470px 250px; }

          .vgp-dpad-dir { fill: #222; transition: fill 0.1s ease-in-out; }
          .vgp-dpad-dir:hover { fill: #444; }
          .vgp-dpad-dir:active { fill: #666; }

          .vgp-bumper { transition: fill 0.15s ease; fill: url(#vgp-bumperGrad); }
          .vgp-bumper:hover { fill: #333; }
          .vgp-bumper:active { fill: #111; }

          .stick { cursor: grab; }
          .stick:active { cursor: grabbing; }
          .snap-back { transition: transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275); }
        `}
      </style>

      {/* Triggers (LT / RT) */}
      <path class="vgp-interactive" d="M 250 110 L 190 130 L 190 70 C 220 70, 240 80, 250 110 Z" fill="#0d0d0d" {...buttonHandlers(BUTTON.LT)} />
      <path class="vgp-interactive" d="M 550 110 L 610 130 L 610 70 C 580 70, 560 80, 550 110 Z" fill="#0d0d0d" {...buttonHandlers(BUTTON.RT)} />

      {/* Bumpers (LB / RB) */}
      <path id="vgp-bumper-l" class="vgp-bumper vgp-interactive" d="M 400 130 C 300 130, 220 130, 160 180 L 170 160 C 220 110, 320 110, 400 110 Z" {...buttonHandlers(BUTTON.LB)} />
      <path id="vgp-bumper-r" class="vgp-bumper vgp-interactive" d="M 400 130 C 500 130, 580 130, 640 180 L 630 160 C 580 110, 480 110, 400 110 Z" {...buttonHandlers(BUTTON.RB)} />

      {/* Main Controller Body */}
      <path d="M 400 130 C 500 130, 580 130, 640 180 C 700 230, 720 350, 680 440 C 660 480, 600 500, 560 460 C 520 420, 500 380, 460 380 C 440 380, 420 360, 400 360 C 380 360, 360 380, 340 380 C 300 380, 280 420, 240 460 C 200 500, 140 480, 120 440 C 80 350, 100 230, 160 180 C 220 130, 300 130, 400 130 Z" fill="url(#vgp-bodyGrad)" stroke="#111" stroke-width="2" filter="url(#vgp-dropShadow)" />

      {/* Central Glossy Panel Accent */}
      <path d="M 330 130 C 380 135, 420 135, 470 130 L 480 200 C 440 210, 360 210, 320 200 Z" fill="#0f0f0f" />
      <ellipse cx="400" cy="118" rx="8" ry="3" fill="#000" />

      {/* Xbox Nexus Button */}
      <g id="vgp-btn-nexus" class="vgp-btn vgp-interactive">
        <circle cx="400" cy="180" r="28" fill="#e0e0e0" stroke="#888" stroke-width="2" />
        <circle cx="400" cy="180" r="22" fill="#141414" />
        <path d="M 387 167 L 413 193 M 413 167 L 387 193" stroke="#fff" stroke-width="4.5" stroke-linecap="round" filter="url(#vgp-buttonGlow)" />
      </g>

      {/* View & Menu Buttons */}
      <g id="vgp-btn-view" class="vgp-btn vgp-interactive" {...buttonHandlers(BUTTON.Back)}>
        <circle cx="330" cy="250" r="12" fill="#1f1f1f" stroke="#000" stroke-width="2" />
        <rect x="325" y="244" width="5" height="4" fill="none" stroke="#ccc" stroke-width="1.5" />
        <rect x="331" y="252" width="5" height="4" fill="none" stroke="#ccc" stroke-width="1.5" />
      </g>
      <g id="vgp-btn-menu" class="vgp-btn vgp-interactive" {...buttonHandlers(BUTTON.Start)}>
        <circle cx="470" cy="250" r="12" fill="#1f1f1f" stroke="#000" stroke-width="2" />
        <line x1="464" y1="246" x2="476" y2="246" stroke="#ccc" stroke-width="2" stroke-linecap="round" />
        <line x1="464" y1="250" x2="476" y2="250" stroke="#ccc" stroke-width="2" stroke-linecap="round" />
        <line x1="464" y1="254" x2="476" y2="254" stroke="#ccc" stroke-width="2" stroke-linecap="round" />
      </g>

      {/* Left Thumbstick Area */}
      <circle cx="230" cy="260" r="50" fill="#111" stroke="#222" stroke-width="1" />
      <Joystick svgRef={svgRef} centerX={230} centerY={260} axisXIndex={AXIS.LeftStickX} axisYIndex={AXIS.LeftStickY}>
        <circle cx="230" cy="260" r="42" fill="url(#vgp-stickGrad)" />
        <circle cx="230" cy="260" r="32" fill="none" stroke="#181818" stroke-width="5" />
        <circle cx="230" cy="260" r="28" fill="#111" />
        <circle cx="225" cy="255" r="15" fill="#2a2a2a" opacity="0.6" />
      </Joystick>

      {/* Right Thumbstick Area */}
      <circle cx="490" cy="380" r="50" fill="#111" stroke="#222" stroke-width="1" />
      <Joystick svgRef={svgRef} centerX={490} centerY={380} axisXIndex={AXIS.RightStickX} axisYIndex={AXIS.RightStickY}>
        <circle cx="490" cy="380" r="42" fill="url(#vgp-stickGrad)" />
        <circle cx="490" cy="380" r="32" fill="none" stroke="#181818" stroke-width="5" />
        <circle cx="490" cy="380" r="28" fill="#111" />
        <circle cx="485" cy="375" r="15" fill="#2a2a2a" opacity="0.6" />
      </Joystick>

      {/* D-Pad */}
      <g id="vgp-dpad" transform="translate(290, 390)" class="vgp-interactive">
        <circle cx="0" cy="0" r="46" fill="#171717" stroke="#111" stroke-width="1" />
        <path class="vgp-dpad-dir" d="M -15 -15 L -15 -38 A 4 4 0 0 1 -11 -42 L 11 -42 A 4 4 0 0 1 15 -38 L 15 -15 Z" {...buttonHandlers(BUTTON.Up)} />
        <path class="vgp-dpad-dir" d="M -15 15 L -15 38 A 4 4 0 0 0 -11 42 L 11 42 A 4 4 0 0 0 15 38 L 15 15 Z" {...buttonHandlers(BUTTON.Down)} />
        <path class="vgp-dpad-dir" d="M -15 -15 L -38 -15 A 4 4 0 0 0 -42 -11 L -42 11 A 4 4 0 0 0 -38 15 L -15 15 Z" {...buttonHandlers(BUTTON.Left)} />
        <path class="vgp-dpad-dir" d="M 15 -15 L 38 -15 A 4 4 0 0 1 42 -11 L 42 11 A 4 4 0 0 1 38 15 L 15 15 Z" {...buttonHandlers(BUTTON.Right)} />
        <rect x="-15" y="-15" width="30" height="30" fill="#222" />
        <path d="M -15 -15 L 15 15 M 15 -15 L -15 15" stroke="#141414" stroke-width="2" />
      </g>

      {/* ABXY Button Section */}
      <circle cx="570" cy="260" r="65" fill="#1e1e1e" stroke="#111" stroke-width="2" />

      {/* ABXY Buttons */}
      <g id="vgp-btn-y" class="vgp-btn vgp-interactive" {...buttonHandlers(BUTTON.Y)}>
        <circle cx="570" cy="220" r="16" fill="#0d0d0d" stroke="#222" stroke-width="2" />
        <text x="570" y="226" font-family="Arial, sans-serif" font-weight="bold" font-size="18" fill="#FFC107" text-anchor="middle">Y</text>
      </g>
      <g id="vgp-btn-b" class="vgp-btn vgp-interactive" {...buttonHandlers(BUTTON.B)}>
        <circle cx="615" cy="260" r="16" fill="#0d0d0d" stroke="#222" stroke-width="2" />
        <text x="615" y="266" font-family="Arial, sans-serif" font-weight="bold" font-size="18" fill="#F44336" text-anchor="middle">B</text>
      </g>
      <g id="vgp-btn-a" class="vgp-btn vgp-interactive" {...buttonHandlers(BUTTON.A)}>
        <circle cx="570" cy="300" r="16" fill="#0d0d0d" stroke="#222" stroke-width="2" />
        <text x="570" y="306" font-family="Arial, sans-serif" font-weight="bold" font-size="18" fill="#4CAF50" text-anchor="middle">A</text>
      </g>
      <g id="vgp-btn-x" class="vgp-btn vgp-interactive" {...buttonHandlers(BUTTON.X)}>
        <circle cx="525" cy="260" r="16" fill="#0d0d0d" stroke="#222" stroke-width="2" />
        <text x="525" y="266" font-family="Arial, sans-serif" font-weight="bold" font-size="18" fill="#2196F3" text-anchor="middle">X</text>
      </g>
    </svg>
  );
}
