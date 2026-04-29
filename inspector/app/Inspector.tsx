import { createSignal, createResource, Show } from 'solid-js';
import { loadScenarios, buildNavTree } from '../framework/registry';
import type { NavTreeNode } from '../framework/registry';
import type { ResolvedScenario } from '../framework/scenario';
import { toggleApproval, isApproved } from '../framework/approvals';
import NavTree from './NavTree';
import ScenarioViewer from './ScenarioViewer';
import GalleryViewer from './GalleryViewer';
import ContextButton from './ContextButton';

export default function Inspector() {
  const [scenarios] = createResource(loadScenarios);
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const [showOnlyUnreviewed, setShowOnlyUnreviewed] = createSignal(false);
  const [flatView, setFlatView] = createSignal(false);

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

  function flattenLeaves(nodes: NavTreeNode[], prefix = ''): NavTreeNode[] {
    const result: NavTreeNode[] = [];
    for (const node of nodes) {
      if (node.scenario) {
        const fullLabel = prefix ? `${prefix} / ${node.label}` : node.label;
        result.push({ ...node, label: fullLabel });
      } else if (node.children) {
        const nextPrefix = prefix ? `${prefix} / ${node.label}` : node.label;
        result.push(...flattenLeaves(node.children, nextPrefix));
      }
    }
    return result;
  }

  /** Full hierarchical tree (before flattening) — used for gallery lookups */
  const fullTree = () => {
    const s = scenarios();
    if (!s) return [];
    const result = buildNavTree(s);
    return showOnlyUnreviewed() ? filterUnreviewed(result) : result;
  };

  const tree = () => {
    const t = fullTree();
    return flatView() ? flattenLeaves(t) : t;
  };

  /** Collect all leaf scenarios under a branch node */
  function collectLeaves(nodes: NavTreeNode[]): ResolvedScenario[] {
    const result: ResolvedScenario[] = [];
    for (const node of nodes) {
      if (node.scenario) result.push(node.scenario);
      else if (node.children) result.push(...collectLeaves(node.children));
    }
    return result;
  }

  function findBranch(nodes: NavTreeNode[], id: string): NavTreeNode | null {
    for (const node of nodes) {
      if (node.id === id && node.children) return node;
      if (node.children) {
        const found = findBranch(node.children, id);
        if (found) return found;
      }
    }
    return null;
  }

  const selectedScenario = () => {
    const s = scenarios();
    const id = selectedId();
    return s?.find(sc => sc.id === id) ?? null;
  };

  /** When a branch is selected, return all its descendant scenarios */
  const selectedGallery = () => {
    const id = selectedId();
    if (!id) return null;
    // Only if it's not a single scenario
    if (selectedScenario()) return null;
    const t = fullTree();
    const branch = findBranch(t, id);
    if (!branch?.children) return null;
    return collectLeaves(branch.children);
  };

  return (
    <div class="inspector-layout">
      <nav class="inspector-nav">
        <div class="inspector-nav-header">
          Inspector
          <button
            class="inspector-filter-btn"
            classList={{ 'inspector-filter-btn-active': flatView() }}
            onClick={() => setFlatView(prev => !prev)}
            title="Flat view — show all scenarios in a single list"
          >
            ☰
          </button>
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
        <Show when={selectedScenario()}>
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
        <Show when={selectedGallery()}>
          {(galleryScenarios) => (
            <GalleryViewer scenarios={galleryScenarios()} />
          )}
        </Show>
        <Show when={!selectedScenario() && !selectedGallery()}>
          <div class="inspector-empty">Select a scenario from the tree</div>
        </Show>
      </main>
    </div>
  );
}
