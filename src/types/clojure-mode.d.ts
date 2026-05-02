/**
 * Ambient declarations for `@nextjournal/clojure-mode`.
 *
 * The upstream package ships ESM only and provides no .d.ts files.
 * The declarations below cover the surface used by this codebase.
 */

declare module "@nextjournal/clojure-mode" {
  import type { Extension } from "@codemirror/state";
  import type { KeyBinding } from "@codemirror/view";

  export const default_extensions: Extension[];
  export const complete_keymap: readonly KeyBinding[];
}

declare module "@nextjournal/clojure-mode/extensions/eval-region" {
  import type { EditorState } from "@codemirror/state";

  export function top_level_string(state: EditorState): string | null;
}
