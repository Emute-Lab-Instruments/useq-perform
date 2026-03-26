import {
  Component,
  For,
  Show,
  createSignal,
  createMemo,
  onMount,
  onCleanup,
} from "solid-js";
import type { Chapter, GuideDomain, Section, ContentBlock } from "./guideTypes";
import { renderContentBlock } from "./contentBlocks";
import { PlaygroundBlock } from "./Playground";
import { loadRaw, saveRaw } from "../../../lib/persistence";

import { chapters } from "./guideData";

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

const DISMISSED_KEY = "guide-dismissed-sections";

function loadDismissed(): Set<string> {
  try {
    const raw = loadRaw(DISMISSED_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function saveDismissed(ids: Set<string>): void {
  saveRaw(DISMISSED_KEY, JSON.stringify([...ids]));
}

// ---------------------------------------------------------------------------
// Domain grouping
// ---------------------------------------------------------------------------

const DOMAIN_ORDER: GuideDomain[] = ["language", "editor"];

const DOMAIN_LABELS: Record<GuideDomain, string> = {
  language: "LANGUAGE",
  editor: "EDITOR",
};

// ---------------------------------------------------------------------------
// LazyPlayground — IntersectionObserver-based lazy mount
// ---------------------------------------------------------------------------

// Playgrounds mount immediately when their parent section is expanded.
// Sections are collapsed by default, so this is already lazy — no need for
// an IntersectionObserver (which fails inside scrollable panel containers
// where the viewport-based root doesn't intersect).
const LazyPlayground: Component<{ block: ContentBlock & { type: "playground" } }> = (props) => {
  return <PlaygroundBlock playground={props.block.playground} />;
};

// ---------------------------------------------------------------------------
// SectionView
// ---------------------------------------------------------------------------

const SectionView: Component<{
  section: Section;
  expanded: boolean;
  onToggle: () => void;
}> = (props) => {
  return (
    <div
      class="guide-section"
      classList={{ "guide-section--expanded": props.expanded }}
      id={`guide-section-${props.section.id}`}
    >
      <div class="guide-section-header" onClick={props.onToggle}>
        <span class="guide-section-arrow">{"\u25B6"}</span>
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

// ---------------------------------------------------------------------------
// GuideTab
// ---------------------------------------------------------------------------

export const GuideTab: Component = () => {
  // -- TOC collapse state --
  const [tocExpanded, setTocExpanded] = createSignal(true);

  // -- Dismissed sections --
  const [dismissed, setDismissed] = createSignal<Set<string>>(new Set());

  onMount(() => {
    setDismissed(loadDismissed());
  });

  function dismiss(sectionId: string) {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(sectionId);
      saveDismissed(next);
      return next;
    });
  }

  function showAll() {
    setDismissed(new Set());
    saveDismissed(new Set());
  }

  // -- Section expand/collapse state --
  const [expandedSections, setExpandedSections] = createSignal<Set<string>>(new Set());

  function toggleSection(sectionId: string) {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });
  }

  function expandAllInChapter(chapter: Chapter) {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      for (const s of chapter.sections) next.add(s.id);
      return next;
    });
  }

  function collapseAllInChapter(chapter: Chapter) {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      for (const s of chapter.sections) next.delete(s.id);
      return next;
    });
  }

  function allExpandedInChapter(chapter: Chapter): boolean {
    const exp = expandedSections();
    return chapter.sections.length > 0 && chapter.sections.every((s) => exp.has(s.id));
  }

  // -- Domain-grouped chapters --
  const grouped = createMemo(() => {
    const groups: { domain: GuideDomain; chapters: Chapter[] }[] = [];
    for (const domain of DOMAIN_ORDER) {
      const chs = chapters.filter((c) => c.domain === domain);
      if (chs.length > 0) groups.push({ domain, chapters: chs });
    }
    return groups;
  });

  // -- All sections flat (for TOC) --
  const allSections = createMemo(() => chapters.flatMap((c) => c.sections));

  // -- TOC entries sorted: non-dismissed first, dismissed last --
  const tocEntries = createMemo(() => {
    const sections = allSections();
    const dis = dismissed();
    const active = sections.filter((s) => !dis.has(s.id));
    const hidden = sections.filter((s) => dis.has(s.id));
    return [...active, ...hidden];
  });

  // -- Progress: figure out first visible chapter via scroll --
  const [visibleChapterIdx, setVisibleChapterIdx] = createSignal(0);
  let scrollRef!: HTMLDivElement;

  onMount(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const idx = parseInt(
              (entry.target as HTMLElement).dataset.chapterIdx ?? "0",
              10,
            );
            setVisibleChapterIdx(idx);
          }
        }
      },
      { root: scrollRef, threshold: 0.1 },
    );

    // Observe chapter elements once mounted
    const chapterEls = scrollRef.querySelectorAll("[data-chapter-idx]");
    chapterEls.forEach((el) => observer.observe(el));

    onCleanup(() => observer.disconnect());
  });

  function scrollToSection(sectionId: string) {
    const el = document.getElementById(`guide-section-${sectionId}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      // Auto-expand when navigating via TOC
      setExpandedSections((prev) => {
        const next = new Set(prev);
        next.add(sectionId);
        return next;
      });
    }
  }

  let chapterCounter = 0;

  return (
    <div class="guide-tab" ref={scrollRef}>
      {/* ---- Sticky TOC ---- */}
      <div class="guide-toc" classList={{ "guide-toc--expanded": tocExpanded() }}>
        <button class="guide-toc-toggle" onClick={() => setTocExpanded((p) => !p)}>
          <span>Contents</span>
          <span>{tocExpanded() ? "\u25BC" : "\u25B6"}</span>
        </button>
        <ul class="guide-toc-list">
          <For each={tocEntries()}>
            {(section) => {
              const isDismissed = () => dismissed().has(section.id);
              return (
                <li
                  class="guide-toc-entry"
                  classList={{ "guide-toc-entry--dismissed": isDismissed() }}
                  onClick={() => scrollToSection(section.id)}
                >
                  <span>{section.title}</span>
                  <Show
                    when={!isDismissed()}
                    fallback={null}
                  >
                    <button
                      class="guide-toc-dismiss-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        dismiss(section.id);
                      }}
                    >
                      {"\u00D7"}
                    </button>
                  </Show>
                </li>
              );
            }}
          </For>
          <Show when={dismissed().size > 0}>
            <li>
              <button
                class="guide-expand-all-btn"
                style={{ "margin-top": "4px" }}
                onClick={(e) => {
                  e.stopPropagation();
                  showAll();
                }}
              >
                Show all
              </button>
            </li>
          </Show>
        </ul>
      </div>

      {/* ---- Domain-grouped chapters ---- */}
      <For each={grouped()}>
        {(group) => {
          return (
            <>
              <div class="guide-domain-divider">
                {"\u2501\u2501 " + DOMAIN_LABELS[group.domain] + " \u2501\u2501"}
              </div>
              <For each={group.chapters}>
                {(chapter) => {
                  const idx = chapterCounter++;
                  const allExpanded = () => allExpandedInChapter(chapter);
                  return (
                    <div class="guide-chapter" data-chapter-idx={idx}>
                      <div class="guide-chapter-header">
                        <h3 class="guide-chapter-title">{chapter.title}</h3>
                        <span class="guide-chapter-summary">{chapter.summary}</span>
                        <button
                          class="guide-expand-all-btn"
                          onClick={() =>
                            allExpanded()
                              ? collapseAllInChapter(chapter)
                              : expandAllInChapter(chapter)
                          }
                        >
                          {allExpanded() ? "Collapse All" : "Expand All"}
                        </button>
                      </div>
                      <For each={chapter.sections}>
                        {(section) => (
                          <SectionView
                            section={section}
                            expanded={expandedSections().has(section.id)}
                            onToggle={() => toggleSection(section.id)}
                          />
                        )}
                      </For>
                    </div>
                  );
                }}
              </For>
            </>
          );
        }}
      </For>

      {/* ---- Progress indicator ---- */}
      <Show when={chapters.length > 0}>
        <div class="guide-progress">
          Chapter {visibleChapterIdx() + 1} of {chapters.length}
        </div>
      </Show>
    </div>
  );
};
