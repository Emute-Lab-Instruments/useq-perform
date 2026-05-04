// stories/menus/radial-menu.stories.tsx
//
// Storybook coverage for the gamepad-driven radial menu (G4 of epic
// useq-perform-4zt.69). One story per sub-phase + one per sub-mode +
// auto-chain demo + a live story driven by a real gamepad.
//
// Stories 1-9 are deterministic: each renders `<RadialMenu>` with a fixed
// `MenuState` fixture built inline. Story 10 wires up the A4 `withGamepad`
// decorator and shims face presses into `dispatchMenuInput` so the live
// store drives the menu — full radial paradigm wiring is H2 territory.
//
// CenterPanel is mounted via the `previewSlot` prop with the same state +
// manifest as the radial.

import type { Meta, StoryObj } from "storybook-solidjs-vite";
import {
  createSignal,
  createEffect,
  onCleanup,
  type JSX,
} from "solid-js";

import { RadialMenu } from "@src/ui/menu/RadialMenu";
import { CenterPanel } from "@src/ui/menu/CenterPanel";
import {
  loadManifest,
  type ManifestError,
} from "@src/lib/menu/manifest";
import manifestJson from "@src/lib/menu/manifest.json";
import {
  menuState,
  dispatchMenuInput,
} from "@src/lib/menu/store";
import type {
  ApplyTarget,
  CategoryId,
  ItemId,
  Manifest,
  MenuItem,
  MenuState,
  MenuStateOpen,
  TabId,
  Verb,
} from "@src/lib/menu/types";
import { withGamepad } from "../_decorators/withGamepad";

// ---------------------------------------------------------------------------
// Manifest fixture
// ---------------------------------------------------------------------------
//
// Try the real `loadManifest` from src/lib/menu against the v1 stub JSON.
// If lint fails for any reason (shouldn't, but the loader is opinionated),
// fall back to a tiny inline manifest so stories keep rendering. Documented
// per task requirement.

const FALLBACK_MANIFEST: Manifest = {
  version: 1,
  tabs: [
    {
      id: "sound" as TabId,
      label: "Sound",
      categories: [
        {
          id: "oscillators" as CategoryId,
          label: "Oscillators",
          items: [
            {
              kind: "function",
              id: "fn.saw" as ItemId,
              label: "saw",
              head: "saw",
              signature: [{ name: "freq", type: "number" }],
            },
            {
              kind: "function",
              id: "fn.sine" as ItemId,
              label: "sine",
              head: "sine",
              signature: [{ name: "freq", type: "number" }],
            },
          ],
        },
        {
          id: "envelopes" as CategoryId,
          label: "Envelopes",
          items: [
            {
              kind: "function",
              id: "fn.env" as ItemId,
              label: "env",
              head: "env",
              signature: [
                { name: "attack", type: "number" },
                { name: "release", type: "number" },
                { name: "body", type: "expr" },
              ],
            },
          ],
        },
      ],
    },
  ],
};

function loadOrFallback(): Manifest {
  const result = loadManifest(manifestJson);
  if (result.ok) return result.value;
  // Fallback: log loader errors so the dev sees them in the Storybook console
  // but keep the story renderable from the inline stub.
  // eslint-disable-next-line no-console
  console.warn(
    "[radial-menu.stories] manifest load failed, using fallback:",
    result.errors.map((e: ManifestError) => `${e.path}: ${e.message}`),
  );
  return FALLBACK_MANIFEST;
}

const MANIFEST: Manifest = loadOrFallback();

// ---------------------------------------------------------------------------
// Shared fixture builders
// ---------------------------------------------------------------------------
//
// Concrete IDs used by the frozen / sub-mode fixtures. Resolved against the
// loaded manifest so the stories stay in sync if the JSON changes.

const FIRST_TAB = MANIFEST.tabs[0];
const FIRST_CATEGORY = FIRST_TAB?.categories[0];
const FIRST_ITEM = FIRST_CATEGORY?.items[0];
const SECOND_CATEGORY = FIRST_TAB?.categories[1];
const SECOND_ITEM = SECOND_CATEGORY?.items[0];

// `ApplyTarget` is opaque (branded marker) — stories don't reach inside.
const STUB_TARGET = {} as ApplyTarget;

const INSERT_LEFT: Verb = { kind: "insert", hand: "left" };
const REPLACE_RIGHT: Verb = { kind: "replace", hand: "right" };

/** Closed state. */
function makeClosed(): MenuState {
  return { phase: "closed" };
}

