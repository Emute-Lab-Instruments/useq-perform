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
- `src/ui/adapters/modal.tsx` — imperative mount/show/close API for HTML modals and `confirmDialog()` (in-app confirm)
- `src/contracts/toastChannels.ts` — `notify()` and the typed toast channel (callable from any layer)
- `src/ui/toast/ToastStack.tsx`, `src/ui/toast/toastStore.ts`, `src/ui/adapters/toast.tsx` — toast surface view, store, and wiring
- `src/ui/help/SnippetModal.tsx` — snippet detail modal (registers via `pushOverlay`)
- `src/ui/keybindings/ActionPalette.tsx` — command palette (registers via `pushOverlay`)
- `src/ui/liveEdit/MidiLearnConflict.tsx` — MIDI-learn conflict modal (registers via `pushOverlay`)
- `src/ui/adapters/panels.tsx` — chrome panels (settings/help/machine) that register via `pushOverlay`; side-by-side docking and raise-on-interaction

---

1.1 **Overlay stack.** Modals, palettes, and dismissable panels register with a global LIFO overlay stack (see `src/ui/overlayManager.ts`) via `pushOverlay(id, onEscape)`, which returns a pop function. Escape dispatches dismiss to the topmost overlay only. The gamepad-driven radial menu (see [radial-menu.md](radial-menu.md)) is **not** on this stack — it is a manifest-driven surface controlled by `src/lib/menu/store` and dismissed through the gamepad pipeline, not by overlay-stack Escape.

1.2 **Scroll lock is reference-counted.** The body's overflow is locked while ≥ 1 overlay is registered and restored when the last overlay pops.

1.2.1 **Side-by-side chrome panels.** Chrome panels (Settings, Help, Machine) dock to a viewport side: Settings and Machine prefer the right, Help prefers the left. A panel whose preferred side is taken uses the free side. If both sides are taken, it replaces the panel on its preferred side, so at most two chrome panels are open at once. On viewports ≤ 700px wide, panels are laid out full width and opening one closes any other. Each open chrome panel holds one overlay-stack entry. A pointer-down or focus-in inside a panel, or `showPanel(id)` on an already-open panel, raises it: it paints above the other panels and its overlay entry moves to the top of the stack (the new entry is pushed before the old one is popped, so the scroll-lock count stays ≥ 1). Escape therefore dismisses the panel the user opened or interacted with last. Known limitation: a raise also moves the panel above a backdrop-less overlay (e.g. the command palette) that was opened after it.

1.3 **Modals** dismiss on Escape (when registered with the overlay manager), backdrop click, and any explicit close button (see `src/ui/Modal.tsx`, `src/ui/adapters/modal.tsx`). Tab/Shift-Tab cycle focus within the modal. On mount, focus goes to the element marked `data-autofocus` if present, otherwise to the first focusable element. The close button carries `aria-label="Close"` (its glyph is `aria-hidden`). Modal colours inherit the active theme through the `:root` CSS variables written by the theme system (`--panel-bg`, `--text-primary`, `--panel-border`, ...); stacking uses the `--z-modal-backdrop` / `--z-modal` tokens. Focus returns to the previously focused element on close (if it is still connected to the document).

1.4 **Command palette** (`src/ui/keybindings/ActionPalette.tsx`) dismisses on Escape and on selection. It supports keyboard arrow navigation and Enter to select. It registers with the overlay manager for Escape and scroll lock.

1.5 At most one **modal** from the imperative modal adapter (`src/ui/adapters/modal.tsx`) is visible at once. The adapter holds a single modal-state signal; a second `showModal` **replaces** the current modal rather than queueing behind it. (There is no FIFO modal queue. If stacked/queued modals are ever needed, that is a separate feature, not current behaviour.) Confirm dialogs use this same single slot: a confirm that is replaced by another modal (or removed by `closeModal`) before the user chooses is treated as **cancelled** — `confirmDialog()` resolves `false` and the confirm's action does not run.

1.5.1 **Confirm dialog.** The app never calls native `window.alert()`, `window.confirm()`, or `window.prompt()`. Confirmations use `confirmDialog({ title, message, confirmLabel?, cancelLabel?, destructive? })` from `src/ui/adapters/modal.tsx`, which renders a themed `Modal` and returns `Promise<boolean>`: `true` on the confirm button only; `false` on the cancel button, Escape, backdrop click, the close button, or replacement (§1.5). Enter activates the focused button. For a non-destructive confirm the confirm button receives initial focus; for a `destructive` confirm the confirm button is danger-styled (`--status-error`) and the **cancel** button receives initial focus, so Enter alone never performs the destructive action. Destructive confirms: reset all settings, delete snippet, promote settings to shipped defaults. Informational messages that were previously `alert()`s are toasts (§1.7), errors as `error` toasts. Form validation messages are shown inline on the offending field (`aria-invalid` + `aria-describedby`), not as dialogs or toasts.

1.6 No overlay may steal focus from the editor without an explicit user gesture (key press, click, gamepad button). Auto-popping overlays in response to internal state changes is forbidden.

1.7 **Toast surface.** Non-blocking notifications are raised with `notify({ message, kind?, durationMs?, action? })` from `src/contracts/toastChannels.ts`, callable from any layer; `kind` is `info` (default), `success`, `warn`, or `error`. Toasts:

- stack at the **bottom-left** of the viewport (clear of the bottom-right console panel), above modals (`--z-toast`), newest last;
- show at most **4** at once — a new toast evicts the oldest;
- auto-dismiss after a per-kind default (info/success 4 s, warn 6 s, error 10 s) or the caller's `durationMs`; `durationMs: 0` makes a toast sticky;
- have a dismiss button labelled `Dismiss notification`, and at most one action button (`action: { label, run }`) which runs the action and dismisses the toast;
- announce through `role="status"` / `aria-live="polite"`, or `role="alert"` / `aria-live="assertive"` for `error`;
- **never take focus** (§1.6) and are **not on the overlay stack** (§1.1): they do not register with `pushOverlay`, do not affect scroll lock, and Escape continues to dismiss the topmost overlay rather than a toast;
- animate in only when the user has not requested reduced motion.

Toasts raised before the toast module is loaded (it is loaded by the application root at startup) are dropped.
