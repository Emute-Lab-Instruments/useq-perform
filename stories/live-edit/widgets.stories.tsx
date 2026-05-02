/**
 * Live-edit widgets — Storybook visual catalogue (gii8.39).
 *
 * Demonstrates each widget kind (knob, toggle, picker, vector-of-knobs)
 * across the §4.3 widget states. Visual-only: no runtime/persistence wiring.
 */
import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { ScenarioEditor } from '../../harness/ScenarioEditor';
import type { LiveEditSlot } from '@src/contracts/liveEdit';

const meta: Meta<typeof ScenarioEditor> = {
  title: 'Editor/LiveEditWidgets',
  tags: ['autodocs'],
  component: ScenarioEditor,
};
export default meta;
type Story = StoryObj<typeof ScenarioEditor>;

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a numeric live-edit slot from a single-line `(live-edit ...)` form.
 * Computes the slot range as `[0, content.length)` so the entire line is
 * folded into the inline widget.
 */
function numericSlot(opts: {
  id: string;
  seed: number;
  value: number;
  min: number;
  max: number;
  precision?: number;
  state?: LiveEditSlot['state'];
  modified?: boolean;
  rangeFrom: number;
  rangeTo: number;
}): LiveEditSlot {
  return {
    id: opts.id,
    kind: 'numeric',
    seed: opts.seed,
    value: opts.value,
    min: opts.min,
    max: opts.max,
    precision: opts.precision ?? 2,
    state: opts.state ?? 'idle',
    modified: opts.modified ?? false,
    range: { from: opts.rangeFrom, to: opts.rangeTo },
  };
}

// ── Single numeric knob — content + slot helpers ─────────────────────────────

const NUMERIC_CONTENT = '(live-edit 0.5 :id "ab12" :min 0 :max 1)';

// ── Stories ──────────────────────────────────────────────────────────────────

export const NumericKnobIdle: Story = {
  args: {
    editorContent: NUMERIC_CONTENT,
    extensions: ['live-edit-widgets'],
    liveEditSlots: [
      numericSlot({
        id: 'ab12',
        seed: 0.5,
        value: 0.5,
        min: 0,
        max: 1,
        state: 'idle',
        rangeFrom: 0,
        rangeTo: NUMERIC_CONTENT.length,
      }),
    ],
  },
};

export const NumericKnobModified: Story = {
  args: {
    editorContent: NUMERIC_CONTENT,
    extensions: ['live-edit-widgets'],
    liveEditSlots: [
      numericSlot({
        id: 'ab12',
        seed: 0.5,
        value: 0.82,
        min: 0,
        max: 1,
        state: 'idle',
        modified: true,
        rangeFrom: 0,
        rangeTo: NUMERIC_CONTENT.length,
      }),
    ],
  },
};

export const NumericKnobListening: Story = {
  args: {
    editorContent: NUMERIC_CONTENT,
    extensions: ['live-edit-widgets'],
    liveEditSlots: [
      numericSlot({
        id: 'ab12',
        seed: 0.5,
        value: 0.5,
        min: 0,
        max: 1,
        state: 'listening',
        rangeFrom: 0,
        rangeTo: NUMERIC_CONTENT.length,
      }),
    ],
  },
};

export const NumericKnobUninitialised: Story = {
  args: {
    editorContent: NUMERIC_CONTENT,
    extensions: ['live-edit-widgets'],
    liveEditSlots: [
      numericSlot({
        id: 'ab12',
        seed: 0.5,
        value: 0.5,
        min: 0,
        max: 1,
        state: 'uninitialised',
        rangeFrom: 0,
        rangeTo: NUMERIC_CONTENT.length,
      }),
    ],
  },
};

export const NumericKnobWasmPreview: Story = {
  args: {
    editorContent: NUMERIC_CONTENT,
    extensions: ['live-edit-widgets'],
    liveEditSlots: [
      numericSlot({
        id: 'ab12',
        seed: 0.5,
        value: 0.65,
        min: 0,
        max: 1,
        state: 'wasm-preview',
        modified: true,
        rangeFrom: 0,
        rangeTo: NUMERIC_CONTENT.length,
      }),
    ],
  },
};

export const NumericKnobError: Story = {
  args: {
    editorContent: NUMERIC_CONTENT,
    extensions: ['live-edit-widgets'],
    liveEditSlots: [
      numericSlot({
        id: 'ab12',
        seed: 0.5,
        value: 0.5,
        min: 0,
        max: 1,
        state: 'error',
        rangeFrom: 0,
        rangeTo: NUMERIC_CONTENT.length,
      }),
    ],
  },
};

// ── Boolean toggle ───────────────────────────────────────────────────────────

const BOOLEAN_CONTENT = '(live-edit true :id "tg01")';

