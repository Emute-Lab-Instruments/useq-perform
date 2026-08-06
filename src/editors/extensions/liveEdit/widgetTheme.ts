import { EditorView } from "@codemirror/view";

// ─── Theme ───────────────────────────────────────────────────────────────────

export const liveEditTheme = EditorView.baseTheme({
  // ── Wrapper ────────────────────────────────────────────────────────────────
  ".cm-live-edit": {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    padding: "0 4px",
    borderRadius: "6px",
    fontFamily: "inherit",
    fontSize: "0.95em",
    lineHeight: "1",
    verticalAlign: "baseline",
    backgroundColor: "rgba(120, 200, 255, 0.08)",
    border: "1px solid rgba(120, 200, 255, 0.25)",
    color: "rgba(220, 235, 255, 0.95)",
    cursor: "default",
    userSelect: "none",
  },
  ".cm-live-edit.is-modified": {
    backgroundColor: "rgba(255, 200, 120, 0.12)",
    borderColor: "rgba(255, 200, 120, 0.45)",
  },
  ".cm-live-edit.is-editing": {
    boxShadow: "0 0 0 2px rgba(120, 200, 255, 0.5)",
  },
  ".cm-live-edit.is-listening": {
    animation: "cm-live-edit-listening-pulse 1s ease-in-out infinite",
  },
  ".cm-live-edit.is-uninitialised": {
    opacity: "0.55",
  },
  ".cm-live-edit.is-wasm-preview": {
    borderStyle: "dashed",
  },
  ".cm-live-edit.is-error": {
    backgroundColor: "rgba(255, 100, 100, 0.12)",
    borderColor: "rgba(255, 100, 100, 0.6)",
    color: "rgba(255, 200, 200, 0.95)",
  },
  ".cm-live-edit.is-runtime-disabled": {
    opacity: "0.45",
    filter: "grayscale(0.6)",
  },
  // 1 Hz pulse halo for `listening` state.
  "@keyframes cm-live-edit-listening-pulse": {
    "0%, 100%": {
      boxShadow: "0 0 0 0 rgba(255, 220, 100, 0.8)",
    },
    "50%": {
      boxShadow: "0 0 0 4px rgba(255, 220, 100, 0.0)",
    },
  },

  // ── Readout ────────────────────────────────────────────────────────────────
  ".cm-live-edit-readout": {
    fontFamily: "monospace",
    fontSize: "0.9em",
    fontVariantNumeric: "tabular-nums",
    color: "inherit",
    minWidth: "2.2em",
    textAlign: "left",
  },

  // ── State badges ───────────────────────────────────────────────────────────
  ".cm-live-edit-badge": {
    fontSize: "0.7em",
    padding: "1px 4px",
    borderRadius: "4px",
    backgroundColor: "rgba(255, 220, 120, 0.25)",
    color: "rgba(255, 240, 200, 0.95)",
    fontWeight: "600",
    letterSpacing: "0.04em",
  },
  ".cm-live-edit.is-error .cm-live-edit-badge": {
    backgroundColor: "rgba(255, 100, 100, 0.35)",
    color: "rgba(255, 230, 230, 1)",
  },

  // ── Knob ───────────────────────────────────────────────────────────────────
  ".cm-live-edit-knob": {
    position: "relative",
    display: "inline-block",
    width: "1em",
    height: "1em",
    borderRadius: "50%",
    background: "rgba(120, 200, 255, 0.18)",
    border: "1px solid rgba(120, 200, 255, 0.55)",
    cursor: "ns-resize",
    flex: "0 0 auto",
  },
  ".cm-live-edit.is-modified .cm-live-edit-knob": {
    background: "rgba(255, 200, 120, 0.22)",
    borderColor: "rgba(255, 200, 120, 0.7)",
  },
  ".cm-live-edit-knob-indicator": {
    position: "absolute",
    top: "50%",
    left: "50%",
    width: "2px",
    height: "55%",
    marginLeft: "-1px",
    marginTop: "-2px",
    backgroundColor: "rgba(220, 240, 255, 0.95)",
    transformOrigin: "1px 2px", // origin near center of knob (rotation pivot)
    borderRadius: "1px",
    transition: "transform 80ms cubic-bezier(0.2, 0.7, 0.3, 1)",
    willChange: "transform",
  },
  // Drag must feel direct — kill the transition while the user is dragging.
  ".cm-live-edit-knob.is-dragging .cm-live-edit-knob-indicator": {
    transition: "none",
  },
  ".cm-live-edit.is-modified .cm-live-edit-knob-indicator": {
    backgroundColor: "rgba(255, 220, 160, 1)",
  },
  ".cm-live-edit-knob-seed-tick": {
    position: "absolute",
    top: "50%",
    left: "50%",
    width: "2px",
    height: "30%",
    marginLeft: "-1px",
    marginTop: "-1px",
    backgroundColor: "rgba(255, 255, 255, 0.45)",
    transformOrigin: "1px 1px",
    borderRadius: "1px",
    pointerEvents: "none",
  },

  // ── Slider ─────────────────────────────────────────────────────────────────
  ".cm-live-edit-slider": {
    position: "relative",
    display: "inline-block",
    width: "5em",
    height: "0.5em",
    borderRadius: "3px",
    background: "rgba(120, 200, 255, 0.18)",
    border: "1px solid rgba(120, 200, 255, 0.45)",
    cursor: "ew-resize",
    flex: "0 0 auto",
    verticalAlign: "middle",
  },
  ".cm-live-edit-slider-handle": {
    position: "absolute",
    top: "50%",
    width: "0.6em",
    height: "0.9em",
    marginLeft: "-0.3em",
    marginTop: "-0.45em",
    backgroundColor: "rgba(220, 240, 255, 0.95)",
    borderRadius: "2px",
  },
  ".cm-live-edit-slider-seed-tick": {
    position: "absolute",
    top: "-2px",
    width: "2px",
    height: "calc(100% + 4px)",
    marginLeft: "-1px",
    backgroundColor: "rgba(255, 255, 255, 0.5)",
    pointerEvents: "none",
  },

  // ── Toggle ─────────────────────────────────────────────────────────────────
  ".cm-live-edit-toggle": {
    display: "inline-block",
    padding: "1px 8px",
    borderRadius: "10px",
    fontSize: "0.85em",
    fontFamily: "monospace",
    cursor: "pointer",
    border: "1px solid rgba(120, 200, 255, 0.45)",
    backgroundColor: "rgba(120, 200, 255, 0.14)",
    color: "rgba(220, 235, 255, 0.9)",
  },
  ".cm-live-edit-toggle.is-on": {
    backgroundColor: "rgba(120, 220, 150, 0.22)",
    borderColor: "rgba(120, 220, 150, 0.6)",
    color: "rgba(220, 255, 220, 1)",
  },
  ".cm-live-edit-toggle.is-off": {
    backgroundColor: "rgba(180, 180, 180, 0.14)",
    borderColor: "rgba(180, 180, 180, 0.45)",
    color: "rgba(220, 220, 220, 0.85)",
  },

  // ── Picker ─────────────────────────────────────────────────────────────────
  ".cm-live-edit-picker": {
    display: "inline-flex",
    gap: "2px",
    fontFamily: "monospace",
    fontSize: "0.85em",
  },
  ".cm-live-edit-picker-option": {
    padding: "1px 6px",
    border: "1px solid rgba(120, 200, 255, 0.4)",
    borderRadius: "4px",
    cursor: "pointer",
    backgroundColor: "rgba(120, 200, 255, 0.06)",
    color: "rgba(220, 235, 255, 0.8)",
  },
  ".cm-live-edit-picker-option.is-selected": {
    backgroundColor: "rgba(120, 200, 255, 0.3)",
    borderColor: "rgba(120, 200, 255, 0.85)",
    color: "rgba(240, 250, 255, 1)",
  },
});
