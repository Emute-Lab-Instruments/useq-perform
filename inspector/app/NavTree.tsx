import { createSignal, For, Show } from 'solid-js';
import type { NavTreeNode } from '../framework/registry';
import ApprovalBadge from './ApprovalBadge';

interface NavTreeProps {
  nodes: NavTreeNode[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export default function NavTree(props: NavTreeProps) {
  const [expanded, setExpanded] = createSignal<Set<string>>(new Set());
  const [focusedId, setFocusedId] = createSignal<string | null>(null);

  // Flatten visible nodes for keyboard navigation
  function flattenVisible(nodes: NavTreeNode[]): NavTreeNode[] {
    const result: NavTreeNode[] = [];
    for (const node of nodes) {
      result.push(node);
      if (node.children && expanded().has(node.id)) {
        result.push(...flattenVisible(node.children));
      }
    }
    return result;
  }

  function toggleExpanded(id: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleKeyDown(e: KeyboardEvent) {
    const visible = flattenVisible(props.nodes);
    const currentIdx = visible.findIndex(n => n.id === focusedId());

    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        const next = Math.min(currentIdx + 1, visible.length - 1);
        setFocusedId(visible[next].id);
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        const prev = Math.max(currentIdx - 1, 0);
        setFocusedId(visible[prev].id);
        break;
      }
      case 'ArrowRight': {
        e.preventDefault();
        const node = visible[currentIdx];
        if (node?.children && !expanded().has(node.id)) {
          toggleExpanded(node.id);
        }
        break;
      }
      case 'ArrowLeft': {
        e.preventDefault();
        const node = visible[currentIdx];
        if (node?.children && expanded().has(node.id)) {
          toggleExpanded(node.id);
        }
        break;
      }
      case 'Enter': {
        e.preventDefault();
        const node = visible[currentIdx];
        if (node?.scenario) {
          props.onSelect(node.id);
        } else if (node?.children) {
          toggleExpanded(node.id);
        }
        break;
      }
    }
  }

  // Recursive tree node renderer
  function TreeNode(nodeProps: { node: NavTreeNode; depth: number }) {
    const isExpanded = () => expanded().has(nodeProps.node.id);
    const isFocused = () => focusedId() === nodeProps.node.id;
    const isSelected = () => props.selectedId === nodeProps.node.id;
    const isBranch = () => !!nodeProps.node.children;

    return (
      <>
        <li
          class="nav-tree-item"
          classList={{
            'nav-tree-branch': isBranch(),
            'nav-tree-leaf': !isBranch(),
            'nav-tree-focused': isFocused(),
            'nav-tree-selected': isSelected(),
          }}
          style={{ 'padding-left': `${nodeProps.depth * 16 + 8}px` }}
          onClick={() => {
            setFocusedId(nodeProps.node.id);
            if (nodeProps.node.scenario) {
              props.onSelect(nodeProps.node.id);
            } else if (nodeProps.node.children) {
              toggleExpanded(nodeProps.node.id);
            }
          }}
        >
          <Show when={isBranch()}>
            <span class="nav-tree-arrow" classList={{ 'nav-tree-arrow-expanded': isExpanded() }}>
              ▶
            </span>
          </Show>
          <span class="nav-tree-label">{nodeProps.node.label}</span>
          <Show when={nodeProps.node.scenario}>
            <ApprovalBadge scenarioId={nodeProps.node.id} />
          </Show>
        </li>
        <Show when={isBranch() && isExpanded()}>
          <For each={nodeProps.node.children}>
            {(child) => <TreeNode node={child} depth={nodeProps.depth + 1} />}
          </For>
        </Show>
      </>
    );
  }

  return (
    <ul class="nav-tree" tabIndex={0} onKeyDown={handleKeyDown}>
      <For each={props.nodes}>
        {(node) => <TreeNode node={node} depth={0} />}
      </For>
    </ul>
  );
}
