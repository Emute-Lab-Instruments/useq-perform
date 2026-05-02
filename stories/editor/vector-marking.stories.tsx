/**
 * Storybook stories for the vector-mark sub-mode visuals (gii8.38).
 *
 * Each story seeds a `VectorMarkSession` matching the editor source so the
 * `vector-marking` extension can paint the underlines + focus halo. These
 * are visual-only — no interaction, no commit/cancel wiring (gii8.36 owns
 * that).
 *
 * Spec: docs/specs/live-edit.md §3.7.6 (marker rendering MVP), §3.7.7
 * (focus indication), §3.7.8 (bottom hint line).
 */
import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { ScenarioEditor } from '../../harness/ScenarioEditor';

const meta: Meta<typeof ScenarioEditor> = {
  title: 'Editor/VectorMarking',
  tags: ['autodocs'],
  component: ScenarioEditor,
};
export default meta;
type Story = StoryObj<typeof ScenarioEditor>;

// Helper: every element selected, focus on the first.
// Source: `[ 1 2 3 4 ]`
//          0 12 4 6 8 0
const fourElementVectorRanges = [
  { from: 2, to: 3 }, // 1
  { from: 4, to: 5 }, // 2
  { from: 6, to: 7 }, // 3
  { from: 8, to: 9 }, // 4
];

export const AllSelectedDefault: Story = {
  args: {
    editorContent: '[ 1 2 3 4 ]',
    extensions: ['vector-marking'],
    vectorMarkSession: {
      vectorRange: { from: 0, to: 11 },
      elements: fourElementVectorRanges.map((range) => ({
        range,
        state: 'selected' as const,
      })),
      focusIndex: 0,
    },
  },
};

export const MixedAfterToggling: Story = {
  args: {
    editorContent: '[ 1 2 3 4 ]',
    extensions: ['vector-marking'],
    vectorMarkSession: {
      vectorRange: { from: 0, to: 11 },
      elements: [
        { range: fourElementVectorRanges[0], state: 'selected' },
        { range: fourElementVectorRanges[1], state: 'deselected' },
        { range: fourElementVectorRanges[2], state: 'selected' },
        { range: fourElementVectorRanges[3], state: 'deselected' },
      ],
      focusIndex: 2, // focus on 3
    },
  },
};

export const FocusOnSecondElement: Story = {
  args: {
    // `[ 10 20 30 ]`
    //  0 12 4 56 7 89 0 1
    editorContent: '[ 10 20 30 ]',
    extensions: ['vector-marking'],
    vectorMarkSession: {
      vectorRange: { from: 0, to: 12 },
      elements: [
        { range: { from: 2, to: 4 }, state: 'selected' }, // 10
        { range: { from: 5, to: 7 }, state: 'selected' }, // 20
        { range: { from: 8, to: 10 }, state: 'selected' }, // 30
      ],
      focusIndex: 1, // focus on 20
    },
  },
};

export const AllDeselected: Story = {
  args: {
    editorContent: '[ 1 2 3 4 ]',
    extensions: ['vector-marking'],
    vectorMarkSession: {
      vectorRange: { from: 0, to: 11 },
      elements: fourElementVectorRanges.map((range) => ({
        range,
        state: 'deselected' as const,
      })),
      focusIndex: 0,
    },
  },
};

export const WithNonLiterals: Story = {
  args: {
    // `[ 1 (* x 2) :a 3 ]`
    //   0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7
    editorContent: '[ 1 (* x 2) :a 3 ]',
    extensions: ['vector-marking'],
    vectorMarkSession: {
      vectorRange: { from: 0, to: 18 },
      elements: [
        { range: { from: 2, to: 3 }, state: 'selected' }, // 1
        { range: { from: 4, to: 11 }, state: 'non-markable' }, // (* x 2)
        { range: { from: 12, to: 14 }, state: 'non-markable' }, // :a
        { range: { from: 15, to: 16 }, state: 'selected' }, // 3
      ],
      focusIndex: 0, // focus on 1
    },
  },
};

export const LongVector: Story = {
  args: {
    // `[ 1 2 3 4 5 6 7 8 ]`
    //  0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8
    editorContent: '[ 1 2 3 4 5 6 7 8 ]',
    extensions: ['vector-marking'],
    vectorMarkSession: {
      vectorRange: { from: 0, to: 19 },
      elements: [
        { range: { from: 2, to: 3 }, state: 'selected' },
        { range: { from: 4, to: 5 }, state: 'selected' },
        { range: { from: 6, to: 7 }, state: 'deselected' },
        { range: { from: 8, to: 9 }, state: 'selected' },
        { range: { from: 10, to: 11 }, state: 'selected' },
        { range: { from: 12, to: 13 }, state: 'deselected' },
        { range: { from: 14, to: 15 }, state: 'selected' },
        { range: { from: 16, to: 17 }, state: 'selected' },
      ],
      focusIndex: 4, // focus on 5
    },
  },
};
