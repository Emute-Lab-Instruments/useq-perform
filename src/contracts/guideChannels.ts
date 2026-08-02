// src/contracts/guideChannels.ts
//
// Typed channel for user-guide navigation requests.
//
// Lives in contracts/ (rather than in the help panel) because the publisher
// is the editor's diagnostic surface and the subscribers are UI: routing it
// through a contract keeps `src/editors/` from importing `src/ui/`.
//
// Spec: docs/specs/the-machine.md §5.1 — diagnostics rendered to users may
// link to the guide section that explains their category.

import { createChannel, type TypedChannel } from "../lib/typedChannel";

export interface GuideSectionRequest {
  /** `Section.id` in the guide data, e.g. "machine-outputs". */
  sectionId: string;
  /** Where the request came from, for debugging. */
  source?: "diagnostic" | "machine" | "api";
}

/**
 * Fires when something asks the guide to open at a particular section.
 *
 * `src/ui/help/guideNavigation.ts` opens the help panel and switches to the
 * Guide tab; `GuideTab` expands and scrolls to the section.
 */
export const guideSectionRequestChannel: TypedChannel<GuideSectionRequest> =
  createChannel<GuideSectionRequest>();
