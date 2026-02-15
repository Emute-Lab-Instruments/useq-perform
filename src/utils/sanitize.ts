import DOMPurify from "dompurify";

/**
 * Sanitize an HTML string for safe use with innerHTML.
 * Allows basic formatting tags and strips scripts/event handlers.
 */
export function sanitizeHtml(dirty: string): string {
  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS: [
      "b", "i", "em", "strong", "code", "pre", "span", "div", "p",
      "br", "ul", "ol", "li", "a", "h1", "h2", "h3", "h4", "h5", "h6",
      "blockquote", "table", "thead", "tbody", "tr", "th", "td",
      "sup", "sub", "hr", "dl", "dt", "dd",
    ],
    ALLOWED_ATTR: ["href", "target", "rel", "class", "title"],
  });
}
