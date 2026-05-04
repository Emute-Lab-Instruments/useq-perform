/**
 * Structural editor + live gamepad story (B2, bd-69.6).
 *
 * Mounts a CodeMirror editor with the structural editing extension active
 * and wires the gamepad pipeline so that real hardware gamepad input
 * dispatches structural navigation and mutation actions.
 *
 * Two stories:
 *   - StructuralEditor: editor with side panel showing cursor state
 *     (path + node kind) and recent actions log.
 *   - StructuralEditorGamepad: same editor but with an expanded gamepad
 *     pipeline log (actions fired, axis readings, logical events).
 *
 * The editor is built directly with `structuralCoreExtensions()` rather than
 * the harness registry (which has a TODO placeholder for structure-highlight).
 * The gamepad pipeline uses `useGamepadPipeline` with a `fireAction` callback
 * that calls `dispatchAction` from the structural adapter.
 */

import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  type JSX,
} from 'solid-js';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, lineNumbers, drawSelection } from '@codemirror/view';
import { history } from '@codemirror/commands';
import { foldGutter, bracketMatching } from '@codemirror/language';
// @ts-expect-error — @nextjournal/clojure-mode has no type declarations
import { default_extensions as clojureMode } from '@nextjournal/clojure-mode';

import { editorBaseTheme, themes } from '@src/editors/themes';
import { structuralCoreExtensions } from '@src/editors/extensions/structure/adapter/extension';
import { dispatchAction } from '@src/editors/extensions/structure/adapter/dispatcher';
import { structField } from '@src/editors/extensions/structure/adapter/stateField';
import { pathOfCursor } from '@src/editors/extensions/structure/adapter/cursorPath';
import {
  useGamepadPipeline,
  useGamepadSnapshot,
  type PipelineEvent,
} from '@src/lib/gamepad/storybook';
import type { ActionId } from '@src/lib/gamepad/types';
import type { NodeKind } from '@src/editors/extensions/structure/core/types';
import {
  findById,
  isLeaf,
  isCompound,
} from '@src/editors/extensions/structure/core/traversal';

// ---------------------------------------------------------------------------
// Sample uSEQ code
// ---------------------------------------------------------------------------

const SAMPLE_CODE = `; FM bass with envelope
(define lfo (sine 0.25))
(define env (ar 0.01 0.3))

(a1 (sqr (* t 2)))
(d1 (saw 440))
(s1 (slow 4
  (from-list
    (list 60 63 67 72)
    (step))))

(define melody
  (let ((root 60)
        (scale [0 2 4 7 9]))
    (nth scale (mod t 5))))`;

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function fmtTime(t: number): string {
  const ms = Math.round(t);
  return String(ms % 1_000_000).padStart(6, '0');
}

function kindColor(kind: PipelineEvent['kind']): string {
  switch (kind) {
    case 'logical': return '#7aa2f7';
    case 'gesture': return '#9ece6a';
    case 'action':  return '#e0af68';
    case 'axis':    return '#bb9af7';
  }
}

function kindLabel(kind: PipelineEvent['kind']): string {
  switch (kind) {
    case 'logical': return 'L1';
    case 'gesture': return 'L2';
    case 'action':  return 'L3';
    case 'axis':    return 'AX';
  }
}

function eventBody(ev: PipelineEvent): string {
  switch (ev.kind) {
    case 'logical': {
      const e = ev.event;
      if (e.kind === 'press') return `press ${e.btn}`;
      if (e.kind === 'release') return `release ${e.btn}`;
      return `axis ${e.stick} (${e.x.toFixed(2)}, ${e.y.toFixed(2)})`;
    }
    case 'gesture': {
      const g = ev.gesture.gesture;
      switch (g.kind) {
        case 'tap': return `tap ${g.btn}`;
        case 'hold': return `hold ${g.btn}`;
        case 'held': return `held ${g.btn} ×${g.n}`;
        case 'doubleTap': return `doubleTap ${g.btn}`;
        case 'chord': return `chord [${g.btns.join('+')}]`;
        case 'flick': return `flick ${g.stick} ${g.dir}`;
      }
    }
    case 'action': return ev.action;
    case 'axis':   return `${ev.frame.stick} (${ev.frame.x.toFixed(2)}, ${ev.frame.y.toFixed(2)})`;
  }
}

