# Gamepad

> Spec: gamepad input, navigation modes, stick-bind, picker mode. Counterpart to [MAIN.md](MAIN.md).
> See also [keybindings.md](keybindings.md) for the shared action namespace.

1.1 The gamepad is a **first-class peer** of the keyboard. Its actions reference the same `ActionId` namespace.

1.2 Gamepad input is polled at ~50 ms intervals. Initial repeat delay 300 ms; repeat interval 60 ms thereafter.

1.3 **Two navigation modes**: `spatial` (D-pad moves cursor by character/line) and `structural` (D-pad navigates AST: prev/next/parent/child). Toggled via `nav.toggleMode` (default `Back` button). Mode is visible in the UI.

1.4 **Stick-bind-to-number.** Pressing the left or right stick (`LeftStickPress`/`RightStickPress`) binds that stick to the number under the cursor. Y-axis adjusts value (exponential scale, ~3× sensitivity); X-axis modulates sensitivity. Throttled at ~30 Hz. The bound value's text is updated live in the document; the original text is restored if the binding is cancelled.

1.5 **Manual control state.** Each bound stick has its own `{ value, lastSentValue, lastSentAt, from, to, originalText }` record. Number formatting: scientific notation below 0.001, 4 decimals 0.001–100, 2 decimals ≥ 100.

1.6 **Picker mode.** When a picker or radial menu is open, gamepad input is captured by the menu: D-pad navigates, A selects, B/Back cancels, LB/RB/LT/RT trigger apply variants.

1.7 **Default gamepad bindings**: `Start`→`eval.now`, `Back`→`nav.toggleMode`, `Y`→`edit.delete`, `LB+A`→`menu.openBefore`, `RB+A`→`menu.openAfter`, `X`→`menu.radial`. Users may override.

1.8 Stick deadzone is 0.12; button threshold is 0.1. Below threshold, the input is ignored.

1.9 **Gamepad disconnect** must not crash the app. The poller silently no-ops while no gamepad is connected; reconnect is detected automatically.

## Open / Deferred

2.1 **Gamepad rebinding UI.** Whether full gamepad rebinding ships in v1 or stays default-only is open; the data model supports it.
