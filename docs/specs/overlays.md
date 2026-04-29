# Overlays

> Spec: modals, pickers, radial menus, and the overlay stack. Counterpart to [MAIN.md](MAIN.md).

1.1 **Overlay stack.** Modals, pickers, radial menus, and other dismissable overlays are pushed onto a global LIFO overlay stack. Escape dispatches dismiss to the topmost overlay only.

1.2 **Scroll lock is reference-counted.** The body's overflow is locked while ≥ 1 overlay is open and restored when the last overlay closes.

1.3 **Modals** dismiss on Escape, backdrop click, and any explicit close button. Tab/Shift-Tab cycle focus within the modal. The first focusable element receives focus on mount. Focus returns to the previously focused element on close.

1.4 **Picker menus** dismiss on Escape and on selection. They support keyboard arrow navigation, Enter/Space to select, and gamepad equivalents. Layouts: `grid` (default 3 columns) and `vertical`.

1.5 **Radial menus** are circular pickers driven by mouse hover/click or gamepad stick. Segments are arcs; the active segment is visually distinct. A "double radial" variant nests an inner and outer ring for two-axis selection.

1.6 At most one **modal** is visible at once. Multiple non-modal overlays (e.g. modifier hints + picker) may coexist; they share the overlay stack.

1.7 No overlay may steal focus from the editor without an explicit user gesture (key press, click, gamepad button). Auto-popping overlays in response to internal state changes is forbidden.
