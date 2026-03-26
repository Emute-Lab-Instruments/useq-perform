import {
  StateEffect,
  StateField,
} from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  WidgetType,
} from "@codemirror/view";
import { getAppSettings } from "../../runtime/appSettingsRepository.ts";

interface InlineResultPayload {
  text: string;
  pos: number;
  isError?: boolean;
}

export const showInlineResult = StateEffect.define<InlineResultPayload>();
export const clearInlineResults = StateEffect.define<void>();

// FIXME: Gutter mode needs rework — the gutter renders in a separate column
// from the line numbers and doesn't integrate well visually. Shelved for now.
// Related code commented out below.
//
// const gutterResultEffect = StateEffect.define<InlineResultPayload | null>();

class InlineResultWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly isError: boolean,
    readonly timestamp: string | null,
  ) {
    super();
  }

  toDOM(_view: EditorView): HTMLElement {
    const span = document.createElement("span");
    span.className = this.isError
      ? "cm-inline-result cm-inline-result--error"
      : "cm-inline-result";
    const display = truncateText(this.text, getMaxChars());
    span.textContent = ` ;=> ${display}`;
    if (this.timestamp) {
      const ts = document.createElement("span");
      ts.className = "cm-inline-result__timestamp";
      ts.textContent = this.timestamp;
      span.appendChild(ts);
    }
    return span;
  }

  eq(other: InlineResultWidget): boolean {
    return (
      this.text === other.text &&
      this.isError === other.isError &&
      this.timestamp === other.timestamp
    );
  }

  ignoreEvent(): boolean {
    return false;
  }
}

class FloatingResultWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly isError: boolean,
  ) {
    super();
  }

  toDOM(_view: EditorView): HTMLElement {
    const container = document.createElement("span");
    container.className = this.isError
      ? "cm-floating-result cm-floating-result--error"
      : "cm-floating-result";
    const display = truncateText(this.text, getMaxChars());
    container.textContent = display;
    return container;
  }

  eq(other: FloatingResultWidget): boolean {
    return this.text === other.text && this.isError === other.isError;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

// FIXME: Gutter marker widget — re-enable when gutter mode is reworked.
//
// class ResultGutterMarker extends GutterMarker {
//   constructor(readonly text: string, readonly isError: boolean) {
//     super();
//   }
//
//   toDOM(): HTMLElement {
//     const el = document.createElement("div");
//     el.className = this.isError
//       ? "cm-gutter-result cm-gutter-result--error"
//       : "cm-gutter-result";
//     el.textContent = truncateText(this.text, 20);
//     return el;
//   }
//
//   eq(other: ResultGutterMarker): boolean {
//     return this.text === other.text && this.isError === other.isError;
//   }
// }

function getMaxChars(): number {
  return getAppSettings().evalResults?.maxChars ?? 200;
}

function truncateText(text: string, max: number): string {
  if (max <= 0 || text.length <= max) return text;
  return text.slice(0, max) + "…";
}

function formatTimestamp(show: boolean): string | null {
  if (!show) return null;
  const d = new Date();
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

let dismissTimer: ReturnType<typeof setTimeout> | null = null;

export const inlineResultsField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decos, tr) {
    decos = decos.map(tr.changes);

    for (const e of tr.effects) {
      if (e.is(clearInlineResults)) {
        if (dismissTimer) {
          clearTimeout(dismissTimer);
          dismissTimer = null;
        }
        return Decoration.none;
      }

      if (e.is(showInlineResult)) {
        const settings = getAppSettings().evalResults;
        const mode = settings?.mode ?? "console";
        const { text, pos, isError } = e.value;

        if (mode === "console") {
          continue;
        }

        const showTs = settings?.showTimestamp ?? false;
        const ts = formatTimestamp(showTs);

        if (dismissTimer) {
          clearTimeout(dismissTimer);
          dismissTimer = null;
        }

        const widgetSpec = mode === "floating"
          ? Decoration.widget({
              widget: new FloatingResultWidget(text, isError ?? false),
              side: 1,
              block: false,
            })
          : Decoration.widget({
              widget: new InlineResultWidget(text, isError ?? false, ts),
              side: 1,
              block: false,
            });

        const anchorPos = mode === "floating"
          ? pos
          : tr.newDoc.lineAt(pos).to;

        const resultDecos = Decoration.set(widgetSpec.range(anchorPos));

        if (mode === "inline-ephemeral" || mode === "floating") {
          const delay = settings?.autoDismissMs ?? 3000;
          if (delay > 0) {
            dismissTimer = setTimeout(() => {
              dismissTimer = null;
            }, delay);
          }
        }

        return resultDecos;
      }
    }

    return decos;
  },
  provide: (f) => EditorView.decorations.from(f),
});

