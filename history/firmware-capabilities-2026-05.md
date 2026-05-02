# Firmware Capability Discovery: Hardware Buttons/Toggles + CV Calibration + Flash

**Date:** 2026-05-02
**Issue:** useq-perform-gii8.13
**Purpose:** Inventory what `src-useq/` currently supports for two Phase 5 features.

---

## Executive Summary

Neither feature has any firmware support today. The firmware reads buttons/toggles/switches as polled input values per tick but never pushes events to the editor. There is no calibration mode, no per-output voltage trim table, and no "set exact voltage" command. Flash storage exists and works well but stores only signal-engine state (cell definitions + output expressions), not calibration data.

---

## 1. Capability Matrix

| Capability | Feature A (buttons/toggles to code) | Feature B (CV calibration + flash) |
|---|---|---|
| **Hardware reads inputs** | YES — polled per tick in `HardwareIO::read_inputs()` | N/A |
| **Debounce / filtering** | PARTIAL — EMA smoothing for analog; raw `digitalRead()` for buttons (no debounce) | N/A |
| **Repeat semantics** | NO — no edge detection, no repeat-on-hold | N/A |
| **Firmware pushes events to editor** | NO — no unsolicited `hw-event` message type exists | NO — no calibration-mode messages |
| **Wire-protocol message for events** | MISSING — not in spec or implementation | MISSING |
| **User code can bind to button press** | PARTIAL — user can poll `(swm 1)` in an output expression, but this is a continuous value, not a discrete event | N/A |
| **Takeover / calibration mode** | N/A | NO — firmware has no concept of mode-switching |
| **"Set exact voltage" command** | N/A | NO — no protocol message, no firmware handler |
| **Flash storage exists** | N/A | YES — `FlashStorage` with CRC32, save/load/erase |
| **Per-output calibration tables in flash** | N/A | NO — flash only stores signal-engine cells + output source text |
| **Flash format extensible** | N/A | PARTIALLY — version field exists; adding a calibration section requires a format version bump |

---

## 2. Detailed Findings

### 2.1 Feature A — Hardware Buttons/Toggles to User Code

#### What exists

1. **Input hardware is read per tick** (`firmware::HardwareIO::read_inputs()`):
   - v0.2: Momentary M1/M2, toggles T1/T2, switch RS1, rotary R1
   - v1.0: Momentary M1, 3-way toggle T1 (mapped to 0/1/2)
   - Music Thing: 3-position switch (ZSWITCH), knobs (MAIN/X/Y)

2. **Input values flow to the signal graph** via `ExecutionContext::hw_inputs` pointer. The graph compiler maps symbol names to input indices:
   - `in1` / `in2` → gate inputs (0/1)
   - `ain1` / `ain2` → analog CV ([0, 1])
   - Additional inputs (knobs, switches) currently have no graph-level symbols — they exist only in `io.inputs[]` but `resolve_hardware_input()` only maps 4 indices.

3. **The old `IOManager` path** (legacy) has interrupt handlers for gate inputs (`gpio_irq_gate1/2`) but these fire into the old interpreter path, not the new signal engine.

#### What is missing

1. **No edge detection.** Buttons are read as continuous 0/1 values per tick. There is no firmware-side concept of "pressed" vs "released" vs "held" — just the current level.

2. **No debounce for digital inputs.** The `SmoothInput` EMA filter is only applied to analog inputs. Button reads are raw `digitalRead()`.

3. **No event push over serial.** The wire protocol (§5) has no `type:"hw-event"` or similar. The firmware never sends unsolicited hardware-input messages. The only input-related path is `set-live-inputs` (editor → device), which is the opposite direction.

4. **No repeat-on-hold semantics.** No timer counts how long a button has been held.

5. **Incomplete graph-level input mapping.** `resolve_hardware_input()` only maps `in1`, `in2`, `ain1`, `ain2`. Switches (`swm`, `swt`) and encoder (`rot`) are referenced in the inputs spec but not wired into the new signal engine's graph builder.

#### How user code currently sees buttons

Users write `(swm 1)` or `(swt 1)` as function calls in the old ModuLisp interpreter. In the new signal engine path, these don't exist as graph leaves — they would need to be added as `InputLoad` nodes with proper index mapping. This is a pre-existing gap in the signal-engine migration.

### 2.2 Feature B — CV 1V/oct Calibration with Flash

#### What exists

