import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { ScenarioEditor } from '../../harness/ScenarioEditor';

const meta: Meta<typeof ScenarioEditor> = {
  title: 'Editor/Structure Highlights',
  tags: ['autodocs'],
  component: ScenarioEditor,
};
export default meta;
type Story = StoryObj<typeof ScenarioEditor>;

export const NestedExpressions: Story = {
  args: {
    editorContent: '(+ (* 2 3) (- 10 (/ 8 4)))',
    extensions: ['structure-highlight'],
    cursorPosition: 4,
  },
};

export const TopLevelForms: Story = {
  args: {
    editorContent: '(define freq 440)\n(define amp 0.5)\n(sine freq amp)',
    extensions: ['structure-highlight'],
    cursorPosition: 0,
  },
};

export const CursorAtParenBoundary: Story = {
  args: {
    editorContent: '(+ 1 2)(* 3 4)',
    extensions: ['structure-highlight'],
    cursorPosition: 7,
  },
};

export const CursorAtDocumentEnd: Story = {
  args: {
    editorContent: '(sine 440)\n(tri 220)',
    extensions: ['structure-highlight'],
    cursorPosition: 20,
  },
};

export const DeepNesting: Story = {
  args: {
    editorContent: '(a (b (c (d (e 42)))))',
    extensions: ['structure-highlight'],
    cursorPosition: 15,
  },
};

export const EmptyList: Story = {
  args: {
    editorContent: '(define x ())\n(define y (list 1 2))',
    extensions: ['structure-highlight'],
    cursorPosition: 11,
  },
};

export const BareAtom: Story = {
  args: {
    editorContent: 'freq\n(sine freq 0.5)',
    extensions: ['structure-highlight'],
    cursorPosition: 2,
  },
};

export const AdjacentSiblings: Story = {
  args: {
    editorContent: '(+ (sine 440) (tri 220) (saw 110))',
    extensions: ['structure-highlight'],
    cursorPosition: 18,
  },
};

export const MultiLineExpression: Story = {
  args: {
    editorContent: `(define my-synth
  (let ((freq 440)
        (amp 0.5)
        (mod (sine 2)))
    (* amp
       (sine (* freq
                (+ 1 (* 0.01 mod)))))))`,
    extensions: ['structure-highlight'],
    cursorPosition: 20,
  },
};

export const StaircaseIndentation: Story = {
  args: {
    editorContent: `(if (> x 10)
  (begin
    (set! a 1)
    (set! b 2)
    (set! c 3))
  (begin
    (set! a 0)
    (set! b 0)))`,
    extensions: ['structure-highlight'],
    cursorPosition: 16,
  },
};

export const StringWithParentheses: Story = {
  args: {
    editorContent: '(define msg "hello (world)")\n(print msg)',
    extensions: ['structure-highlight'],
    cursorPosition: 15,
  },
};

export const RealUseqPatch: Story = {
  args: {
    editorContent: `; FM bass with envelope
(define lfo (sine 0.25))
(define env (ar 0.01 0.3))

a1 (sine (* 55 (+ 1 (* lfo 0.5))))
a2 (* env (sine 110))

d1 (> (phase 2) 0.5)
d2 (euclidean 8 5 (phase 4))

s1 (slow 4
  (from-list
    (list 60 63 67 72)
    (step)))`,
    extensions: ['structure-highlight'],
    cursorPosition: 75,
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Halo + per-line decorations
//
// These stories exercise the halo polygon's adaptation to decorations that
// change line height (probe oscilloscopes, inline result chips, future
// inline/block widgets). The polygon must measure each line independently
// so that decorations on one line don't shift the polygon on adjacent lines.
// ─────────────────────────────────────────────────────────────────────────────

export const HaloWithProbeSingleLine: Story = {
  args: {
    editorContent: '(sine 440)',
    extensions: ['structure-highlight', 'probes'],
    probes: [{ from: 0, to: 10 }],
    cursorPosition: 3,
  },
};

export const HaloWithProbeOnFirstLineOfMultiLine: Story = {
  args: {
    editorContent: '(begin\n  (sine 440)\n  (+ 1 2)\n  (saw 110))',
    extensions: ['structure-highlight', 'probes'],
    probes: [{ from: 9, to: 19 }],
    cursorPosition: 2,
  },
};

export const HaloWithProbeOnMiddleLineOfMultiLine: Story = {
  args: {
    editorContent: '(begin\n  (sine 440)\n  (+ 1 2)\n  (saw 110))',
    extensions: ['structure-highlight', 'probes'],
    probes: [{ from: 22, to: 29 }],
    cursorPosition: 2,
  },
};

export const HaloWithProbeOnLastLineOfMultiLine: Story = {
  args: {
    editorContent: '(begin\n  (sine 440)\n  (+ 1 2)\n  (saw 110))',
    extensions: ['structure-highlight', 'probes'],
    probes: [{ from: 32, to: 41 }],
    cursorPosition: 2,
  },
};

export const HaloWithProbesOnEveryLine: Story = {
  args: {
    editorContent: '(begin\n  (sine 440)\n  (saw 220)\n  (tri 110))',
    extensions: ['structure-highlight', 'probes'],
    probes: [
      { from: 9, to: 19 },
      { from: 22, to: 31 },
      { from: 34, to: 43 },
    ],
    cursorPosition: 2,
  },
};

export const HaloWithContextualProbeOnNestedExpression: Story = {
  args: {
    editorContent: '(define my-osc\n  (slow 4 (sine 110)))',
    extensions: ['structure-highlight', 'probes'],
    probes: [{ from: 17, to: 36, mode: 'contextual' }],
    cursorPosition: 4,
  },
};

export const HaloWithInlineResultAndProbe: Story = {
  args: {
    editorContent: '(begin\n  (sine 440)\n  (+ 1 2))',
    extensions: ['structure-highlight', 'probes', 'inline-results'],
    probes: [{ from: 9, to: 19 }],
    inlineResults: [{ text: '3', pos: 29 }],
    cursorPosition: 2,
  },
};

export const HaloOnNestedListContainingProbedChild: Story = {
  args: {
    editorContent: '(define synth\n  (sine 440))',
    extensions: ['structure-highlight', 'probes'],
    probes: [{ from: 16, to: 26 }],
    cursorPosition: 4,
  },
};

export const HaloOnProbedExpressionItself: Story = {
  args: {
    editorContent: '(define synth\n  (sine 440))',
    extensions: ['structure-highlight', 'probes'],
    probes: [{ from: 16, to: 26 }],
    cursorPosition: 16,
  },
};