export const BooleanToggle: Story = {
  args: {
    editorContent: BOOLEAN_CONTENT,
    extensions: ['live-edit-widgets'],
    liveEditSlots: [
      {
        id: 'tg01',
        kind: 'boolean',
        seed: true,
        value: true,
        state: 'idle',
        range: { from: 0, to: BOOLEAN_CONTENT.length },
      },
    ],
  },
};

// ── Keyword picker ───────────────────────────────────────────────────────────

const KEYWORD_CONTENT =
  '(live-edit :up :id "pk01" :options [:up :down :hold])';

export const KeywordPicker: Story = {
  args: {
    editorContent: KEYWORD_CONTENT,
    extensions: ['live-edit-widgets'],
    liveEditSlots: [
      {
        id: 'pk01',
        kind: 'keyword',
        seed: 'up',
        value: 'up',
        options: ['up', 'down', 'hold'],
        state: 'idle',
        range: { from: 0, to: KEYWORD_CONTENT.length },
      },
    ],
  },
};

// ── Vector of knobs ──────────────────────────────────────────────────────────

// `[E1 E2 E3]` where each E_n is a `(live-edit N ...)` form. Brackets are
// preserved (§2.6.4); each element is independently wrapped.
const VEC_E1 = '(live-edit 1 :id "v1" :min 0 :max 4)';
const VEC_E2 = '(live-edit 2 :id "v2" :min 0 :max 4)';
const VEC_E3 = '(live-edit 3 :id "v3" :min 0 :max 4)';
const VECTOR_CONTENT = `[${VEC_E1} ${VEC_E2} ${VEC_E3}]`;
const V1_FROM = 1;
const V1_TO = V1_FROM + VEC_E1.length;
const V2_FROM = V1_TO + 1; // separator space
const V2_TO = V2_FROM + VEC_E2.length;
const V3_FROM = V2_TO + 1;
const V3_TO = V3_FROM + VEC_E3.length;

export const VectorOfKnobs: Story = {
  args: {
    editorContent: VECTOR_CONTENT,
    extensions: ['live-edit-widgets'],
    liveEditSlots: [
      {
        id: 'v1',
        kind: 'vector-element',
        seed: 1,
        value: 1,
        min: 0,
        max: 4,
        precision: 0,
        state: 'idle',
        range: { from: V1_FROM, to: V1_TO },
      },
      {
        id: 'v2',
        kind: 'vector-element',
        seed: 2,
        value: 3.2,
        min: 0,
        max: 4,
        precision: 1,
        state: 'idle',
        modified: true,
        range: { from: V2_FROM, to: V2_TO },
      },
      {
        id: 'v3',
        kind: 'vector-element',
        seed: 3,
        value: 3,
        min: 0,
        max: 4,
        precision: 0,
        state: 'idle',
        range: { from: V3_FROM, to: V3_TO },
      },
    ],
  },
};

// ── Many slots, mixed kinds ──────────────────────────────────────────────────

const MIXED_LINE_1 = '(live-edit 0.5 :id "k1" :min 0 :max 1)';
const MIXED_LINE_2 = '(live-edit true :id "t1")';
const MIXED_LINE_3 = '(live-edit :up :id "p1" :options [:up :down :hold])';
const MIXED_LINE_4 = '(live-edit 220 :id "k2" :min 20 :max 2000)';
const MIXED_CONTENT = `${MIXED_LINE_1}\n${MIXED_LINE_2}\n${MIXED_LINE_3}\n${MIXED_LINE_4}`;
const M1_FROM = 0;
const M1_TO = M1_FROM + MIXED_LINE_1.length;
const M2_FROM = M1_TO + 1; // newline
const M2_TO = M2_FROM + MIXED_LINE_2.length;
const M3_FROM = M2_TO + 1;
const M3_TO = M3_FROM + MIXED_LINE_3.length;
const M4_FROM = M3_TO + 1;
const M4_TO = M4_FROM + MIXED_LINE_4.length;

export const ManySlotsMixed: Story = {
  args: {
    editorContent: MIXED_CONTENT,
    extensions: ['live-edit-widgets'],
    liveEditSlots: [
      numericSlot({
        id: 'k1',
        seed: 0.5,
        value: 0.5,
        min: 0,
        max: 1,
        state: 'idle',
        rangeFrom: M1_FROM,
        rangeTo: M1_TO,
      }),
      {
        id: 't1',
        kind: 'boolean',
        seed: true,
        value: false,
        state: 'editing',
        modified: true,
        range: { from: M2_FROM, to: M2_TO },
      },
      {
        id: 'p1',
        kind: 'keyword',
        seed: 'up',
        value: 'down',
        options: ['up', 'down', 'hold'],
        state: 'listening',
        modified: true,
        range: { from: M3_FROM, to: M3_TO },
      },
      numericSlot({
        id: 'k2',
        seed: 220,
        value: 880,
        min: 20,
        max: 2000,
        precision: 0,
        state: 'wasm-preview',
        modified: true,
        rangeFrom: M4_FROM,
        rangeTo: M4_TO,
      }),
    ],
  },
};