1. **Flash storage** — a mature, tested subsystem:
   - Binary format with CRC32 integrity checking
   - 32 KB reserved at end of RP2040 flash (8 sectors)
   - Desktop-testable via `IStorage` interface
   - Saves: all defined cells (variables, functions, data vectors) + output source text
   - Trigger: `(memory-save)` ModuLisp builtin (cold-path action, disables interrupts)
   - Load: automatic on boot if valid state detected

2. **Output writing** — all continuous outputs go through `HardwareIO::write_outputs()`:
   - Values are clamped to [0, 1] and scaled to 11-bit PWM (2048 levels)
   - Music Thing variant uses SPI DAC for audio outputs (pins 18/19/21)
   - Standard variants use PIO PWM at 100 kHz

3. **The format is versioned** (`FLASH_FORMAT_VERSION = 1`) — a version bump can add new sections.

#### What is missing

1. **No calibration mode.** The firmware tick loop is unconditional — there is no "freeze outputs, enter calibration" state. It always runs `execute_all_outputs` → `write_outputs`.

2. **No "set exact voltage" command.** There is no wire-protocol message that says "output A1 should now emit exactly X volts." The firmware only knows normalised [0, 1] values.

3. **No per-output calibration table.** The mapping from normalised [0, 1] to physical voltage is a single linear function: `value * MAX_PWM`. There are no offset/gain correction terms. Each output is assumed to be linear and identical.

4. **No calibration data in flash.** The flash format stores signal-engine state only — cells and output expressions. There is no reserved region for a calibration table.

5. **No way to measure actual output voltage.** The firmware has no ADC feedback loop from outputs. Calibration requires an external measurement tool (multimeter or reference module) and human confirmation.

---

## 3. Proposed Wire-Protocol Additions

### 3.1 Feature A: Hardware Input Events

New unsolicited message type (device → editor):

```json
{
  "type": "hw-event",
  "input": "m1",
  "event": "press",
  "value": 1.0,
  "t": 4.231
}
```

| Field | Type | Description |
|---|---|---|
| `type` | string | Always `"hw-event"` |
| `input` | string | Input name matching the inputs spec: `m1`, `m2`, `t1`, `t2`, `rs1`, `r1`, `in1`, `in2` |
| `event` | string | One of: `press`, `release`, `change`, `rotate-cw`, `rotate-ccw` |
| `value` | number | Current value (0/1 for buttons, 0/1/2 for 3-way toggles, delta for encoder) |
| `t` | number | Firmware-side timestamp (seconds since boot) |

**Delivery guarantee:** opportunistic (same as stream frames). Buttons are read every tick (~4 kHz); events are derived by edge detection and delivered at most once per press. The editor tolerates missed events gracefully (binding to user code is advisory, not transactional).

**Debounce semantics** (firmware-side):
- Momentary buttons: 20ms lockout after first edge
- Toggle switches: 30ms lockout after edge
- Rotary encoder: existing gray-code state machine handles this

### 3.2 Feature B: Calibration Mode

Two new message types:

#### Editor → Device: Enter calibration mode

```json
{
  "type": "calibrate",
  "action": "start",
  "output": "a1",
  "requestId": "req-42"
}
```

Response: `{type:"response", requestId:"req-42", success:true, mode:"calibrating"}`

On entering calibration mode for output X:
- The specified output is taken over by the calibration controller
- Other outputs continue running normally (no global freeze)
- The signal engine's computed value for that output is ignored until calibration ends

#### Editor → Device: Set calibration point

```json
{
  "type": "calibrate",
  "action": "set-point",
  "output": "a1",
  "target_v": 1.0,
  "raw_value": 819,
  "requestId": "req-43"
}
```

- `target_v`: the desired voltage (e.g. 0.0, 1.0, 2.0, 3.0, 4.0, 5.0)
- `raw_value`: the DAC/PWM value that the user has confirmed produces this voltage

Response: `{type:"response", requestId:"req-43", success:true, applied:true}`

#### Editor → Device: Finish calibration

```json
{
  "type": "calibrate",
  "action": "finish",
  "output": "a1",
  "save": true,
  "requestId": "req-44"
}
```

- `save: true` persists the calibration table to flash
- `save: false` uses the calibration for this session only

Response: `{type:"response", requestId:"req-44", success:true}`

#### Flash format extension

Add a calibration section after the existing cell/output data:

