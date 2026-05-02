import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { createSignal } from 'solid-js';
import { userEvent, within } from 'storybook/test';
import { SnippetModal, type EditingSnippet } from '@src/ui/help/SnippetModal';
import { CodeSnippetsTab } from '@src/ui/help/CodeSnippetsTab';
import type { Snippet } from '@src/utils/snippetStore';

const SAMPLE_SNIPPETS: Snippet[] = [
  { id: 1, title: 'Slow LFO',     code: '(a1 (sin (slow 4 bar)))',                       tags: ['modulation', 'starter'], createdAt: 1_700_000_000_000 },
  { id: 2, title: 'Tremolo',      code: '(a1 (* (sin (fast 8 bar)) (tri bar)))',         tags: ['modulation', 'starter'], createdAt: 1_700_000_010_000 },
  { id: 3, title: 'Decay Env',    code: '(a2 (* (- 1 (fast 4 bar)) (sqr (fast 4 bar))))',tags: ['modulation', 'envelope'], createdAt: 1_700_000_020_000 },
  { id: 4, title: 'Kick',         code: '(d1 (sqr beat))',                                tags: ['rhythm', 'starter'], createdAt: 1_700_000_030_000 },
  { id: 5, title: 'Hi-hat',       code: '(d2 (sqr (fast 8 bar)))',                        tags: ['rhythm', 'starter'], createdAt: 1_700_000_040_000 },
  { id: 6, title: 'Euclid 5/8',   code: '(d3 (euclid 5 8 bar))',                          tags: ['rhythm', 'euclidean'], createdAt: 1_700_000_050_000 },
  { id: 7, title: 'Step seq',     code: '(a1 (from-list [0.2 0.4 0.6 0.8 0.5 0.3] bar))', tags: ['melodic'], createdAt: 1_700_000_060_000 },
  { id: 8, title: 'Smooth glide', code: '(a2 (interp [0 1 0.3 0.8 0] bar))',              tags: ['melodic'], createdAt: 1_700_000_070_000 },
];

function ModalHarness(props: { editing: EditingSnippet }) {
  const [open, setOpen] = createSignal(true);
  if (!open()) return null;
  return (
    <SnippetModal
      editingSnippet={props.editing}
      onClose={() => setOpen(false)}
      onAddSnippet={(s) => console.log('add', s)}
      onUpdateSnippet={(id, u) => console.log('update', id, u)}
      getEditorContent={() => '; pasted from main editor\n(a1 (sine 0.5))'}
    />
  );
}

function TabHarness(props: { snippets: Snippet[]; starred?: Set<number> }) {
  const [items, setItems] = createSignal<Snippet[]>(props.snippets);
  const [starred, setStarred] = createSignal<Set<number>>(props.starred ?? new Set());
  const toggleStar = (id: number) => {
    setStarred((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const remove = (id: number) => setItems((prev) => prev.filter((s) => s.id !== id));
  const add = (s: Omit<Snippet, 'id' | 'createdAt'>) => {
    setItems((prev) => [...prev, { ...s, id: Math.max(0, ...prev.map((p) => p.id)) + 1, createdAt: Date.now() }]);
  };
  const update = (id: number, u: Partial<Omit<Snippet, 'id' | 'createdAt'>>) => {
    setItems((prev) => prev.map((s) => (s.id === id ? { ...s, ...u } : s)));
  };
  return (
    <div style={{ width: '100%', 'max-width': '700px', height: '600px', overflow: 'auto', background: '#0b1220', padding: '12px' }}>
      <CodeSnippetsTab
        snippets={items()}
        starred={starred()}
        onToggleStar={toggleStar}
        onDeleteSnippet={remove}
        onAddSnippet={add}
        onUpdateSnippet={update}
        onInsertText={() => true}
      />
    </div>
  );
}

const meta: Meta = {
  title: 'Help/Snippets',
  tags: ['autodocs'],
};
export default meta;
type Story = StoryObj;

/** SnippetModal in "create" mode — empty fields. */
export const ModalNew: Story = {
  render: () => <ModalHarness editing="new" />,
};

/** SnippetModal in "edit" mode — fields seeded from an existing snippet. */
export const ModalEdit: Story = {
  render: () => <ModalHarness editing={SAMPLE_SNIPPETS[0]} />,
};

/** Code snippets tab populated with the starter library and two starred items. */
export const TabPopulated: Story = {
  render: () => <TabHarness snippets={SAMPLE_SNIPPETS} starred={new Set([1, 4])} />,
};

/** Code snippets tab in empty state — shows the "no snippets yet" message. */
export const TabEmpty: Story = {
  render: () => <TabHarness snippets={[]} />,
};

/** Active search filter — the search input is pre-populated to narrow the list. */
export const TabSearchFilter: Story = {
  render: () => <TabHarness snippets={SAMPLE_SNIPPETS} starred={new Set([1])} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const search = await canvas.findByPlaceholderText('Search snippets...');
    await userEvent.type(search, 'lfo');
  },
};

/** Active tag filter — clicking a tag chip narrows by tag. */
export const TabTagFilter: Story = {
  render: () => <TabHarness snippets={SAMPLE_SNIPPETS} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const tagBtn = await canvas.findByRole('button', { name: 'rhythm' });
    await userEvent.click(tagBtn);
  },
};

/** Search query that matches nothing — shows the "no snippets match your filters" message. */
export const TabNoMatches: Story = {
  render: () => <TabHarness snippets={SAMPLE_SNIPPETS} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const search = await canvas.findByPlaceholderText('Search snippets...');
    await userEvent.type(search, 'zzznosuchsnippet');
  },
};
