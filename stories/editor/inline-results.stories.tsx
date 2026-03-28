import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { ScenarioEditor } from '../../harness/ScenarioEditor';

const meta: Meta<typeof ScenarioEditor> = {
  title: 'Editor/Inline Results',
  component: ScenarioEditor,
};
export default meta;
type Story = StoryObj<typeof ScenarioEditor>;

export const NumericResult: Story = {
  args: {
    editorContent: '(+ 1 2)',
    extensions: ['inline-results'],
    inlineResults: [
      { text: '3', pos: 7 },
    ],
  },
};

export const ErrorResult: Story = {
  args: {
    editorContent: '(/ 1 0)',
    extensions: ['inline-results'],
    inlineResults: [
      { text: 'Division by zero', pos: 6, isError: true },
    ],
  },
};

export const MultipleInlineResults: Story = {
  args: {
    editorContent: '(+ 1 2)\n(* 3 4)\n(- 10 5)',
    extensions: ['inline-results'],
    inlineResults: [
      { text: '3', pos: 7 },
      { text: '12', pos: 15 },
      { text: '5', pos: 23 },
    ],
  },
};

export const ResultOnMultilineExpression: Story = {
  args: {
    editorContent: '(+ 1\n   2\n   3)',
    extensions: ['inline-results'],
    inlineResults: [
      { text: '6', pos: 14 },
    ],
  },
};

export const SuccessAndErrorMixed: Story = {
  args: {
    editorContent: '(+ 1 2)\n(/ 1 0)',
    extensions: ['inline-results'],
    inlineResults: [
      { text: '3', pos: 7 },
      { text: 'Division by zero', pos: 15, isError: true },
    ],
  },
};

export const LongResultTruncation: Story = {
  args: {
    editorContent: '(list 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20)',
    extensions: ['inline-results'],
    inlineResults: [
      { text: '(1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34 35 36 37 38 39 40 41 42 43 44 45 46 47 48 49 50 51 52 53 54 55 56 57 58 59 60 61 62 63 64 65 66 67 68)', pos: 57 },
    ],
  },
};
