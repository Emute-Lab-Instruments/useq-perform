---
stability: stable
layer: behavioural
---

# Overlays

> Spec: modals, palettes, panels, and the global overlay stack. Counterpart to [MAIN.md](MAIN.md).
>
> The gamepad-driven radial command menu is a **separate surface** and is specified in [radial-menu.md](radial-menu.md); it does not participate in the overlay stack described here.

### Source files

- `src/ui/overlayManager.ts` — global overlay stack, Escape dispatch, scroll-lock reference counting
- `src/ui/Modal.tsx` — modal component (focus trap, focus restore, dismiss-on-Escape/backdrop)
- `src/ui/adapters/modal.tsx` — imperative mount/show/close API for HTML modals
- `src/ui/help/SnippetModal.tsx` — snippet detail modal (registers via `pushOverlay`)
- `src/ui/keybindings/ActionPalette.tsx` — command palette (registers via `pushOverlay`)
- `src/ui/liveEdit/MidiLearnConflict.tsx` — MIDI-learn conflict modal (registers via `pushOverlay`)
- `src/ui/adapters/panels.tsx` — chrome panels (settings/help) that register via `pushOverlay`

---

1.1 **Overlay stack.** Modals, palettes, and dismissable panels register with a global LIFO overlay stack (see `src/ui/overlayManager.ts`) via `pushOverlay(id, onEscape)`, which returns a pop function. Escape dispatches dismiss to the topmost overlay only. The gamepad-driven radial menu (see [radial-menu.md](radial-menu.md)) is **not** on this stack — it is a manifest-driven surface controlled by `src/lib/menu/store` and dismissed through the gamepad pipeline, not by overlay-stack Escape.

1.2 **Scroll lock is reference-counted.** The body's overflow is locked while ≥ 1 overlay is registered and restored when the last overlay pops.

1.3 **Modals** dismiss on Escape (when registered with the overlay manager), backdrop click, and any explicit close button (see `src/ui/Modal.tsx`, `src/ui/adapters/modal.tsx`). Tab/Shift-Tab cycle focus within the modal. The first focusable element receives focus on mount. Focus returns to the previously focused element on close (if it is still connected to the document).

1.4 **Command palette** (`src/ui/keybindings/ActionPalette.tsx`) dismisses on Escape and on selection. It supports keyboard arrow navigation and Enter to select. It registers with the overlay manager for Escape and scroll lock.

1.5 At most one **modal** from the imperative modal adapter (`src/ui/adapters/modal.tsx`) is visible at once. The adapter holds a single modal-state signal; a second `showModal` **replaces** the current modal rather than queueing behind it. (There is no FIFO modal queue. If stacked/queued modals are ever needed, that is a separate feature, not current behaviour.)

1.6 No overlay may steal focus from the editor without an explicit user gesture (key press, click, gamepad button). Auto-popping overlays in response to internal state changes is forbidden.
