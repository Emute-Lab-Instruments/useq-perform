/**
 * Hole rendering — inline placeholder pills (§2.9.5, §2.9.7).
 *
 * Replaces hole source `($ name :type)` with a folded inline pill showing
 * `[<type-tag>·<name>]`. Respects `structure.foldAllWrappers` setting.
 *
 * Cursor halos render around the pill via the standard structural cursor
 * halo from `decorations.ts` — the source range covered by the
 * Decoration.replace is exactly the range in the idIndex for that hole node,
 * so the halo mark naturally wraps the pill widget.
 */

import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
} from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";
import type { EditorState } from "@codemirror/state";

import type { HoleNode, HoleType, Node } from "../core/types.ts";
import { structField } from "./stateField.ts";
import type { IdIndex } from "./treeFromLezer.ts";
import { getAppSettings } from "../../../../runtime/appSettingsRepository.ts";

// ─── Type tag abbreviations per §2.9.7 ───────────────────────────────────────

const TYPE_TAGS: Record<HoleType, string> = {
  number: "num",
  symbol: "sym",
  keyword: "kwd",
  string: "str",
  expr: "exp",
};

// ─── Widget ───────────────────────────────────────────────────────────────────

class HolePillWidget extends WidgetType {
  constructor(
    readonly name: string,
    readonly holeType: HoleType,
  ) {
    super();
  }

  eq(other: HolePillWidget): boolean {
    return this.name === other.name && this.holeType === other.holeType;
  }

  toDOM(): HTMLElement {
    const pill = document.createElement("span");
    pill.className = `cm-hole-pill cm-hole-pill--${this.holeType}`;
    pill.setAttribute("aria-label", `hole: ${this.name} (${this.holeType})`);

    const tag = document.createElement("span");
    tag.className = "cm-hole-pill-tag";
    tag.textContent = TYPE_TAGS[this.holeType];

    const sep = document.createElement("span");
    sep.className = "cm-hole-pill-sep";
    sep.textContent = "·"; // middle dot

    const nameEl = document.createElement("span");
    nameEl.className = "cm-hole-pill-name";
    nameEl.textContent = this.name;

    pill.appendChild(tag);
    pill.appendChild(sep);
    pill.appendChild(nameEl);

    return pill;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

// ─── Hole collection ──────────────────────────────────────────────────────────

interface HoleRange {
  from: number;
  to: number;
  name: string;
  holeType: HoleType;
}

/** Walk the core tree to find all hole nodes and their source ranges. */
function collectHoles(root: Node, idIndex: IdIndex): HoleRange[] {
  const holes: HoleRange[] = [];
  const walk = (n: Node): void => {
    if (n.kind === "hole") {
      const range = idIndex.get(n.id);
      if (range) {
        holes.push({
          from: range.from,
          to: range.to,
          name: (n as HoleNode).name,
          holeType: (n as HoleNode).holeType,
        });
      }
      return;
    }
    if (
      n.kind === "list" ||
      n.kind === "vector" ||
      n.kind === "map" ||
      n.kind === "set" ||
      n.kind === "document"
    ) {
      for (const c of n.children) walk(c);
    }
  };
  walk(root);
  return holes;
}

// ─── Decoration building ──────────────────────────────────────────────────────

function isFoldEnabled(): boolean {
  const settings = getAppSettings();
  return settings?.structure?.foldAllWrappers !== false;
}

function buildHoleDecorations(state: EditorState): DecorationSet {
  if (!isFoldEnabled()) return Decoration.none;

  const value = state.field(structField, false);
  if (!value) return Decoration.none;

  const holes = collectHoles(value.state.tree.root, value.idIndex);
  if (holes.length === 0) return Decoration.none;

  const docLen = state.doc.length;
  const builder = new RangeSetBuilder<Decoration>();

  // Sort by `from` for RangeSetBuilder ordering requirement.
  holes.sort((a, b) => a.from - b.from);

  for (const hole of holes) {
    const from = Math.max(0, Math.min(hole.from, docLen));
    const to = Math.max(0, Math.min(hole.to, docLen));
    if (to <= from) continue;

    builder.add(
      from,
      to,
      Decoration.replace({
        widget: new HolePillWidget(hole.name, hole.holeType),
      }),
    );
  }

  return builder.finish();
}

// ─── ViewPlugin ───────────────────────────────────────────────────────────────

export const holePillDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildHoleDecorations(view.state);
    }
    update(u: ViewUpdate) {
      const oldField = u.startState.field(structField, false);
      const newField = u.state.field(structField, false);
      if (u.docChanged || oldField !== newField) {
        this.decorations = buildHoleDecorations(u.state);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

// ─── Theme ────────────────────────────────────────────────────────────────────

export const holePillTheme = EditorView.baseTheme({
  ".cm-hole-pill": {
    display: "inline-flex",
    alignItems: "center",
    gap: "1px",
    padding: "1px 5px",
    borderRadius: "8px",
    fontSize: "0.85em",
    fontFamily: "inherit",
    lineHeight: "1.4",
    verticalAlign: "baseline",
    backgroundColor: "rgba(180, 160, 220, 0.15)",
    border: "1px solid rgba(180, 160, 220, 0.45)",
    color: "rgba(220, 210, 240, 0.9)",
    cursor: "default",
    userSelect: "none",
  },
  ".cm-hole-pill-tag": {
    fontWeight: "600",
    fontSize: "0.8em",
    textTransform: "uppercase",
    letterSpacing: "0.03em",
    opacity: "0.75",
  },
  ".cm-hole-pill-sep": {
    opacity: "0.4",
    margin: "0 1px",
  },
  ".cm-hole-pill-name": {
    fontStyle: "italic",
  },
  // Type-specific border colours for accessibility (per §2.9.7:
  // "type information is encoded inline in the glyph form rather than via
  // colour" — the border is a secondary cue only).
  ".cm-hole-pill--number": {
    borderColor: "rgba(120, 200, 255, 0.55)",
  },
  ".cm-hole-pill--symbol": {
    borderColor: "rgba(180, 220, 130, 0.55)",
  },
  ".cm-hole-pill--keyword": {
    borderColor: "rgba(255, 180, 100, 0.55)",
  },
  ".cm-hole-pill--string": {
    borderColor: "rgba(255, 160, 180, 0.55)",
  },
  ".cm-hole-pill--expr": {
    borderColor: "rgba(180, 160, 220, 0.55)",
  },
});
