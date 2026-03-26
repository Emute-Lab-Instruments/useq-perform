import { Component, For, Show, createSignal } from "solid-js";
import type { ContentBlock, ReferenceRow } from "./guideTypes";

// ---------------------------------------------------------------------------
// Inline text parsing (backtick `code` and *italic*)
// ---------------------------------------------------------------------------

/** Parse inline markup: `code` → <code>, *italic* → <em>. */
function renderInlineText(text: string) {
  const rx = /`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const segments: Array<{ text: string; code: boolean }> = [];

  while ((m = rx.exec(text)) !== null) {
    if (m.index > last) segments.push({ text: text.slice(last, m.index), code: false });
    segments.push({ text: m[1], code: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last), code: false });

  return (
    <For each={segments}>
      {(seg) => {
        if (seg.code) return <code class="guide-inline-code">{seg.text}</code>;
        const italicParts = seg.text.split(/(\*[^*]+\*)/g);
        return (
          <For each={italicParts}>
            {(part) => {
              if (part.startsWith("*") && part.endsWith("*")) {
                return <em>{part.slice(1, -1)}</em>;
              }
              return <>{part}</>;
            }}
          </For>
        );
      }}
    </For>
  );
}

// ---------------------------------------------------------------------------
// Prose
// ---------------------------------------------------------------------------

export const Prose: Component<{ text: string }> = (props) => {
  return (
    <div class="guide-prose">
      <For each={props.text.split("\n\n")}>
        {(para) => <p class="guide-paragraph">{renderInlineText(para)}</p>}
      </For>
    </div>
  );
};

// ---------------------------------------------------------------------------
// DeepDiveBlock
// ---------------------------------------------------------------------------

export const DeepDiveBlock: Component<{ title: string; content: ContentBlock[] }> = (props) => {
  const [expanded, setExpanded] = createSignal(false);

  return (
    <div class="guide-deep-dive" classList={{ "guide-deep-dive--open": expanded() }}>
      <button
        class="guide-deep-dive-header"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded()}
      >
        <span class="guide-deep-dive-arrow">{expanded() ? "▼" : "▶"}</span>{" "}
        {props.title}
      </button>
      <Show when={expanded()}>
        <div class="guide-deep-dive-body">
          <For each={props.content}>{(block) => renderContentBlock(block)}</For>
        </div>
      </Show>
    </div>
  );
};

// ---------------------------------------------------------------------------
// TryItBlock
// ---------------------------------------------------------------------------

export const TryItBlock: Component<{ text: string }> = (props) => {
  return (
    <div class="guide-try-it">{renderInlineText(props.text)}</div>
  );
};

// ---------------------------------------------------------------------------
// TipBlock
// ---------------------------------------------------------------------------

export const TipBlock: Component<{ text: string }> = (props) => {
  return (
    <div class="guide-tip">{renderInlineText(props.text)}</div>
  );
};

// ---------------------------------------------------------------------------
// ReferenceTableBlock
// ---------------------------------------------------------------------------

export const ReferenceTableBlock: Component<{ rows: ReferenceRow[] }> = (props) => {
  return (
    <table class="guide-reference-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Signature</th>
          <th>Description</th>
        </tr>
      </thead>
      <tbody>
        <For each={props.rows}>
          {(row) => (
            <tr>
              <td class="guide-reference-name"><code>{row.name}</code></td>
              <td>{row.signature}</td>
              <td>{row.description}</td>
            </tr>
          )}
        </For>
      </tbody>
    </table>
  );
};

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

/** Render a single ContentBlock by dispatching on its type. */
export function renderContentBlock(block: ContentBlock) {
  switch (block.type) {
    case "prose":
      return <Prose text={block.text} />;
    case "playground":
      return <div class="guide-playground-placeholder" />;
    case "deep-dive":
      return <DeepDiveBlock title={block.title} content={block.content} />;
    case "try-it":
      return <TryItBlock text={block.text} />;
    case "tip":
      return <TipBlock text={block.text} />;
    case "reference-table":
      return <ReferenceTableBlock rows={block.rows} />;
  }
}
