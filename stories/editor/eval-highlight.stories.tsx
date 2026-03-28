import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { ScenarioEditor } from '../../harness/ScenarioEditor';

const meta: Meta<typeof ScenarioEditor> = {
  title: 'Editor/Eval Highlight',
  component: ScenarioEditor,
};
export default meta;
type Story = StoryObj<typeof ScenarioEditor>;

export const ConnectedEvalFlash: Story = {
  args: {
    loadAppStyles: true,
    editorContent: '(sine 440)\n(tri 220)',
    extensions: ['eval-highlight'],
    cursorPosition: 1,
    evalHighlight: { from: 0, to: 10 },
    evalHighlightIntervalMs: 2500,
  },
};

export const PreviewMode: Story = {
  args: {
    loadAppStyles: true,
    editorContent: '(+ (* 2 3) (- 10 5))',
    extensions: ['eval-highlight'],
    cursorPosition: 1,
    evalHighlight: { from: 0, to: 20, isPreview: true },
    evalHighlightIntervalMs: 2500,
  },
};

export const MultilineExpression: Story = {
  args: {
    loadAppStyles: true,
    editorContent: '(define synth\n  (let ((f 440))\n    (sine f)))',
    extensions: ['eval-highlight'],
    cursorPosition: 28,
    evalHighlight: { from: 0, to: 42 },
    evalHighlightIntervalMs: 2500,
  },
};

export const MultipleTopLevelForms: Story = {
  args: {
    loadAppStyles: true,
    editorContent: '(sine 440)\n(tri 220)\n(saw 110)',
    extensions: ['eval-highlight'],
    cursorPosition: 14,
    evalHighlight: { from: 11, to: 20 },
    evalHighlightIntervalMs: 2500,
  },
};

export const DisconnectedMode: Story = {
  args: {
    loadAppStyles: true,
    editorContent: '(sine 440)\n(tri 220)',
    extensions: ['eval-highlight'],
    cursorPosition: 1,
    evalHighlight: { from: 0, to: 10 },
    evalHighlightIntervalMs: 2500,
  },
};
