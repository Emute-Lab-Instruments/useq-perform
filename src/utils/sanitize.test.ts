import { describe, it, expect } from "vitest";
import { sanitizeHtml } from "./sanitize";

describe("sanitizeHtml", () => {
  it("allows basic formatting tags", () => {
    const input = "<p>Hello <strong>world</strong></p>";
    expect(sanitizeHtml(input)).toBe(input);
  });

  it("allows links with href, target, rel attributes", () => {
    const input =
      '<a href="https://example.com" target="_blank" rel="noopener">Link</a>';
    expect(sanitizeHtml(input)).toBe(input);
  });

  it("strips script tags", () => {
    const input = '<p>Safe</p><script>alert("xss")</script>';
    expect(sanitizeHtml(input)).toBe("<p>Safe</p>");
  });

  it("strips event handler attributes", () => {
    const input = '<div onclick="alert(1)">Click me</div>';
    expect(sanitizeHtml(input)).toBe("<div>Click me</div>");
  });

  it("strips onerror event handlers", () => {
    const input = '<img src="x" onerror="alert(1)">';
    expect(sanitizeHtml(input)).toBe("");
  });

  it("strips onload event handlers", () => {
    const input = '<body onload="alert(1)">Content</body>';
    expect(sanitizeHtml(input)).toBe("Content");
  });

  it("strips javascript: URLs", () => {
    const input = '<a href="javascript:alert(1)">Click</a>';
    expect(sanitizeHtml(input)).toBe('<a>Click</a>');
  });

  it("allows code and pre tags", () => {
    const input = "<pre><code>const x = 1;</code></pre>";
    expect(sanitizeHtml(input)).toBe(input);
  });

  it("allows headings", () => {
    const input = "<h1>Title</h1><h2>Subtitle</h2>";
    expect(sanitizeHtml(input)).toBe(input);
  });

  it("allows lists", () => {
    const input = "<ul><li>Item 1</li><li>Item 2</li></ul>";
    expect(sanitizeHtml(input)).toBe(input);
  });

  it("allows tables", () => {
    const input =
      "<table><thead><tr><th>Header</th></tr></thead><tbody><tr><td>Cell</td></tr></tbody></table>";
    expect(sanitizeHtml(input)).toBe(input);
  });

  it("returns empty string for undefined/null-like input", () => {
    expect(sanitizeHtml("")).toBe("");
  });

  it("handles user-guide-like content with embedded script", () => {
    const input = `
      <h1>User Guide</h1>
      <p>Welcome to the guide.</p>
      <script>document.location = 'https://evil.com'</script>
      <p>More content here.</p>
    `;
    const result = sanitizeHtml(input);
    expect(result).not.toContain("<script>");
    expect(result).toContain("<h1>User Guide</h1>");
    expect(result).toContain("More content here");
  });

  it("strips multiple event handlers from single element", () => {
    const input =
      '<div onclick="a()" onmouseover="b()" onfocus="c()">Text</div>';
    expect(sanitizeHtml(input)).toBe("<div>Text</div>");
  });
});
