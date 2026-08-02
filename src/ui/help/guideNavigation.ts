/**
 * Guide navigation — open the help panel at a specific guide section.
 *
 * Spec: `docs/specs/the-machine.md` §5.1.
 *
 * Two halves, deliberately split so the editor never imports UI:
 *
 *   1. `guideSectionRequestChannel` (contracts) — anyone may publish a
 *      request. The editor's diagnostic surface does exactly that.
 *   2. This module — subscribes, opens the Help panel, switches to the Guide
 *      tab, and re-publishes so `GuideTab` can expand and scroll.
 *
 * Imported for side effect from `src/ui/adapters/panels.tsx`, which bootstrap
 * loads, so the bridge is live before any diagnostic can be rendered.
 */

import { guideSectionRequestChannel } from "../../contracts/guideChannels";
import { helpTabSwitchChannel } from "./helpChannels";

const GUIDE_TAB_ID = "panel-help-tab-guide-v2";

let bridgeStarted = false;
/** Guards against the bridge's own re-entrant publish. */
let handling = false;

/**
 * Open the help panel at a guide section. Safe to call from anywhere in the
 * UI layer.
 */
export async function openGuideSection(sectionId: string): Promise<void> {
  // Dynamic import: `panels.tsx` imports this module for its side effect, so
  // a static import back into it would be a cycle.
  const { showChromePanel } = await import("../adapters/panels");
  showChromePanel("help");
  helpTabSwitchChannel.publish({ tabId: GUIDE_TAB_ID });
  // Re-publish so a GuideTab that has only just mounted still hears it.
  handling = true;
  try {
    guideSectionRequestChannel.publish({ sectionId, source: "api" });
  } finally {
    handling = false;
  }
}

/**
 * Subscribe to guide-section requests. Idempotent; called on module load.
 */
export function startGuideNavigationBridge(): () => void {
  if (bridgeStarted) return () => undefined;
  bridgeStarted = true;
  const unsub = guideSectionRequestChannel.subscribe(({ sectionId }) => {
    if (handling) return;
    void openGuideSection(sectionId);
  });
  return () => {
    bridgeStarted = false;
    unsub();
  };
}

startGuideNavigationBridge();
