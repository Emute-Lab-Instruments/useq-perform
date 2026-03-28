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
