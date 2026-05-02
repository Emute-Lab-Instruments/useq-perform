/**
 * Hardware-binding inline chip stories (gii8.56).
 *
 * Spec: docs/specs/hardware-bindings.md
 *
 * Each story renders a tiny ModuLisp document containing one or more
 * `(on-press ...)` / `(on-release ...)` / `(on-button ...)` / `(on-toggle ...)`
 * forms. The `bindingChips` array tells the harness which source ranges to
 * fold into the inline chip widget, plus the live-state metadata that drives
 * the visual.
 *
 * Note: §5 specifies a click-and-hold gesture for test-fire. For this
 * visual-first storybook pass the chip is interactive (cursor: pointer) but
 * does not simulate hold; click-fires are stubbed to a callback and not wired
 * up here.
 */
import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { ScenarioEditor } from '../../harness/ScenarioEditor';
import type { BindingChip } from '@src/contracts/hardware';

const meta: Meta<typeof ScenarioEditor> = {
  title: 'Editor/HardwareBindings',
  tags: ['autodocs'],
  component: ScenarioEditor,
};
export default meta;
type Story = StoryObj<typeof ScenarioEditor>;

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Find the source range of the first occurrence of `prefix` to its matching `)`. */
function rangeOfWrapper(content: string, prefix: string): { from: number; to: number } {
  const from = content.indexOf(prefix);
  if (from < 0) throw new Error(`prefix not found: ${prefix}`);
  let depth = 0;
  for (let i = from; i < content.length; i++) {
    const c = content[i];
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return { from, to: i + 1 };
    }
  }
  throw new Error(`unbalanced parens after: ${prefix}`);
}

const NEVER = 0;
const NOW = (): number => performance.now();

// ─── Stories ────────────────────────────────────────────────────────────────

const idleSwitchSrc = '(on-press :sw1 (mute :a1))';

export const IdleSwitch: Story = {
  args: {
    editorContent: idleSwitchSrc,
    extensions: ['hardware-bindings'],
    bindingChips: [
      {
        inputId: ':sw1',
        inputKind: 'switch',
        event: 'on-press',
        range: rangeOfWrapper(idleSwitchSrc, '(on-press'),
        lastFireMs: NEVER,
        disabled: false,
      } satisfies BindingChip,
    ],
  },
};

const justFiredSrc = '(on-press :sw2 (advance-step))';

export const JustFiredSwitch: Story = {
  args: {
    editorContent: justFiredSrc,
    extensions: ['hardware-bindings'],
    bindingChips: [
      {
        inputId: ':sw2',
        inputKind: 'switch',
        event: 'on-press',
        range: rangeOfWrapper(justFiredSrc, '(on-press'),
        // Pulse just-started — the keyframe runs once.
        lastFireMs: NOW(),
        disabled: false,
      } satisfies BindingChip,
    ],
  },
};

const lifecycleSrc =
  '(on-button :sw1 (lambda (phase ms) (mute-while-held :a1 phase)))';

export const OnButtonLifecyclePress: Story = {
  args: {
    editorContent: lifecycleSrc,
    extensions: ['hardware-bindings'],
    bindingChips: [
      {
        inputId: ':sw1',
        inputKind: 'switch',
        event: 'on-button',
        range: rangeOfWrapper(lifecycleSrc, '(on-button'),
        lastFireMs: NEVER,
        lastPhase: 'press',
        disabled: false,
      } satisfies BindingChip,
    ],
  },
};

export const OnButtonLifecycleHold: Story = {
  args: {
    editorContent: lifecycleSrc,
    extensions: ['hardware-bindings'],
    bindingChips: [
      {
        inputId: ':sw1',
        inputKind: 'switch',
        event: 'on-button',
        range: rangeOfWrapper(lifecycleSrc, '(on-button'),
        lastFireMs: NEVER,
        lastPhase: 'hold',
        disabled: false,
      } satisfies BindingChip,
    ],
  },
};