// ---------------------------------------------------------------------------
// Editor creation
// ---------------------------------------------------------------------------

function createEditor(
  container: HTMLElement,
  doc: string,
  readOnly: boolean = false,
): EditorView {
  const selectedTheme = themes['useq-dark'] ?? Object.values(themes)[0];

  const extensions: Extension[] = [
    editorBaseTheme,
    ...selectedTheme,
    EditorView.theme({ '.cm-content': { fontSize: '16px' } }),
    lineNumbers(),
    bracketMatching(),
    drawSelection(),
    history(),
    foldGutter(),
    ...clojureMode,
    ...structuralCoreExtensions(),
    EditorView.updateListener.of((update) => {
      // Force a re-render of the cursor info panel on every state change.
      // This is consumed via a polling-based signal in the component.
    }),
  ];

  if (readOnly) {
    extensions.push(EditorState.readOnly.of(true));
  }

  const state = EditorState.create({ doc, extensions });
  return new EditorView({ state, parent: container });
}

// ---------------------------------------------------------------------------
// Cursor info extraction
// ---------------------------------------------------------------------------

interface CursorInfo {
  /** Structural path from document root to cursor node */
  path: readonly number[];
  /** Node kind (symbol, number, list, vector, etc.) */
  nodeKind: NodeKind | 'document' | null;
  /** Human-readable label for the cursor target */
  label: string;
  /** Source range [from, to] of the cursor node */
  range: { from: number; to: number } | null;
}

const NO_CURSOR_INFO: CursorInfo = {
  path: [],
  nodeKind: null,
  label: 'no cursor',
  range: null,
};

function getCursorInfo(view: EditorView): CursorInfo | null {
  const value = view.state.field(structField, false);
  if (!value) return null;

  const { state, idIndex, cursors } = value;

  // Guard: when no cursor has been set yet (initial state), cursors or
  // cursors.primary may be undefined.
  if (!cursors?.primary) return { ...NO_CURSOR_INFO };

  const primary = cursors.primary;
  const targetId = primary.kind === 'node' ? primary.target : primary.parent;

  const path = pathOfCursor(primary, state.tree);
  const node = findById(state.tree.root, targetId);

  let nodeKind: NodeKind | 'document' | null = null;
  let label = targetId;

  if (node) {
    if (node.kind === 'document') {
      nodeKind = 'document';
      label = 'document root';
    } else if (isLeaf(node)) {
      nodeKind = node.kind;
      label = `${node.kind}: ${node.text}`;
    } else if (isCompound(node)) {
      nodeKind = node.kind;
      label = `${node.kind} (${node.children.length} children)`;
    }
  }

  const range = idIndex.get(targetId) ?? null;

  return {
    path: path ?? [],
    nodeKind,
    label,
    range: range ? { from: range.from, to: range.to } : null,
  };
}

// ---------------------------------------------------------------------------
// Shared layout styles
// ---------------------------------------------------------------------------

const LAYOUT_STYLES: JSX.CSSProperties = {
  display: 'grid',
  'grid-template-columns': '1fr 300px',
  gap: '0',
  height: '100vh',
  background: '#0b1220',
  color: '#c0c0e0',
  'font-family':
    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  'font-size': '12px',
  'box-sizing': 'border-box',
};

const SIDEBAR_STYLES: JSX.CSSProperties = {
  display: 'flex',
  'flex-direction': 'column',
  gap: '8px',
  padding: '12px',
  background: '#10182a',
  'border-left': '1px solid #1f2a44',
  overflow: 'auto',
};

// ---------------------------------------------------------------------------
// Sidebar panel component
// ---------------------------------------------------------------------------

