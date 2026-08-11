import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { onMount, onCleanup } from 'solid-js';
import { OnboardingBanner } from '@src/ui/OnboardingBanner';
import { resetRuntimeServiceForTests } from '@src/runtime/runtimeService';
import { updateRuntimeSessionState } from '@src/runtime/runtimeCoordinator';
import { remove, PERSISTENCE_KEYS } from '@src/lib/persistence';

/**
 * Force the disconnected ("none") connection mode and clear the
 * dismissal flag so the banner is visible. The banner subscribes to
 * runtimeService and renders when both `dismissed` and `connected` are false.
 */
function BannerWithDisconnectedRuntime() {
  onMount(() => {
    remove(PERSISTENCE_KEYS.onboardingDismissed);
    updateRuntimeSessionState({
      hasHardwareConnection: false,
      noModuleMode: false,
      wasmEnabled: false,
    });
  });
  onCleanup(() => {
    resetRuntimeServiceForTests();
  });
  return (
    <div style={{ position: 'relative', width: '100%', 'min-height': '200px', padding: '16px' }}>
      <div style={{ color: 'rgba(255,255,255,0.4)', 'font-family': 'monospace', 'font-size': '12px' }}>
        Toolbar area (banner anchors to the top-right of the viewport)
      </div>
      <OnboardingBanner />
    </div>
  );
}

/** Banner pre-dismissed: should render nothing. */
function BannerDismissed() {
  onMount(() => {
    updateRuntimeSessionState({
      hasHardwareConnection: false,
      noModuleMode: false,
      wasmEnabled: false,
    });
  });
  onCleanup(() => {
    resetRuntimeServiceForTests();
    remove(PERSISTENCE_KEYS.onboardingDismissed);
  });
  return (
    <div style={{ width: '100%', 'min-height': '200px', padding: '16px' }}>
      <div style={{ color: 'rgba(255,255,255,0.4)', 'font-family': 'monospace', 'font-size': '12px' }}>
        Banner is hidden after the user clicks "Dismiss" — interact with the
        Disconnected story above to see it disappear.
      </div>
    </div>
  );
}

/** Banner with a "browser" mode (wasm enabled) — should render nothing. */
function BannerConnectedBrowser() {
  onMount(() => {
    remove(PERSISTENCE_KEYS.onboardingDismissed);
    updateRuntimeSessionState({
      hasHardwareConnection: false,
      noModuleMode: false,
      wasmEnabled: true,
    });
  });
  onCleanup(() => {
    resetRuntimeServiceForTests();
  });
  return (
    <div style={{ width: '100%', 'min-height': '200px', padding: '16px' }}>
      <div style={{ color: 'rgba(255,255,255,0.4)', 'font-family': 'monospace', 'font-size': '12px' }}>
        wasmEnabled = true → connectionMode = "browser" → banner is hidden.
      </div>
      <OnboardingBanner />
    </div>
  );
}

const meta: Meta = {
  title: 'Onboarding/Banner',
  tags: ['autodocs'],
};
export default meta;
type Story = StoryObj;

/**
 * The banner appears whenever `connectionMode === "none"` and the user has
 * not previously dismissed it. We force that state by toggling
 * runtimeService inputs.
 */
export const Disconnected: Story = {
  render: () => <BannerWithDisconnectedRuntime />,
};

/** Hidden when wasm fallback is enabled (browser mode). */
export const BrowserMode: Story = {
  render: () => <BannerConnectedBrowser />,
};

/** Reference state: dismissed banner. Shown for completeness — should not render the banner. */
export const Dismissed: Story = {
  render: () => <BannerDismissed />,
};