```
[existing header + cells + outputs]
[calibration marker: "CAL\0" (4 bytes)]
[calibration_count: uint8_t]
For each calibrated output:
  [output_index: uint8_t]
  [point_count: uint8_t]
  For each point:
    [target_voltage: f64]
    [raw_value: u16]
```

The `FLASH_FORMAT_VERSION` increments to 2. Version-1 readers skip the calibration section (it comes after their expected data).

---

## 4. Estimated Effort Split

### Feature A: Hardware Buttons/Toggles to User Code

| Work item | Side | Effort |
|---|---|---|
| Add debounce + edge detection to `HardwareIO` | Firmware | S (1-2 days) |
| Emit `hw-event` messages from `SerialProtocol` | Firmware | S (1 day) |
| Wire protocol spec update | Docs | XS (half day) |
| Add remaining input symbols to `resolve_hardware_input()` | Firmware | S (1 day) |
| Parse `hw-event` in editor stream parser | Editor | S (1 day) |
| Route events to a typed channel (new `hwEventChannel`) | Editor | S (1 day) |
| UI affordance: binding panel / event display | Editor | M (2-3 days) |
| **Total** | | **~7-9 days** |

**Split: ~60% firmware, ~40% editor.**

### Feature B: CV Calibration + Flash

| Work item | Side | Effort |
|---|---|---|
| Flash format v2 with calibration table section | Firmware | M (2 days) |
| Calibration table application in `write_outputs()` (piecewise-linear lookup) | Firmware | S (1-2 days) |
| Calibration mode state (per-output takeover flag + raw write) | Firmware | S (1-2 days) |
| `calibrate` message handler in `SerialProtocol` | Firmware | M (2 days) |
| Wire protocol spec update | Docs | S (1 day) |
| Editor: calibration wizard UI (step-by-step voltage set + confirm) | Editor | L (3-5 days) |
| Editor: wire-protocol integration for calibrate messages | Editor | S (1 day) |
| Testing: round-trip flash save/load with calibration data | Firmware | S (1-2 days) |
| **Total** | | **~12-16 days** |

**Split: ~65% firmware, ~35% editor.**

---

## 5. Key Design Decisions Required

### Feature A

1. **Should events be opportunistic or must-deliver?** Recommendation: opportunistic (same as stream frames). Missed button events degrade UX but don't corrupt state.

2. **Should the firmware maintain event history?** Recommendation: no. Emit-and-forget. The editor maintains its own event log if needed.

3. **Graph-level vs event-level binding?** The existing `(swm 1)` polling approach (continuous signal) is different from a discrete "on press, do X" paradigm. Both should coexist: continuous polling for signal use, discrete events for editor-side binding.

### Feature B

1. **How many calibration points per output?** Recommendation: 6 points (0V, 1V, 2V, 3V, 4V, 5V) with piecewise-linear interpolation between them.

2. **Who measures the actual voltage?** The firmware cannot self-measure. The calibration wizard UI must instruct the user to connect a multimeter and confirm each point.

3. **Should calibration survive firmware updates?** If the flash format version changes, calibration data should be preserved (or at minimum, detected as present and migrated). Store calibration in a separate flash region from signal-engine state.

---

## 6. Firmware Source References

| File | What it does |
|---|---|
| `src-useq/uSEQ/src/firmware/hardware_io.{h,cpp}` | Pin access, input sampling, output writing |
| `src-useq/uSEQ/src/firmware/serial_protocol.{h,cpp}` | Wire protocol handler |
| `src-useq/uSEQ/src/firmware/flash_storage.{h,cpp}` | Persistence to RP2040 flash |
| `src-useq/uSEQ/src/firmware/firmware.{h,cpp}` | Composition root + tick loop |
| `src-useq/uSEQ/src/signal_engine/graph_builder.cpp` | `resolve_hardware_input()` — input symbol → index |
| `src-useq/uSEQ/src/signal_engine/executor.cpp` | `NodeOp::InputLoad` — reads `hw_inputs[imm]` |
| `src-useq/uSEQ/src/uSEQ/configure.h` | `useqInputNames` enum, feature flags |
| `src-useq/docs/specs/wire-protocol.md` | Protocol spec (single source of truth) |
| `src-useq/docs/specs/firmware.md` | Firmware architecture spec |
| `src-useq/docs/specs/inputs.md` | Input language surface spec |
| `src-useq/docs/specs/outputs.md` | Output language surface spec |
