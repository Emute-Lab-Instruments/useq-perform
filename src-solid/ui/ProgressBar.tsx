import { createSignal, onMount, onCleanup } from "solid-js";

export function ProgressBar() {
  const [barValue, setBarValue] = createSignal(0);
  const [containerWidth, setContainerWidth] = createSignal<number | null>(null);
  
  let containerRef: HTMLDivElement | undefined;
  let resizeObserver: ResizeObserver | undefined;

  const handleVisualisationChange = (e: Event) => {
    const detail = (e as CustomEvent).detail;
    if (detail && typeof detail.bar === "number") {
      setBarValue(detail.bar);
    }
  };

  onMount(() => {
    window.addEventListener("useq-visualisation-changed", handleVisualisationChange);
    
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
    window.removeEventListener("useq-visualisation-changed", handleVisualisationChange);
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
        display: "block"
      }}
    >
      <div 
        id="toolbar-bar-progress" 
        style={{
          transform: `scaleX(${Math.max(0, Math.min(1, barValue()))})`,
          "pointer-events": "none"
        }}
      />
    </div>
  );
}