/** Open + cycling-left-tabs (no stick movement yet). */
function makeCyclingLeftTabs(): MenuStateOpen {
  return {
    phase: "open",
    leftTabIdx: 0,
    rightTabIdx: 0,
    leftHover: null,
    rightHover: null,
    shoulderHeld: "none",
    frozen: null,
    target: STUB_TARGET,
    manifest: MANIFEST,
  };
}

/** Open + cycling-right-tabs (left ring engaged, right ring centred). */
function makeCyclingRightTabs(): MenuStateOpen {
  return {
    phase: "open",
    leftTabIdx: 0,
    rightTabIdx: 0,
    leftHover: 0,
    rightHover: null,
    shoulderHeld: "none",
    frozen: null,
    target: STUB_TARGET,
    manifest: MANIFEST,
  };
}

/** Open + picking (both rings hovering an item). */
function makePicking(): MenuStateOpen {
  return {
    phase: "open",
    leftTabIdx: 0,
    rightTabIdx: 0,
    leftHover: 0,
    rightHover: 0,
    shoulderHeld: "none",
    frozen: null,
    target: STUB_TARGET,
    manifest: MANIFEST,
  };
}

/** Open + frozen-left (LB held, snapshot latched). */
function makeFrozenLeft(): MenuStateOpen {
  return {
    phase: "open",
    leftTabIdx: 0,
    rightTabIdx: 0,
    leftHover: 0,
    rightHover: 0,
    shoulderHeld: "left",
    frozen: {
      leftTabIdx: 0,
      leftPicked: (FIRST_CATEGORY?.id ?? "oscillators") as CategoryId,
      rightTabIdx: 0,
      rightPicked: (FIRST_ITEM?.id ?? "fn.saw") as ItemId,
    },
    target: STUB_TARGET,
    manifest: MANIFEST,
  };
}

/** Open + frozen-right (RB held). */
function makeFrozenRight(): MenuStateOpen {
  return {
    phase: "open",
    leftTabIdx: 0,
    rightTabIdx: 0,
    leftHover: 0,
    rightHover: 0,
    shoulderHeld: "right",
    frozen: {
      leftTabIdx: 0,
      leftPicked: (FIRST_CATEGORY?.id ?? "oscillators") as CategoryId,
      rightTabIdx: 0,
      rightPicked: (FIRST_ITEM?.id ?? "fn.saw") as ItemId,
    },
    target: STUB_TARGET,
    manifest: MANIFEST,
  };
}

/** Numpad sub-mode with a partial buffer ("12."). */
function makeNumpad(): MenuState {
  return {
    phase: "numpad",
    buffer: "12.",
    target: STUB_TARGET,
    returnTo: "open",
    activeVerb: INSERT_LEFT,
  };
}

/** T9 sub-mode with a partial buffer ("ab") and lastKey set. */
function makeT9(): MenuState {
  return {
    phase: "t9",
    buffer: "ab",
    lastKey: "2",
    lastKeyAt: 0,
    caseMode: "lower",
    target: STUB_TARGET,
    returnTo: "open",
    activeVerb: INSERT_LEFT,
  };
}

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------

interface FrameProps {
  readonly state: MenuState;
}

/**
 * Render the radial + a CenterPanel-fed previewSlot for a fixed state. The
 * CenterPanel resolves `hoveredItem` and `currentVerb` from the state itself,
 * so the closure here is small.
 */
function Frame(props: FrameProps): JSX.Element {
  return (
    <RadialMenu
      state={props.state}
      manifest={MANIFEST}
      previewSlot={
        <CenterPanel
          state={props.state}
          manifest={MANIFEST}
          hoveredItem={resolveHoveredItem(props.state)}
          currentVerb={resolveCurrentVerb(props.state)}
          previewTree={null}
        />
      }
    />
  );
}

function resolveHoveredItem(state: MenuState): MenuItem | null {
  if (state.phase !== "open") return null;
  const tab = state.manifest.tabs[state.leftTabIdx];
  if (!tab) return null;

  if (state.frozen !== null) {
    const cat = tab.categories.find((c) => c.id === state.frozen!.leftPicked);
    return (
      cat?.items.find((i) => i.id === state.frozen!.rightPicked) ?? null
    );
  }
  if (state.leftHover === null || state.rightHover === null) return null;
  const cat = tab.categories[state.leftHover];
  if (!cat) return null;
  return cat.items[state.rightHover] ?? null;
}

