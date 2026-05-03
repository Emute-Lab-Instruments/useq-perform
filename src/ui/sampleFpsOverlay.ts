import { getSampleFPS } from "../effects/visualisationRuntime.ts";
import { isDevmode } from "./settings/devmodeContext.ts";

let el: HTMLDivElement | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

export function mountSampleFpsOverlay(): void {
  if (!isDevmode()) return;
  if (el) return;

  el = document.createElement("div");
  el.id = "sample-fps-overlay";
  Object.assign(el.style, {
    position: "fixed",
    bottom: "8px",
    left: "8px",
    fontFamily: "monospace",
    fontSize: "11px",
    lineHeight: "1",
    padding: "3px 6px",
    background: "rgba(0,0,0,0.6)",
    color: "#0f0",
    borderRadius: "3px",
    pointerEvents: "none",
    zIndex: "9999",
    whiteSpace: "nowrap",
  } satisfies Partial<CSSStyleDeclaration>);
  el.textContent = "samp: -- fps";
  document.body.appendChild(el);

  timer = setInterval(() => {
    if (!el) return;
    const fps = getSampleFPS();
    el.textContent = `samp: ${fps.toFixed(1)} fps`;
  }, 500);
}

export function unmountSampleFpsOverlay(): void {
  if (timer) { clearInterval(timer); timer = null; }
  if (el) { el.remove(); el = null; }
}
