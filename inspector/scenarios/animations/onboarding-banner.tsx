import { defineScenario } from '../../framework/scenario';

/**
 * The onboarding banner appears below the toolbar for first-time users.
 * It uses onboarding-fade-in (0.3s ease-out, slide down from -6px).
 * This scenario renders a static DOM mock with the correct CSS classes
 * since the OnboardingBanner component is coupled to runtimeService.
 */

function OnboardingBannerStatic() {
  return (
    <div style={{
      position: 'relative',
      width: '100%',
      height: '100%',
      background: '#0d0d1a',
    }}>
      {/* Simulated toolbar area */}
      <div style={{
        height: '48px',
        background: 'rgba(30,30,30,0.6)',
        "border-bottom": '1px solid rgba(255,255,255,0.06)',
      }} />

      {/* Banner with animation frozen at end state */}
      <div
        class="onboarding-banner"
        style={{
          position: 'absolute',
          top: '48px',
          right: '10px',
          "animation-play-state": 'paused',
          "animation-delay": '-0.3s',
        }}
      >
        <div class="onboarding-banner__text">
          <strong>Welcome to uSEQ Perform!</strong>{' '}
          Connect your hardware or use the built-in WASM interpreter to start live coding.
        </div>
        <button class="onboarding-banner__dismiss">Got it</button>
      </div>
    </div>
  );
}

export default defineScenario({
  category: 'Animations & Transitions / Onboarding Banner',
  name: 'First-run banner',
  type: 'canary',
  sourceFiles: [
    'src/ui/styles/onboarding.css',
  ],
  grepTerms: [
    '.onboarding-banner',
    '.onboarding-banner__text',
    '.onboarding-banner__dismiss',
    '@keyframes onboarding-fade-in',
  ],
  description:
    'Onboarding banner for first-time users, frozen after its fade-in animation. ' +
    'Verify the banner is positioned below the toolbar area, shows accent-colored ' +
    'strong text, has a dismiss button with hover styling, and uses the correct ' +
    'panel background with backdrop blur. Animation: onboarding-fade-in (0.3s ' +
    'ease-out, slide down from -6px).',
  component: {
    render: () => <OnboardingBannerStatic />,
    loadAppStyles: true,
    width: 500,
    height: 200,
  },
});
