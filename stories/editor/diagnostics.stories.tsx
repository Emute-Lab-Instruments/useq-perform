import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { ScenarioEditor } from '../../harness/ScenarioEditor';

const meta: Meta<typeof ScenarioEditor> = {
  title: 'Editor/Diagnostics',
  tags: ['autodocs'],
  component: ScenarioEditor,
};
export default meta;
type Story = StoryObj<typeof ScenarioEditor>;

export const MixedSeverity: Story = {
  args: {
    editorContent: '(+ 1 (bad-syntax\n(let ((unused 0)) (+ 1 2))\n(* 3 3)',
    extensions: ['diagnostics'],
    diagnostics: [
      { start: 5, end: 16, severity: 'error', message: 'Unmatched opening parenthesis' },
      { start: 23, end: 29, severity: 'warning', message: 'Unused variable: unused' },
      { start: 43, end: 48, severity: 'info', message: 'Expression always evaluates to 9' },
    ],
  },
};

export const MultipleErrors: Story = {
  args: {
    editorContent: '(+ 1 (missing-paren 3\n(nonexistent-fn 7)\n(+ "text" 5)',
    extensions: ['diagnostics'],
    diagnostics: [
      { start: 5, end: 21, severity: 'error', message: 'Unmatched opening parenthesis' },
      { start: 22, end: 36, severity: 'error', message: 'Unknown function: nonexistent-fn' },
      { start: 43, end: 49, severity: 'error', message: 'Type mismatch: expected number, got string' },
    ],
  },
};

export const CleanCode: Story = {
  args: {
    editorContent: '; Clean code with no diagnostics\n(define lfo (sine 0.25))\n\na1 (sine (* 55 (+ 1 (* lfo 0.5))))',
    extensions: ['diagnostics'],
    diagnostics: [],
  },
};

export const Warning: Story = {
  args: {
    editorContent: '(let ((unused-var 42))\n  (+ 1 2))',
    extensions: ['diagnostics'],
    diagnostics: [
      { start: 6, end: 16, severity: 'warning', message: 'Unused variable: unused-var' },
    ],
  },
};

export const SyntaxError: Story = {
  args: {
    editorContent: '(define x',
    extensions: ['diagnostics'],
    diagnostics: [
      {
        start: 0, end: 9, severity: 'error',
        message: 'Unexpected end of input — expected closing parenthesis',
        suggestion: 'Add a closing ) to complete the expression',
        example: '(define x 42)',
      },
    ],
  },
};

export const LongMessage: Story = {
  args: {
    editorContent: '(defmacro when (cond . body)\n  `(if ,cond (begin ,@body)))',
    extensions: ['diagnostics'],
    diagnostics: [
      {
        start: 0, end: 57, severity: 'warning',
        message: 'Macro \'when\' shadows a built-in form. This may cause unexpected behavior when used in other expressions. Consider renaming to \'my-when\' or using a namespace prefix.',
      },
    ],
  },
};
