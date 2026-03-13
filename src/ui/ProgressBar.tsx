import { createSignal, onMount, onCleanup } from "solid-js";
import { visStore } from "../utils/visualisationStore";

export function ProgressBar() {
  const [containerWidth, setContainerWidth] = createSignal<number | null>(null);

  let containerRef: HTMLDivElement | undefined;
  let resizeObserver: ResizeObserver | undefined;

  onMount(() => {
    // Attempt to sync width with the sibling toolbar-row
    const toolbarRow = containerRef?.parentElement?.querySelector(".toolbar-row");
    if (toolbarRow) {
      resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          setContainerWidth(entry.contentRect.width);
        }
      });
      resizeObserver.observe(toolbarRow);

      // Initial width
      const rect = toolbarRow.getBoundingClientRect();
      if (rect.width > 0) {
        setContainerWidth(rect.width);
      }
    }
  });

  onCleanup(() => {
    resizeObserver?.disconnect();
  });

  return (
    <div
      id="toolbar-bar-progress-container"
      ref={containerRef}
      role="presentation"
      style={{
        width: containerWidth() !== null ? `${containerWidth()}px` : "100%",
        "pointer-events": "none",
        display: "block",
      }}
    >
      <div
        id="toolbar-bar-progress"
        style={{
          transform: `scaleX(${Math.max(0, Math.min(1, visStore.bar))})`,
          "pointer-events": "none",
        }}
      />
    </div>
  );
}
