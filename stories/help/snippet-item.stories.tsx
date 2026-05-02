import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { SnippetItem } from '@src/ui/help/SnippetItem';
import type { Snippet } from '@src/utils/snippetStore';

const sampleSnippet: Snippet = {
  id: 1,
  title: 'Sine LFO',
  code: '(a1 (sine 0.5))',
  tags: ['lfo', 'modulation'],
  createdAt: Date.now(),
};

const starredSnippet: Snippet = {
  id: 2,
  title: 'Euclidean Rhythm',
  code: '(d1 (euclid 5 8 (sine 2)))',
  tags: ['rhythm', 'sequencing'],
  createdAt: Date.now(),
};

const meta: Meta = {
  title: 'Help/Snippet Item',
  tags: ['autodocs'],
};
export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: () => (
    <SnippetItem
      snippet={sampleSnippet}
      starred={new Set()}
      onEdit={() => {}}
      onToggleStar={() => {}}
      onDeleteSnippet={() => {}}
      onInsertText={() => false}
    />
  ),
};

export const Starred: Story = {
  render: () => (
    <SnippetItem
      snippet={starredSnippet}
      starred={new Set([2])}
      onEdit={() => {}}
      onToggleStar={() => {}}
      onDeleteSnippet={() => {}}
      onInsertText={() => false}
    />
  ),
};
