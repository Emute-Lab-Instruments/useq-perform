import { Component, For, Show } from "solid-js";
import type { Section, ContentBlock } from "./guideTypes";
import { renderContentBlock } from "./contentBlocks";
import { PlaygroundBlock } from "./Playground";

// ---------------------------------------------------------------------------
// GuideSection
// ---------------------------------------------------------------------------

interface GuideSectionProps {
  section: Section;
  expanded: boolean;
  onToggle: () => void;
}

export const GuideSection: Component<GuideSectionProps> = (props) => {
  return (
    <div class="guide-section" classList={{ "guide-section--expanded": props.expanded }}>
      <div class="guide-section-header" onClick={props.onToggle} role="button" tabIndex={0}>
        <span class="guide-section-arrow">▶</span>
        <h4 class="guide-section-title">{props.section.title}</h4>
        <Show when={!props.expanded}>
          <span class="guide-section-summary">{props.section.summary}</span>
        </Show>
      </div>
      <Show when={props.expanded}>
        <div class="guide-section-content">
          <For each={props.section.content}>
            {(block) =>
              block.type === "playground" ? (
                <PlaygroundBlock playground={block.playground} />
              ) : (
                renderContentBlock(block)
              )
            }
          </For>
        </div>
      </Show>
    </div>
  );
};
