import { Component, For, Show, createSignal, onCleanup } from "solid-js";
import { 
  toggleStarred, 
  toggleExpanded, 
  ReferenceEntry, 
  Version,
  referenceStore,
  compareVersions
} from "../../utils/referenceStore";
import { CodeMirrorEditor } from "./CodeMirrorEditor";
import { marked } from "marked";

export const ReferenceItem: Component<{ entry: ReferenceEntry; targetVersion: Version | null }> = (props) => {
  const isExpanded = () => referenceStore.expanded.has(props.entry.name);
  const isStarred = () => referenceStore.starred.has(props.entry.name);
  const [copiedExample, setCopiedExample] = createSignal<string | null>(null);
  let copyResetTimer: ReturnType<typeof setTimeout> | undefined;

  const isAvailable = () => {
    if (!props.targetVersion || !props.entry.meta.introduced) return true;
    return compareVersions(props.targetVersion, props.entry.meta.introduced) >= 0;
  };

  const hasUpcomingChange = () => {
    if (!props.targetVersion || !props.entry.meta.changed) return false;
    return compareVersions(props.targetVersion, props.entry.meta.changed) < 0;
  };

  const handleCopyExample = async (example: string) => {
    await navigator.clipboard.writeText(example);
    setCopiedExample(example);
    if (copyResetTimer) clearTimeout(copyResetTimer);
    copyResetTimer = setTimeout(() => {
      setCopiedExample((current) => (current === example ? null : current));
    }, 2000);
  };

  onCleanup(() => {
    if (copyResetTimer) clearTimeout(copyResetTimer);
  });

  return (
    <div 
      class="doc-function-item" 
      classList={{ 
        "doc-function-item--expanded": isExpanded(),
        "doc-function-item--unavailable": !isAvailable()
      }}
      data-function={props.entry.name}
    >
      <div class="doc-function-header" onClick={() => toggleExpanded(props.entry.name)}>
        <div class="doc-function-name">
          {props.entry.name}
          <Show when={props.entry.parameters.length > 0}>
            <span class="doc-function-params-container">
              <For each={props.entry.parameters}>
                {(param) => <span class="doc-function-param"> &lt;{param.name}&gt;</span>}
              </For>
            </span>
          </Show>
        </div>
        <Show when={props.entry.meta.introduced}>
          <span class="doc-function-version-chip">
            {isAvailable() ? `Since v${props.entry.meta.introduced!.raw}` : `Requires v${props.entry.meta.introduced!.raw}`}
          </span>
        </Show>
        <button 
          class="doc-star-button" 
          onClick={(e) => { e.stopPropagation(); toggleStarred(props.entry.name); }}
        >
          {isStarred() ? "★" : "☆"}
        </button>
        <span class="doc-expand-indicator">{isExpanded() ? "▼" : "▶"}</span>
      </div>

      <Show when={isExpanded()}>
        <div class="doc-function-content doc-function-content--active">
          <Show when={!isAvailable()}>
            <div class="doc-function-availability-note">
              Available from firmware v{props.entry.meta.introduced?.raw}
            </div>
          </Show>

          <div class="doc-function-description" innerHTML={marked.parse(props.entry.description) as string} />

          <Show when={props.entry.meta.changed}>
            <div class={`doc-function-change-note ${hasUpcomingChange() ? 'doc-function-change-note--upcoming' : ''}`}>
              {hasUpcomingChange() ? `Changes coming in v${props.entry.meta.changed!.raw}` : `Updated in v${props.entry.meta.changed!.raw}`}
            </div>
          </Show>

          <Show when={props.entry.parameters.length > 0}>
            <div class="doc-section-title">Parameters</div>
            <ul class="doc-params-list">
              <For each={props.entry.parameters}>
                {(param) => (
                  <li class="doc-param-item">
                    <span class="doc-param-name">{param.name}</span>
                    <Show when={param.description}>
                      {" "}<span class="doc-param-description">{param.description}</span>
                    </Show>
                    <Show when={param.range}>
                      <div class="doc-param-range">Range: {param.range}</div>
                    </Show>
                  </li>
                )}
              </For>
            </ul>
          </Show>

          <Show when={props.entry.examples.length > 0}>
            <div class="doc-section-title">Examples</div>
            <div class="doc-examples-list">
              <For each={props.entry.examples}>
                {(example) => (
                  <div class="doc-example-wrapper">
                    <CodeMirrorEditor code={example} readOnly={true} fontSize="12px" minHeight="30px" />
                    <button 
                      class="doc-copy-button" 
                      onClick={async (e) => {
                        e.stopPropagation();
                        await handleCopyExample(example);
                      }}
                    >
                      {copiedExample() === example ? "Copied!" : "Copy"}
                    </button>
                  </div>
                )}
              </For>
            </div>
          </Show>

          <Show when={props.entry.tags.length > 0}>
            <div class="doc-section-title">Tags</div>
            <div class="doc-function-tags">
              <For each={props.entry.tags}>
                {(tag) => <span class="doc-function-tag">{tag}</span>}
              </For>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
};
