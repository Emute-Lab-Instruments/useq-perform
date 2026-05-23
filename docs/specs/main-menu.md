---
stability: evolving
layer: behavioural
---

# Main menu

> Spec: the system/pause menu — a full-screen modal for non-performance actions (settings, save/restore, help, practice zone, connection status). Opened by L3+R3 chord. Counterpart to [MAIN.md](MAIN.md).
> See also [gamepad.md](gamepad.md) (input pipeline, layer mechanics), [zen-mode.md](zen-mode.md) (practice zone entry point), [overlays.md](overlays.md) (modal rendering patterns), [settings.md](settings.md) (settings panel content).

### Source files

- `src/ui/mainMenu/MainMenu.tsx` — menu component (props-based)
- `src/ui/mainMenu/menuItems.ts` — menu item registry and state
- `src/ui/adapters/mainMenu.tsx` — imperative adapter (`mountMainMenu`, `showMainMenu`, `closeMainMenu`)
- `src/lib/mainMenu/store.ts` — menu state store (open/closed, focused item, submenu stack)
- `src/lib/mainMenu/actions.ts` — menu action handlers
- `src/lib/gamepad/paradigms/modal-shift.ts` — L3+R3 chord binding
- `src/lib/keybindings/actions.ts` — `mainMenu.*` action IDs

---

## 1. Frame

1.1 The main menu is a **system-level modal** for actions that sit outside the performance flow: adjusting settings, saving/loading, entering practice mode, checking connectivity, and accessing help. It is the gamepad user's equivalent of a desktop app's menu bar.

1.2 The menu is **not** a performance tool. While open, the editor is paused (no eval, no live-edit streaming, no transport advance). The music continues playing on hardware (the runtime is independent), but the editor-side UI is in a suspended state. This is intentional — the menu is a deliberate pause.

1.3 Opening the menu does **not** stop the runtime or silence outputs. Hardware outputs continue from their last-evaluated state. WASM visualisation pauses (no sampling ticks). On menu close, visualisation resumes from current transport time.

1.4 The menu is accessible from **any** editor state — structural mode, insertion mode, with or without a radial menu open, with or without a sub-mode active. Opening the menu forcibly closes any active sub-mode (radial menu, vector-mark, act-on layer, float edit) and pushes the main-menu layer to the top of the stack.

---

## 2. Activation

### 2.1 Gesture

The main menu opens on the **chord** of both stick presses simultaneously: `chord(['LeftStickPress', 'RightStickPress'])`.

2.1.1 **Why L3+R3.** This is the standard "pause menu" gesture in console games. It's physically distinct (requires both thumbs to press inward simultaneously), impossible to trigger accidentally during normal navigation or value editing, and carries strong muscle-memory associations for gamepad users.

2.1.2 **Keyboard equivalent.** `Escape` when no other sub-mode is active (i.e. Escape has nothing to cancel). If a sub-mode is active, Escape cancels that first; a second Escape with nothing to cancel opens the main menu. Alternative keyboard binding: `Ctrl+Shift+P` (command palette convention — but the menu is not a palette, so this is secondary).

2.1.3 **Individual stick presses retain their existing bindings.** L3 alone = polarity flip (on numbers) or `control.toggleManualLeft`; R3 alone = `control.toggleManualRight`. Only the simultaneous chord opens the menu.

### 2.2 Closing

The menu closes via:
- `mainMenu.close` action (bound to B, Back, or Escape within the menu layer)
- Selecting "Resume" from the menu items
- The chord gesture again (L3+R3 is a toggle — press to open, press again to close)

### 2.3 State restoration

On close, the editor returns to exactly the state it was in before the menu opened:
- Cursor position restored
- Editor mode (structural/insertion) restored
- Any transient layers that were active are re-evaluated (they may have timed out during menu — if so, they stay popped)

---

## 3. Menu structure

### 3.1 Top-level items

The menu presents a vertical list of items. Each item is one of:
- **Action** — selecting it performs an immediate action and closes the menu
- **Submenu** — selecting it navigates into a child list (with a back affordance)
- **Toggle** — selecting it flips a boolean state; the menu stays open with visual feedback

