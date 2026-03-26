/**
 * Guide data index — single entry point for all chapter content.
 * See docs/USER_GUIDE_SPEC.md for the full specification.
 */

import type { Chapter, GuideDomain } from "./guideTypes";
import { chapter1 } from "./chapters/ch1-language";
import { chapter2 } from "./chapters/ch2-algebra";
import { chapter3 } from "./chapters/ch3-modulation";
import { chapter4 } from "./chapters/ch4-rhythm";
import { chapter5 } from "./chapters/ch5-editor";

/** All guide chapters in reading order. */
export const chapters: Chapter[] = [
  chapter1,
  chapter2,
  chapter3,
  chapter4,
  chapter5,
];

/** Display labels for each domain. */
export const domainLabels: Record<GuideDomain, string> = {
  language: "Language",
  editor: "Editor",
};

/**
 * Domain ordering — language chapters appear first, editor chapters after.
 * Within each domain, chapters appear in their array order.
 */
export const domainOrder: GuideDomain[] = ["language", "editor"];

/** Group chapters by domain, preserving order. */
export function chaptersByDomain(): Array<{
  domain: GuideDomain;
  label: string;
  chapters: Chapter[];
}> {
  return domainOrder
    .map((domain) => ({
      domain,
      label: domainLabels[domain],
      chapters: chapters.filter((ch) => ch.domain === domain),
    }))
    .filter((group) => group.chapters.length > 0);
}
