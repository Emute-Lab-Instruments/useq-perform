import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import { createSignal } from 'solid-js';
import { ReferenceFilters } from '@src/ui/help/ReferenceFilters';

const sampleVersionOptions = [
  { raw: '1.0.0', major: 1, minor: 0, patch: 0 },
  { raw: '1.1.0', major: 1, minor: 1, patch: 0 },
  { raw: '1.2.0', major: 1, minor: 2, patch: 0 },
];

const sampleTags = ['oscillator', 'filter', 'envelope', 'math', 'timing', 'logic', 'sequencing', 'io'];

function ReferenceFiltersWrapper() {
  const [search, setSearch] = createSignal('');
  const [selectedTags, setSelectedTags] = createSignal(new Set<string>());
  const [targetVersion, setTargetVersion] = createSignal<string | null>(null);

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  };

  return (
    <ReferenceFilters
      versionOptions={sampleVersionOptions}
      currentTargetVersion={targetVersion()}
      onVersionChange={setTargetVersion}
      allTags={sampleTags}
      selectedTags={selectedTags()}
      onTagToggle={toggleTag}
      onClearTags={() => setSelectedTags(new Set())}
      searchQuery={search()}
      onSearchChange={setSearch}
    />
  );
}

const meta: Meta = {
  title: 'Help/Reference Filters',
  tags: ['autodocs'],
  component: ReferenceFiltersWrapper,
};
export default meta;
type Story = StoryObj;

export const Default: Story = {};
