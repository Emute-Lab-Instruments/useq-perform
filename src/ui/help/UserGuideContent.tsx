import { Component, Show, createEffect, onCleanup } from "solid-js";
import { render } from "solid-js/web";
import { sanitizeHtml } from "../../utils/sanitize";
import { CodeMirrorEditor } from "./CodeMirrorEditor";

interface UserGuideContentProps {
  content?: string;
  loading: boolean;
  error: unknown;
}

export const UserGuideContent: Component<UserGuideContentProps> = (props) => {
  let contentRef: HTMLDivElement | undefined;
  const disposers: Array<() => void> = [];

  function mountCodeBlocks() {
    for (const dispose of disposers.splice(0)) dispose();
    if (!contentRef) return;

    const codeBlocks = contentRef.querySelectorAll<HTMLElement>("pre code");
    for (const codeEl of codeBlocks) {
      const pre = codeEl.parentElement;
      if (!pre) continue;

      const code = codeEl.textContent ?? "";
      const wrapper = document.createElement("div");
      wrapper.className = "userguide-cm-wrapper";
      pre.replaceWith(wrapper);

      disposers.push(
        render(() => <CodeMirrorEditor code={code} readOnly={true} fontSize="13px" minHeight="30px" />, wrapper)
      );
    }
  }

  createEffect(() => {
    // Track content changes; run after SolidJS flushes innerHTML to DOM.
    props.content;
    if (!props.loading) {
      queueMicrotask(mountCodeBlocks);
    }
  });

  onCleanup(() => {
    for (const dispose of disposers) dispose();
  });

  return (
    <div id="userguide-content">
      <Show when={!props.loading} fallback={<div>Loading user guide...</div>}>
        <div ref={contentRef} innerHTML={sanitizeHtml(props.content ?? "")} />
      </Show>
      <Show when={props.error}>
        <p>Error loading user guide. Please try refreshing the page.</p>
      </Show>
    </div>
  );
};