function resolveCurrentVerb(state: MenuState): Verb | null {
  if (state.phase !== "open") return null;
  if (state.frozen === null) return null;
  // Frozen-left → Insert(left); frozen-right → Replace(right). Just enough to
  // exercise the breadcrumb's verb tag in stories.
  if (state.shoulderHeld === "left") return INSERT_LEFT;
  if (state.shoulderHeld === "right") return REPLACE_RIGHT;
  return null;
}

// ---------------------------------------------------------------------------
// Storybook meta
// ---------------------------------------------------------------------------

const meta: Meta = {
  title: "Menus/RadialMenu",
  tags: ["gamepad", "radial-menus"],
  parameters: { layout: "fullscreen" },
};
export default meta;
type Story = StoryObj;

// ---------------------------------------------------------------------------
// 1. Closed
// ---------------------------------------------------------------------------

export const Closed: Story = {
  name: "1 · Closed",
  render: () => <Frame state={makeClosed()} />,
};

// ---------------------------------------------------------------------------
// 2. CyclingLeftTabs
// ---------------------------------------------------------------------------

export const CyclingLeftTabs: Story = {
  name: "2 · CyclingLeftTabs",
  render: () => <Frame state={makeCyclingLeftTabs()} />,
};

// ---------------------------------------------------------------------------
// 3. Picking
// ---------------------------------------------------------------------------

export const Picking: Story = {
  name: "3 · Picking",
  render: () => <Frame state={makePicking()} />,
};

// ---------------------------------------------------------------------------
// 4. Frozen left
// ---------------------------------------------------------------------------

export const FrozenLeft: Story = {
  name: "4 · FrozenLeft (LB held)",
  render: () => <Frame state={makeFrozenLeft()} />,
};

// ---------------------------------------------------------------------------
// 5. Frozen right
// ---------------------------------------------------------------------------

export const FrozenRight: Story = {
  name: "5 · FrozenRight (RB held)",
  render: () => <Frame state={makeFrozenRight()} />,
};

// ---------------------------------------------------------------------------
// 6. CyclingRightTabs
// ---------------------------------------------------------------------------

export const CyclingRightTabs: Story = {
  name: "6 · CyclingRightTabs",
  render: () => <Frame state={makeCyclingRightTabs()} />,
};

// ---------------------------------------------------------------------------
// 7. AutoChain demo
// ---------------------------------------------------------------------------
//
// Story controls walk through a 3-step sequence:
//   step 0 → open / picking
//   step 1 → frozen + verb hint visible (simulates the user holding LB)
//   step 2 → closed (verb fired, chain advances; in real auto-chain the next
//            hole would re-open the menu — we illustrate "reopen on hole" by
//            looping back to step 0 with the second category/item picked).
//
// No real verbs are fired; the stepper just updates a local `MenuState`
// signal so the renderer reflects the visited states.

const AUTO_CHAIN_STEPS = [
  "1/3 · open · picking",
  "2/3 · frozen (LB) · verb hint visible",
  "3/3 · closed · ready to re-open on next hole",
] as const;

function makeAutoChainStep(step: number): MenuState {
  switch (step) {
    case 0:
      return makePicking();
    case 1:
      return makeFrozenLeft();
    case 2:
      return makeClosed();
    case 3: {
      // Loop: re-open with second category/item to illustrate "reopen on hole"
      const reopened: MenuStateOpen = {
        phase: "open",
        leftTabIdx: 0,
        rightTabIdx: 0,
        leftHover: 1,
        rightHover: 0,
        shoulderHeld: "none",
        frozen: null,
        target: STUB_TARGET,
        manifest: MANIFEST,
      };
      return SECOND_CATEGORY && SECOND_ITEM ? reopened : makePicking();
    }
    default:
      return makeClosed();
  }
}

const STEPPER_BAR_STYLE: JSX.CSSProperties = {
  position: "fixed",
  top: "8px",
  left: "50%",
  transform: "translateX(-50%)",
  "z-index": "2147483647",
  display: "flex",
  gap: "8px",
  padding: "8px 12px",
  "border-radius": "8px",
  background: "rgba(0, 0, 0, 0.7)",
  color: "white",
  "font-family": "ui-monospace, monospace",
  "font-size": "12px",
  "align-items": "center",
};

const STEPPER_BTN_STYLE: JSX.CSSProperties = {
  background: "rgba(255,255,255,0.1)",
  color: "white",
  border: "1px solid rgba(255,255,255,0.3)",
  "border-radius": "4px",
  padding: "4px 10px",
  cursor: "pointer",
  "font-family": "inherit",
  "font-size": "inherit",
};