// FIXME: Gutter result field and gutter extension — re-enable when gutter mode
// is reworked. The gutter renders in a separate column from line numbers and
// doesn't integrate well visually.
//
// let gutterDismissTimer: ReturnType<typeof setTimeout> | null = null;
//
// export const gutterResultField = StateField.define<RangeSet<GutterMarker>>({
//   create() {
//     return RangeSet.empty;
//   },
//   update(markers, tr) {
//     for (const e of tr.effects) {
//       if (e.is(gutterResultEffect)) {
//         if (gutterDismissTimer) {
//           clearTimeout(gutterDismissTimer);
//           gutterDismissTimer = null;
//         }
//         if (e.value === null) {
//           return RangeSet.empty;
//         }
//         const { text, pos, isError } = e.value;
//         const builder = new RangeSetBuilder<GutterMarker>();
//         builder.add(pos, pos, new ResultGutterMarker(text, isError ?? false));
//         return builder.finish();
//       }
//     }
//     return markers;
//   },
// });
//
// export const resultGutter = gutter({
//   class: "cm-result-gutter",
//   markers: (view) => view.state.field(gutterResultField, false) ?? RangeSet.empty,
//   initialSpacer: () => new ResultGutterMarker("·", false),
// });
//
// function showGutterResult(view: EditorView, text: string, pos: number, isError: boolean): void {
//   const settings = getAppSettings().evalResults;
//   if (settings?.mode !== "gutter") return;
//
//   if (gutterDismissTimer) {
//     clearTimeout(gutterDismissTimer);
//     gutterDismissTimer = null;
//   }
//
//   view.dispatch({
//     effects: gutterResultEffect.of({ text, pos, isError }),
//   });
//
//   const delay = settings?.autoDismissMs ?? 3000;
//   if (delay > 0) {
//     gutterDismissTimer = setTimeout(() => {
//       gutterDismissTimer = null;
//       try {
//         view.dispatch({ effects: gutterResultEffect.of(null) });
//       } catch {
//         // View may have been destroyed
//       }
//     }, delay);
//   }
// }

let inlineDismissTimer: ReturnType<typeof setTimeout> | null = null;

export function dispatchInlineResult(
  view: EditorView,
  text: string,
  pos: number,
  isError: boolean = false,
): void {
  const settings = getAppSettings().evalResults;
  const mode = settings?.mode ?? "console";

  if (mode === "console") return;

  if (inlineDismissTimer) {
    clearTimeout(inlineDismissTimer);
    inlineDismissTimer = null;
  }

  view.dispatch({
    effects: showInlineResult.of({ text, pos, isError }),
  });

  if (mode === "inline-ephemeral" || mode === "floating") {
    const delay = settings?.autoDismissMs ?? 3000;
    if (delay > 0) {
      inlineDismissTimer = setTimeout(() => {
        inlineDismissTimer = null;
        try {
          view.dispatch({ effects: clearInlineResults.of(undefined) });
        } catch {
          // View may have been destroyed
        }
      }, delay);
    }
  }
}

export function clearAllInlineResults(view: EditorView): void {
  if (inlineDismissTimer) {
    clearTimeout(inlineDismissTimer);
    inlineDismissTimer = null;
  }
  view.dispatch({ effects: clearInlineResults.of(undefined) });
}