function SidebarPanel(props: {
  title: string;
  children: JSX.Element;
}): JSX.Element {
  return (
    <div
      style={{
        background: '#0d1422',
        border: '1px solid #1f2a44',
        'border-radius': '4px',
        padding: '8px 10px',
      }}
    >
      <div
        style={{
          color: '#fff',
          'font-weight': 'bold',
          'margin-bottom': '6px',
          'font-size': '10px',
          'text-transform': 'uppercase',
          'letter-spacing': '0.5px',
        }}
      >
        {props.title}
      </div>
      {props.children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// StructuralEditor component
// ---------------------------------------------------------------------------

function StructuralEditorView(props: {
  showPipelineLog: boolean;
}): JSX.Element {
  let editorContainer!: HTMLDivElement;
  let view: EditorView | undefined;

  // Action log — recent actions dispatched through the gamepad pipeline.
  const MAX_LOG = 50;
  const [actionLog, setActionLog] = createSignal<
    readonly { action: string; t: number }[]
  >([]);

  // Pipeline events (only used in StructuralEditorGamepad story).
  const [pipelineEvents, setPipelineEvents] = createSignal<
    readonly PipelineEvent[]
  >([]);

  // Cursor info — polled on an interval.
  const [cursorInfo, setCursorInfo] = createSignal<CursorInfo | null>(null);

  // Track whether editor is mounted.
  const [mounted, setMounted] = createSignal(false);

  onMount(() => {
    view = createEditor(editorContainer, SAMPLE_CODE);

    // Place cursor at a sensible position (inside the first top-level form).
    const pos = Math.min(45, view.state.doc.length);
    view.dispatch({ selection: { anchor: pos } });
    view.focus();

    setMounted(true);
    setCursorInfo(getCursorInfo(view));

    // Poll cursor info at ~20 fps.
    const cursorPollId = setInterval(() => {
      if (view) setCursorInfo(getCursorInfo(view));
    }, 50);

    onCleanup(() => {
      clearInterval(cursorPollId);
      view?.destroy();
    });
  });

  // Stand up the gamepad pipeline once the editor is mounted.
  createEffect(() => {
    if (!mounted()) return;
    const editor = view;
    if (!editor) return;

    const fireAction = (action: ActionId): void => {
      // Only dispatch known structural/nav actions.
      if (
        action.startsWith('nav.') ||
        action.startsWith('edit.') ||
        action.startsWith('format.')
      ) {
        dispatchAction(editor, action);
        setActionLog((prev) => {
          const entry = { action, t: performance.now() };
          const next = [...prev, entry];
          return next.length > MAX_LOG ? next.slice(-MAX_LOG) : next;
        });
      }
    };

    const pipeline = useGamepadPipeline({
      paradigm: 'modal-shift',
      fireAction,
    });

    // Mirror pipeline events for the gamepad-focused story.
    createEffect(() => {
      const evs = pipeline.events();
      setPipelineEvents(evs);
    });

    onCleanup(() => pipeline.dispose());
  });

  // Gamepad snapshot for connection status.
  const snap = useGamepadSnapshot();

  const pathDisplay = createMemo(() => {
    const info = cursorInfo();
    if (!info) return '(no cursor)';
    if (info.path.length === 0) return '[]';
    return `[${info.path.join(', ')}]`;
  });

  const rangeDisplay = createMemo(() => {
    const info = cursorInfo();
    if (!info?.range) return '—';
    return `${info.range.from}..${info.range.to}`;
  });

  return (
    <div style={LAYOUT_STYLES}>
      {/* Editor pane */}
      <div
        ref={editorContainer}
        style={{
          overflow: 'auto',
          background: '#0b1220',
        }}
      />

      {/* Sidebar */}
      <div style={SIDEBAR_STYLES}>
        {/* Gamepad status */}
        <SidebarPanel title="Gamepad">
          <Show
            when={snap()}
            fallback={
              <span style={{ color: '#506080' }}>
                🎮 not connected — use keyboard or plug in a controller
              </span>
            }
            keyed
          >
            {(s) => (
              <span style={{ color: '#9ece6a' }}>
                🎮 connected ({s.id || '?'})
              </span>
            )}
          </Show>
        </SidebarPanel>

        {/* Cursor info */}
        <SidebarPanel title="Structural cursor">
          <div style={{ display: 'flex', 'flex-direction': 'column', gap: '4px' }}>
            <div>
              <span style={{ color: '#506080' }}>path: </span>
              <span style={{ color: '#7aa2f7' }}>{pathDisplay()}</span>
            </div>
            <div>
              <span style={{ color: '#506080' }}>node: </span>
              <span style={{ color: '#9ece6a' }}>
                {cursorInfo()?.nodeKind ?? '—'}
              </span>
            </div>
            <div>
              <span style={{ color: '#506080' }}>label: </span>
              <span style={{ color: '#e0af68' }}>
                {cursorInfo()?.label ?? '—'}
              </span>
            </div>
            <div>
              <span style={{ color: '#506080' }}>range: </span>
              <span style={{ color: '#bb9af7' }}>{rangeDisplay()}</span>
            </div>
          </div>
        </SidebarPanel>

        {/* Action log */}
        <SidebarPanel title="Action log">
          <div
            style={{
              'max-height': '200px',
              overflow: 'auto',
              'line-height': '16px',
            }}
          >
            <Show
              when={actionLog().length > 0}
              fallback={
                <span style={{ color: '#506080', 'font-style': 'italic' }}>
                  No actions yet — press gamepad buttons or use keyboard.
                </span>
              }
            >
              <For each={actionLog().slice().reverse()}>
                {(entry) => (
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <span style={{ color: '#506080', width: '60px' }}>
                      {fmtTime(entry.t)}
                    </span>
                    <span style={{ color: '#e0af68' }}>{entry.action}</span>
                  </div>
                )}
              </For>
            </Show>
          </div>
        </SidebarPanel>

        {/* Pipeline event log — only shown in StructuralEditorGamepad story */}
        <Show when={props.showPipelineLog}>
          <SidebarPanel title="Pipeline events">
            <div
              style={{
                'max-height': '300px',
                overflow: 'auto',
                'line-height': '16px',
              }}
            >
              <Show
                when={pipelineEvents().length > 0}
                fallback={
                  <span style={{ color: '#506080', 'font-style': 'italic' }}>
                    Connect a gamepad to see pipeline events.
                  </span>
                }
              >
                <For each={pipelineEvents().slice().reverse().slice(0, 100)}>
                  {(ev) => (
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <span style={{ color: '#506080', width: '60px' }}>
                        {fmtTime(ev.t)}
                      </span>
                      <span
                        style={{
                          color: kindColor(ev.kind),
                          width: '24px',
                          'font-weight': 'bold',
                        }}
                      >
                        {kindLabel(ev.kind)}
                      </span>
                      <span style={{ color: kindColor(ev.kind) }}>
                        {eventBody(ev)}
                      </span>
                    </div>
                  )}
                </For>
              </Show>
            </div>
          </SidebarPanel>
        </Show>

        {/* Legend */}
        <SidebarPanel title="Controls">
          <div
            style={{
              'font-size': '10px',
              color: '#7080a0',
              'line-height': '1.5',
            }}
          >
            <div>
              <strong>Nav:</strong> D-pad or arrow keys
            </div>
            <div>
              <strong>Nav in/out:</strong> LB+Up/Down or keyboard
            </div>
            <div>
              <strong>Delete:</strong> Y button
            </div>
            <div>
              <strong>Slurp/Barf:</strong> Hold LB + A/B/X/Y
            </div>
            <div>
              <strong>Shape verbs:</strong> Hold LB+RB + face buttons
            </div>
          </div>
        </SidebarPanel>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Storybook meta
// ---------------------------------------------------------------------------

const meta: Meta = {
  title: 'Gamepad/StructuralEditor',
  tags: ['autodocs', 'gamepad'],
  parameters: { layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj;

/**
 * Structural editor with cursor state display and action log.
 * Connect a gamepad to test face-button structural operations.
 */
export const StructuralEditor: Story = {
  render: () => <StructuralEditorView showPipelineLog={false} />,
};

/**
 * Structural editor with expanded gamepad pipeline log.
 * Shows logical events, gestures, resolved actions, and axis frames
 * alongside the editor and cursor state.
 */
export const StructuralEditorGamepad: Story = {
  render: () => <StructuralEditorView showPipelineLog={true} />,
};
