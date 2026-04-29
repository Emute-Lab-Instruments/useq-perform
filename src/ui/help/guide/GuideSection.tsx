import {
  Component,
  For,
  Show,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import type { ContentBlock, Section } from "./guideTypes";
import { renderContentBlock } from "./contentBlocks";
import { PlaygroundBlock } from "./Playground";

// ---------------------------------------------------------------------------
// LazyPlayground — IntersectionObserver-based mount/unmount
// ---------------------------------------------------------------------------
//
// Renders a placeholder div sized roughly like a real playground; replaces
// itself with the real <PlaygroundBlock> once it scrolls within 200px of
// the viewport (or scroll root). Unmounts when scrolled fully out.
//
// The scroll root is auto-detected by walking up to the nearest `.guide-tab`
// ancestor on mount. This is needed because the help panel is a scrollable
// container — using the default viewport `root` would mean entries never
// intersect from the panel's perspective.
//
// Spec: docs/USER_GUIDE_SPEC.md §"Lazy Mounting" (200px rootMargin).

const PLAYGROUND_PLACEHOLDER_HEIGHT = 140; // px — approximate; avoids layout jumps

interface LazyPlaygroundProps {
  block: ContentBlock & { type: "playground" };
}

const LazyPlayground: Component<LazyPlaygroundProps> = (props) => {
  let placeholderEl!: HTMLDivElement;
  const [visible, setVisible] = createSignal(false);

  onMount(() => {
    // Walk up to find the scrollable ancestor. Using viewport (`root: null`)
    // would not work inside the help panel.
    const scrollRoot =
      (placeholderEl.closest(".guide-tab") as HTMLElement | null) ?? null;

    // Some test/headless environments lack IntersectionObserver — degrade
    // gracefully by mounting eagerly.
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          setVisible(entry.isIntersecting);
        }
      },
      {
        root: scrollRoot,
        rootMargin: "200px 0px",
        threshold: 0,
      },
    );

    observer.observe(placeholderEl);
    onCleanup(() => observer.disconnect());
  });

  return (
    <div
      ref={placeholderEl}
      class="guide-playground-lazy-slot"
      style={
        visible() ? undefined : { "min-height": `${PLAYGROUND_PLACEHOLDER_HEIGHT}px` }
      }
    >
      <Show
        when={visible()}
        fallback={<div class="guide-playground-placeholder" aria-hidden="true" />}
      >
        <PlaygroundBlock playground={props.block.playground} />
      </Show>
    </div>
  );
};

// ---------------------------------------------------------------------------
// GuideSection
// ---------------------------------------------------------------------------

export interface GuideSectionProps {
  section: Section;
  expanded: boolean;
  onToggle: () => void;
}

/**
 * Collapsible section primitive used by chapter renderers in the user guide.
 *
 * - Header (title + one-line summary) is always visible
 * - Click header to toggle expand/collapse
 * - When expanded, renders content blocks; Playgrounds lazy-mount via
 *   IntersectionObserver with 200px rootMargin so we don't pay for ~20
 *   simultaneous Playgrounds when only a few are on-screen.
 * - Deep-dive, try-it, tip, prose, reference-table render inline (not lazy).
 *
 * Props-based: receives section data + toggle callback. No store imports.
 */
export const GuideSection: Component<GuideSectionProps> = (props) => {
  return (
    <div
      class="guide-section"
      classList={{ "guide-section--expanded": props.expanded }}
      id={`guide-section-${props.section.id}`}
    >
      <div
        class="guide-section-header"
        role="button"
        tabIndex={0}
        aria-expanded={props.expanded}
        onClick={props.onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            props.onToggle();
          }
        }}
      >
        <span class="guide-section-arrow">{"▶"}</span>
        <span class="guide-section-title">{props.section.title}</span>
        <span class="guide-section-summary">{props.section.summary}</span>
      </div>
      <div class="guide-section-content">
        <Show when={props.expanded}>
          <For each={props.section.content}>
            {(block) =>
              block.type === "playground" ? (
                <LazyPlayground block={block} />
              ) : (
                renderContentBlock(block)
              )
            }
          </For>
        </Show>
      </div>
    </div>
  );
};