```
┌─────────────────────────────┐
│       uSEQ Perform          │
├──────────���──────────────────┤
│  ▸ Resume                   │
│  ▸ Practice Zone            │
│  ▸ Save                     │
│  ▸ Restore                  │
│  ▸ Settings           ▶     │
│  ▸ Help               ▶     │
│  ▸ Connection               │
│  ▸ Transport           ▶    │
└──────���──────────────────────┘
```

### 3.2 Item definitions

| Item | Type | Behaviour |
|------|------|-----------|
| **Resume** | action | Close menu, return to editor |
| **Practice Zone** | action | Enter zen mode ([zen-mode.md](zen-mode.md)); menu closes |
| **Save** | submenu | Save slots: "Save to Slot 1–4", "Export to file" |
| **Restore** | submenu | Restore slots: "Slot 1–4 (with preview)", "Import from file", "Restore defaults" |
| **Settings** | submenu | Settings categories: General, Editor, Gamepad, Visualisation, Audio/Transport |
| **Help** | submenu | Help topics: Keybindings, Language Reference, Gamepad Layout, About |
| **Connection** | action | Shows connection status panel (hardware serial state, WASM state). Informational; closes on B/Back |
| **Transport** | submenu | Play / Pause / Stop / Rewind / BPM (with adjust) / Time Signature |

### 3.3 Save/Restore submenu

Save and restore operate on named slots stored via the persistence service:

```
┌─────────────────────────────┐
│  Save                       │
├──────────────────────────���──┤
│  ▸ Slot 1 (empty)          │
���  ▸ Slot 2: "bass patch"    │
│  ▸ Slot 3: "drums v2"      │
│  ▸ Slot 4 (empty)          │
│  ▸ Export to clipboard      │
│  ▸ ‹ Back                   │
└───────────��────────────────��┘
```

Saving captures the full editor content (all top-level forms). Restoring replaces the editor content entirely (with undo support — the user can undo a restore).

### 3.4 Settings submenu

Each settings category presents its options as a scrollable list of labelled values. Gamepad-friendly editing:
- Boolean settings: A to toggle
- Numeric settings: LB/RB to adjust (reuses atom-adjust mechanics)
- Enum settings: LB/RB to cycle through options
- The settings panel content is derived from the existing settings schema — the menu is an alternative entry point, not a reimplementation

### 3.5 Transport submenu

```
┌─────────��──────────────────���┐
│  Transport                  │
├────────────────────────���────┤
│  ▸ Play                     │
│  ▸ Pause                    │
���  ▸ Stop                     │
│  ▸ Rewind                   │
│  ▸ BPM: 120    [LB -] [RB +]│
│  ▸ Time Sig: 4/4            │
│  ▸ ‹ Back                   │
└──────────────────��──────────┘
```

BPM and time signature are editable in-place using LB/RB to adjust.

---

## 4. Gamepad navigation

### 4.1 Layer

The main menu pushes a predicate layer that masks all other input:

```ts
const mainMenuLayer: Layer = {
  name: 'main-menu',
  when: state => state.mainMenu.open,
  gestures: {
    [keyOf(tap('Up'))]:    'mainMenu.prev',
    [keyOf(held('Up'))]:   'mainMenu.prev',
    [keyOf(tap('Down'))]:  'mainMenu.next',
    [keyOf(held('Down'))]: 'mainMenu.next',
    [keyOf(tap('A'))]:     'mainMenu.select',
    [keyOf(tap('Start'))]: 'mainMenu.select',
    [keyOf(tap('B'))]:     'mainMenu.back',
    [keyOf(tap('Back'))]:  'mainMenu.close',
    [keyOf(tap('LB'))]:    'mainMenu.adjustDown',
    [keyOf(tap('RB'))]:    'mainMenu.adjustUp',
    [keyOf(held('LB'))]:   'mainMenu.adjustDown',
    [keyOf(held('RB'))]:   'mainMenu.adjustUp',
    [keyOf(chord(['LeftStickPress', 'RightStickPress']))]: 'mainMenu.close',
  },
}
```

