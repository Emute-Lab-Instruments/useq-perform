import { createSignal, createResource, Show } from 'solid-js';
import { loadScenarios, buildNavTree } from '../framework/registry';
import type { NavTreeNode } from '../framework/registry';
import { toggleApproval, isApproved } from '../framework/approvals';
import NavTree from './NavTree';
import ScenarioViewer from './ScenarioViewer';
import ContextButton from './ContextButton';

export default function Inspector() {
  const [scenarios] = createResource(loadScenarios);
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const [showOnlyUnreviewed, setShowOnlyUnreviewed] = createSignal(false);

  function filterUnreviewed(nodes: NavTreeNode[]): NavTreeNode[] {
    return nodes.reduce<NavTreeNode[]>((acc, node) => {
      if (node.scenario) {
        // Leaf: include only if unreviewed
        if (!isApproved(node.id)) acc.push(node);
      } else if (node.children) {
        // Branch: recurse and include only if it has remaining children
        const filtered = filterUnreviewed(node.children);
        if (filtered.length > 0) {
          acc.push({ ...node, children: filtered });
        }
      }
      return acc;
    }, []);
  }

  const tree = () => {
    const s = scenarios();
    if (!s) return [];
    const fullTree = buildNavTree(s);
    return showOnlyUnreviewed() ? filterUnreviewed(fullTree) : fullTree;
  };

  const selectedScenario = () => {
    const s = scenarios();
    const id = selectedId();
    return s?.find(sc => sc.id === id) ?? null;
  };

  return (
    <div class="inspector-layout">
      <nav class="inspector-nav">
        <div class="inspector-nav-header">
          Inspector
          <button
            class="inspector-filter-btn"
            classList={{ 'inspector-filter-btn-active': showOnlyUnreviewed() }}
            onClick={() => setShowOnlyUnreviewed(prev => !prev)}
            title="Show only unreviewed scenarios"
          >
            ◉
          </button>
        </div>
        <NavTree nodes={tree()} selectedId={selectedId()} onSelect={setSelectedId} />
      </nav>
      <main class="inspector-viewport">
        <Show when={selectedScenario()} fallback={
          <div class="inspector-empty">Select a scenario from the tree</div>
        }>
          {(scenario) => (
            <>
              <div class="inspector-scenario-header">
                <span class="inspector-scenario-type" data-type={scenario().type}>
                  {scenario().type}
                </span>
                <h2>{scenario().name}</h2>
                <span class="inspector-scenario-category">{scenario().category}</span>
                <button
                  class="approval-toggle"
                  classList={{ 'approval-toggle-approved': isApproved(scenario().id) }}
                  onClick={() => toggleApproval(scenario().id)}
                >
                  {isApproved(scenario().id) ? '✓ Approved' : 'Mark Approved'}
                </button>
                <ContextButton scenario={scenario()} />
              </div>
              <ScenarioViewer scenario={scenario()} />
            </>
          )}
        </Show>
      </main>
    </div>
  );
}
