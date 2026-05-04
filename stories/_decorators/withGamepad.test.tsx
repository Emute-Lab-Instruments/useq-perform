// stories/_decorators/withGamepad.test.tsx
//
// Basic sanity tests for the `withGamepad` Storybook decorator factory.
//
// Note: `stories/**` is not currently in the unit-test Vitest glob (see
// `vite.config.ts` `unit.include`), so this file primarily serves as a
// typecheck/regression artefact. It is, however, also directly runnable
// with `vitest run stories/_decorators/withGamepad.test.tsx --project unit`
// if you point Vitest at it explicitly.

import { describe, it, expect } from "vitest";
import { render } from "@solidjs/testing-library";

import { withGamepad } from "./withGamepad";

describe("withGamepad", () => {
  it("returns a decorator function", () => {
    const decorator = withGamepad({ paradigm: "modal-shift" });
    expect(typeof decorator).toBe("function");
  });

  it("renders the wrapped story children", () => {
    const decorator = withGamepad();
    // Storybook's decorator signature: (Story, ctx) => JSX. The decorator
    // should call `Story()` to obtain the story's rendered output. We pass
    // a stub story function and a minimal context cast.
    const storyFn = () => <span data-testid="child">hello</span>;
    const ctx = {} as Parameters<typeof decorator>[1];

    const { getByTestId } = render(() => decorator(storyFn, ctx) as never);
    expect(getByTestId("child").textContent).toBe("hello");
  });

  it("shows a 'not connected' pill when no gamepads are present", () => {
    const decorator = withGamepad();
    const storyFn = () => <span>story</span>;
    const ctx = {} as Parameters<typeof decorator>[1];

    const { getByTestId } = render(() => decorator(storyFn, ctx) as never);
    const pill = getByTestId("gamepad-status-pill");
    // jsdom has no `navigator.getGamepads`, so the snapshot should be null
    // and the fallback "not connected" branch should render.
    expect(pill.textContent).toContain("not connected");
  });
});
