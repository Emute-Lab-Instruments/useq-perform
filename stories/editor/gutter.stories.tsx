import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { ScenarioEditor } from '../../harness/ScenarioEditor';

const meta: Meta<typeof ScenarioEditor> = {
  title: 'Editor/Expression Gutter',
  component: ScenarioEditor,
};
export default meta;
type Story = StoryObj<typeof ScenarioEditor>;

export const SingleExpression: Story = {
  args: {
    editorContent: 'a1 (sine 440)',
    extensions: ['gutter'],
    evaluatedExpressions: [
      { expressionType: 'a1', position: { from: 0, to: 14, line: 1 } },
    ],
  },
};

export const MultipleChannels: Story = {
  args: {
    editorContent: 'a1 (sine 440)\na2 (* (tri 220) (ar 0.01 0.3))\nd1 (> (phase 2) 0.5)',
    extensions: ['gutter'],
    evaluatedExpressions: [
      { expressionType: 'a1', position: { from: 0, to: 14, line: 1 } },
      { expressionType: 'a2', position: { from: 15, to: 46, line: 2 } },
      { expressionType: 'd1', position: { from: 47, to: 67, line: 3 } },
    ],
  },
};

export const NoExpressions: Story = {
  args: {
    editorContent: '; Just a comment\n(define lfo (sine 0.25))',
    extensions: ['gutter'],
  },
};

export const DenseExpressions: Story = {
  args: {
    editorContent: 'a1 (sine 110)\na2 (tri 220)\na3 (saw 330)\na4 (pulse 440 0.5)\nd1 (> (phase 1) 0.5)\nd2 (every 4 2)\ns1 (sequence 0.2 0.4 0.6 0.8)',
    extensions: ['gutter'],
    evaluatedExpressions: [
      { expressionType: 'a1', position: { from: 0, to: 14, line: 1 } },
      { expressionType: 'a2', position: { from: 15, to: 27, line: 2 } },
      { expressionType: 'a3', position: { from: 28, to: 40, line: 3 } },
      { expressionType: 'a4', position: { from: 41, to: 59, line: 4 } },
      { expressionType: 'd1', position: { from: 60, end: 80, line: 5 } as any },
      { expressionType: 'd2', position: { from: 81, to: 95, line: 6 } },
      { expressionType: 's1', position: { from: 96, to: 127, line: 7 } },
    ],
  },
};

export const MultilineExpression: Story = {
  args: {
    editorContent: 'a1 (sine\n      (* 55\n         (+ 1\n            (* (sine 0.25) 0.5))))',
    extensions: ['gutter'],
    evaluatedExpressions: [
      { expressionType: 'a1', position: { from: 0, to: 65, line: 1 } },
    ],
  },
};
