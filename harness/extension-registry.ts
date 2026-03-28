/**
 * Registry of named CodeMirror extensions.
 *
 * Each entry is a lazy factory — the extension's module is only loaded when
 * a scenario requests it. Uses dynamic import() to avoid pulling runtime
 * dependencies at module load time.
 */
import type { Extension } from '@codemirror/state';

export const extensionRegistry: Record<string, () => Promise<Extension | Extension[]>> = {
  'structure-highlight': async () => {
    const { navigationMetaField } = await import('@src/editors/extensions/structure/ast');
    const { nodeHighlightPlugin } = await import('@src/editors/extensions/structure/decorations');
    return [navigationMetaField, nodeHighlightPlugin];
  },
  'eval-highlight': async () => {
    const { evalHighlightField } = await import('@src/editors/extensions/evalHighlight');
    return evalHighlightField;
  },
  'diagnostics': async () => {
    const { diagnosticField } = await import('@src/editors/extensions/diagnostics');
    return diagnosticField;
  },
  'gutter': async () => {
    const {
      lastEvaluatedExpressionField,
      matchPattern,
      findExpressionBounds,
      isRangeActive,
    } = await import('@src/editors/extensions/structure/eval-state');
    const { StateField, RangeSetBuilder } = await import('@codemirror/state');
    const { GutterMarker, gutter: cmGutter } = await import('@codemirror/view');

    class SimpleGutterMarker extends GutterMarker {
      color: string;
      isActive: boolean;
      constructor(color: string, isActive: boolean) {
        super();
        this.color = color;
        this.isActive = isActive;
      }
      toDOM() {
        const div = document.createElement('div');
        div.style.cssText = `width:4px;height:100%;margin:0 6px;border-radius:2px;background:${this.color};opacity:${this.isActive ? '1' : '0.3'}`;
        return div;
      }
      eq(other: SimpleGutterMarker) {
        return other.color === this.color && other.isActive === this.isActive;
      }
    }

    const gutterField = StateField.define({
      create(state: any) {
        return buildMarkers(state);
      },
      update(markers: any, tr: any) {
        if (tr.docChanged) return buildMarkers(tr.state);
        const prev = tr.startState.field(lastEvaluatedExpressionField, false);
        const next = tr.state.field(lastEvaluatedExpressionField, false);
        if (prev !== next) return buildMarkers(tr.state);
        return markers;
      },
    });

    function buildMarkers(state: any) {
      const builder = new RangeSetBuilder<any>();
      const doc = state.doc;
      const lastEval: Map<string, { from: number; to: number; line: number }> =
        state.field(lastEvaluatedExpressionField, false) || new Map();
      const allMarkers: Array<{ pos: number; marker: any }> = [];

      for (let lineNum = 1; lineNum <= doc.lines; lineNum++) {
        const line = doc.line(lineNum);
        let match: RegExpExecArray | null;
        matchPattern.lastIndex = 0;
        while ((match = matchPattern.exec(line.text)) !== null) {
          const matchStart = line.from + match.index;
          const exprType = `${match[1]}${match[2]}`;
          const bounds = findExpressionBounds(state, matchStart);
          const lastEvalEntry = lastEval.get(exprType);
          const active = isRangeActive(bounds, lastEvalEntry);
          for (let ln = bounds.from; ln <= bounds.to; ln++) {
            allMarkers.push({
              pos: doc.line(ln).from,
              marker: new SimpleGutterMarker('#00ff41', active),
            });
          }
        }
      }

      allMarkers.sort((a, b) => a.pos - b.pos);
      let lastPos = -1;
      for (const { pos, marker } of allMarkers) {
        if (pos !== lastPos) {
          builder.add(pos, pos, marker);
          lastPos = pos;
        }
      }
      return builder.finish();
    }

    const gutterExt = cmGutter({
      class: 'cm-expression-gutter',
      markers: (v: any) => v.state.field(gutterField),
      initialSpacer: () => new SimpleGutterMarker('transparent', true),
    });

    return [lastEvaluatedExpressionField, gutterField, gutterExt];
  },
  'probes': async () => {
    const { createProbeExtensions } = await import('@src/editors/extensions/probes');
    return createProbeExtensions({
      evalExpression: async () => null,
      getRefreshIntervalMs: () => 1000,
      getProbeLineWidth: () => 2,
      getProbeCanvasWidth: () => 138,
      getProbeCanvasHeight: () => 46,
      loadPersistedProbes: () => [],
      savePersistedProbes: () => {},
      removePersistedProbes: () => {},
    });
  },
  'inline-results': async () => {
    const { createInlineResultsField } = await import('@src/editors/extensions/inlineResults');
    return createInlineResultsField({
      getMode: () => 'inline' as const,
      getMaxChars: () => 200,
      getShowTimestamp: () => false,
      getAutoDismissMs: () => 0,
    });
  },
};