export const AutoChainDemo: Story = {
  name: "7 · AutoChainDemo",
  render: () => {
    const [step, setStep] = createSignal(0);
    const cycleStep = () =>
      setStep((s) => (s + 1) % (AUTO_CHAIN_STEPS.length + 1));
    const resetStep = () => setStep(0);
    return (
      <>
        <div style={STEPPER_BAR_STYLE}>
          <span>
            Step {Math.min(step(), AUTO_CHAIN_STEPS.length - 1) + 1}/
            {AUTO_CHAIN_STEPS.length}:{" "}
            {AUTO_CHAIN_STEPS[
              Math.min(step(), AUTO_CHAIN_STEPS.length - 1)
            ]}
          </span>
          <button style={STEPPER_BTN_STYLE} onClick={cycleStep}>
            Next →
          </button>
          <button style={STEPPER_BTN_STYLE} onClick={resetStep}>
            Reset
          </button>
        </div>
        <Frame state={makeAutoChainStep(step())} />
      </>
    );
  },
};

// ---------------------------------------------------------------------------
// 8. Numpad sub-mode
// ---------------------------------------------------------------------------

export const NumpadSubMode: Story = {
  name: "8 · NumpadSubMode",
  render: () => <Frame state={makeNumpad()} />,
};

// ---------------------------------------------------------------------------
// 9. T9 sub-mode
// ---------------------------------------------------------------------------

export const T9SubMode: Story = {
  name: "9 · T9SubMode",
  render: () => <Frame state={makeT9()} />,
};

// ---------------------------------------------------------------------------
// 10. Live (real gamepad)
// ---------------------------------------------------------------------------
//
// Uses the A4 `withGamepad` decorator so the real recogniser pipeline is
// running. The modal-shift paradigm fires action IDs (not menu inputs), so
// this story installs a tiny shim: a pair of on-screen buttons trigger
// `dispatchMenuInput({ kind: 'open', ... })` and `dispatchMenuInput({ kind:
// 'cancel' })` to mimic the radial open/close edges. Once H1 (the dispatcher
// that drives the menu store from gamepad events) lands, those buttons can
// be removed and the real bumper presses will drive the store directly.
//
// Caveat: face presses *within* the menu are not yet wired in this v1
// shim — that is H2's job. The Live story is here to verify the
// withGamepad decorator + menuStore wiring works end-to-end.

const LIVE_BUTTON_BAR_STYLE: JSX.CSSProperties = {
  position: "fixed",
  bottom: "32px",
  left: "8px",
  "z-index": "2147483647",
  display: "flex",
  gap: "8px",
  padding: "8px 12px",
  "border-radius": "8px",
  background: "rgba(0, 0, 0, 0.7)",
  color: "white",
  "font-family": "ui-monospace, monospace",
  "font-size": "11px",
};

function LiveStoryBody(): JSX.Element {
  // Local accessor mirrors the live store; the decorator handles the gamepad
  // pipeline lifecycle.
  const [snapshot, setSnapshot] = createSignal<MenuState>(menuState());

  // Bridge: poll the menu store every frame and mirror it locally so the
  // story re-renders on dispatch. (Avoids leaking Solid scopes by using
  // `createEffect` with onCleanup instead of a manual setInterval.)
  createEffect(() => {
    const tick = () => setSnapshot(menuState());
    let raf = requestAnimationFrame(function loop() {
      tick();
      raf = requestAnimationFrame(loop);
    });
    onCleanup(() => cancelAnimationFrame(raf));
  });

  const openShim = () =>
    dispatchMenuInput({
      kind: "open",
      target: STUB_TARGET,
      manifest: MANIFEST,
    });
  const cancelShim = () => dispatchMenuInput({ kind: "cancel" });

  return (
    <>
      <div style={LIVE_BUTTON_BAR_STYLE}>
        <span>shim:</span>
        <button style={STEPPER_BTN_STYLE} onClick={openShim}>
          face A → open
        </button>
        <button style={STEPPER_BTN_STYLE} onClick={cancelShim}>
          face B → cancel
        </button>
        <span style={{ opacity: "0.7" }}>
          (real bumper / face wiring lands in H1+H2)
        </span>
      </div>
      <Frame state={snapshot()} />
    </>
  );
}

export const Live: Story = {
  name: "10 · Live (real gamepad)",
  decorators: [withGamepad({ paradigm: "modal-shift" })],
  render: () => <LiveStoryBody />,
};