export const OnButtonLifecycleRelease: Story = {
  args: {
    editorContent: lifecycleSrc,
    extensions: ['hardware-bindings'],
    bindingChips: [
      {
        inputId: ':sw1',
        inputKind: 'switch',
        event: 'on-button',
        range: rangeOfWrapper(lifecycleSrc, '(on-button'),
        lastFireMs: NEVER,
        lastPhase: 'release',
        disabled: false,
      } satisfies BindingChip,
    ],
  },
};

const encoderSrc = '(on-press :swr (commit-knob))';

export const EncoderClick: Story = {
  args: {
    editorContent: encoderSrc,
    extensions: ['hardware-bindings'],
    bindingChips: [
      {
        inputId: ':swr',
        inputKind: 'encoder-click',
        event: 'on-press',
        range: rangeOfWrapper(encoderSrc, '(on-press'),
        lastFireMs: NEVER,
        disabled: false,
      } satisfies BindingChip,
    ],
  },
};

const gateSrc = '(on-press :in1 (trigger-snare))';

export const GateInput: Story = {
  args: {
    editorContent: gateSrc,
    extensions: ['hardware-bindings'],
    bindingChips: [
      {
        inputId: ':in1',
        inputKind: 'gate',
        event: 'on-press',
        range: rangeOfWrapper(gateSrc, '(on-press'),
        lastFireMs: NEVER,
        disabled: false,
      } satisfies BindingChip,
    ],
  },
};

const errorSrc = '(on-press :sw3 (broken-fn))';

export const ErrorChip: Story = {
  args: {
    editorContent: errorSrc,
    extensions: ['hardware-bindings'],
    bindingChips: [
      {
        inputId: ':sw3',
        inputKind: 'switch',
        event: 'on-press',
        range: rangeOfWrapper(errorSrc, '(on-press'),
        lastFireMs: NEVER,
        error: "Symbol 'broken-fn' is not defined",
        disabled: false,
      } satisfies BindingChip,
    ],
  },
};

const disabledSrc = '(on-toggle :sw4 (lambda (state) (set-mute :a1 state)))';

export const DisabledChip: Story = {
  args: {
    editorContent: disabledSrc,
    extensions: ['hardware-bindings'],
    bindingChips: [
      {
        inputId: ':sw4',
        inputKind: 'toggle',
        event: 'on-toggle',
        range: rangeOfWrapper(disabledSrc, '(on-toggle'),
        lastFireMs: NEVER,
        disabled: true,
      } satisfies BindingChip,
    ],
  },
};

const mixedSrc = [
  '(on-press :sw1 (mute :a1))',
  '(on-toggle :sw2 (lambda (s) (set-fx s)))',
  '(on-button :sw3 (lambda (phase ms) (sweep phase ms)))',
  '(on-press :swr (commit-knob))',
  '(on-press :in1 (trig-kick))',
].join('\n');

export const MultipleChipsMixed: Story = {
  args: {
    editorContent: mixedSrc,
    extensions: ['hardware-bindings'],
    bindingChips: [
      {
        inputId: ':sw1',
        inputKind: 'switch',
        event: 'on-press',
        range: rangeOfWrapper(mixedSrc, '(on-press :sw1'),
        lastFireMs: NEVER,
        disabled: false,
      },
      {
        inputId: ':sw2',
        inputKind: 'toggle',
        event: 'on-toggle',
        range: rangeOfWrapper(mixedSrc, '(on-toggle :sw2'),
        lastFireMs: NOW(),
        disabled: false,
      },
      {
        inputId: ':sw3',
        inputKind: 'switch',
        event: 'on-button',
        range: rangeOfWrapper(mixedSrc, '(on-button :sw3'),
        lastFireMs: NEVER,
        lastPhase: 'hold',
        disabled: false,
      },
      {
        inputId: ':swr',
        inputKind: 'encoder-click',
        event: 'on-press',
        range: rangeOfWrapper(mixedSrc, '(on-press :swr'),
        lastFireMs: NEVER,
        error: 'commit-knob raised: no active knob',
        disabled: false,
      },
      {
        inputId: ':in1',
        inputKind: 'gate',
        event: 'on-press',
        range: rangeOfWrapper(mixedSrc, '(on-press :in1'),
        lastFireMs: NEVER,
        disabled: true,
      },
    ] satisfies BindingChip[],
  },
};