4.1.1 The layer sits above all other layers when active (the `when` predicate ensures this).

4.1.2 `mainMenu.back` navigates up one submenu level; at the top level, it closes the menu entirely (equivalent to `mainMenu.close`).

4.1.3 `mainMenu.adjustDown` / `mainMenu.adjustUp` are used for inline value editing within the menu (BPM, numeric settings). On items that don't support adjustment, these are no-ops.

### 4.2 Focus model

4.2.1 **Single focused item.** Exactly one item in the current list level has focus. Focus wraps (Down on last item → first item; Up on first → last).

4.2.2 **Submenu entry.** Pressing A on a submenu item pushes the submenu onto a stack and focuses the first item in the child list.

4.2.3 **Back navigation.** B pops the submenu stack and restores focus to the parent item that was selected. At the root level, B closes the menu.

4.2.4 **No stick navigation.** Sticks are unused in the menu (the chord that opens/closes it is the only stick gesture). D-pad is sufficient for a vertical list.

---

## 5. Visual design

### 5.1 Layout

5.1.1 The menu renders as a centred vertical panel overlaid on the editor. The editor is visible behind a dimmed backdrop (same pattern as the radial menu, per [overlays.md](overlays.md)).

5.1.2 The panel is sized to its content (no fixed width beyond a minimum). Menu items are full-width rows with generous vertical padding for easy gamepad targeting.

5.1.3 A header shows the app name/logo. The currently focused item is highlighted with an accent-colour background and a left-edge indicator (▸ or similar).

### 5.2 Transitions

5.2.1 Open: the panel fades in over 150ms with a subtle scale-up (0.95 → 1.0). The backdrop dims simultaneously.

5.2.2 Close: reverse of open (150ms fade-out).

5.2.3 Submenu entry: current list slides left, child list slides in from right (200ms ease). Back reverses this.

### 5.3 Typography

Menu items use the app's UI font (not the editor monospace). Font size is larger than editor text — the menu is meant to be readable at arm's length (performer standing at a rack, looking at a monitor from ~1m).

---

## 6. Keyboard interaction

6.1 When the menu is open, keyboard users navigate identically:
- Arrow Up/Down = move focus
- Enter = select
- Escape or Backspace = back / close
- Letter keys = no text filtering in v1 (the menu is short enough to not need it)

6.2 The menu is not accessible via mouse click in v1 (there's no hamburger icon or menu bar). It's a gamepad/keyboard-native surface. If demand shows, a toolbar button could open it.

---

## 7. Action registry

The following action IDs are registered for the main menu:

| Action ID | Reversible | Description |
|-----------|-----------|-------------|
| `mainMenu.open` | no | Open the main menu |
| `mainMenu.close` | no | Close the main menu |
| `mainMenu.next` | no | Move focus to next item |
| `mainMenu.prev` | no | Move focus to previous item |
| `mainMenu.select` | no | Activate the focused item |
| `mainMenu.back` | no | Navigate back one submenu level (or close at root) |
| `mainMenu.adjustUp` | no | Increment the focused item's value (for adjustable items) |
| `mainMenu.adjustDown` | no | Decrement the focused item's value |

---

## 8. Open / Deferred

8.1 **Recent files.** A "Recent" section in the Restore submenu showing the last N documents loaded. Requires persistence of document history. Deferred.

8.2 **Search/filter.** For large settings lists, a text-filter or search affordance. Not needed at current settings count. Deferred.

8.3 **Custom menu items.** Allowing users to add custom actions to the menu (e.g. quick-access to specific settings, custom save destinations). Deferred.

8.4 **Mouse/touch interaction.** Click-to-select, scroll, hover states. The menu works for gamepad/keyboard first; mouse is a future polish pass.

8.5 **Menu state persistence.** Remembering which submenu the user was in last time they opened the menu, so repeated opens go straight to the relevant section. Minor convenience; deferred.

8.6 **Gamepad vibration.** A subtle rumble on menu open (if the browser Gamepad API supports it and the controller has motors). Polish; deferred.
