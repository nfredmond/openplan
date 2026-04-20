import { describe, it, expect } from "vitest";
import { renderChapterMarkdownToHtml } from "@/lib/markdown/render";

describe("renderChapterMarkdownToHtml", () => {
  it("returns empty string for null, undefined, or whitespace-only input", () => {
    expect(renderChapterMarkdownToHtml(null)).toBe("");
    expect(renderChapterMarkdownToHtml(undefined)).toBe("");
    expect(renderChapterMarkdownToHtml("")).toBe("");
    expect(renderChapterMarkdownToHtml("   \n\n  ")).toBe("");
  });

  it("renders headings, paragraphs, and inline emphasis", () => {
    const html = renderChapterMarkdownToHtml(
      "# Chapter title\n\nA paragraph with **bold** and *italic* text.",
    );
    expect(html).toContain("<h1>Chapter title</h1>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
  });

  it("renders GitHub-flavored markdown tables", () => {
    const table = [
      "| Facility | Observed | Modeled |",
      "| --- | ---: | ---: |",
      "| SR-174 | 73,666 | 34,775 |",
    ].join("\n");
    const html = renderChapterMarkdownToHtml(table);
    expect(html).toContain("<table>");
    expect(html).toContain("<th>Facility</th>");
    expect(html).toMatch(/<td[^>]*>73,666<\/td>/);
  });

  it("renders blockquotes used for caveats", () => {
    const html = renderChapterMarkdownToHtml("> Warning: screening-grade only.");
    expect(html).toContain("<blockquote>");
    expect(html).toContain("screening-grade only");
  });

  it("strips <script> tags from markdown-embedded HTML", () => {
    const html = renderChapterMarkdownToHtml(
      "Before<script>alert('xss')</script>After",
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain("alert(");
  });

  it("strips inline event-handler attributes", () => {
    const html = renderChapterMarkdownToHtml(
      '<div onclick="alert(1)" onmouseover=\'alert(2)\'>hi</div>',
    );
    expect(html).not.toMatch(/onclick\s*=/i);
    expect(html).not.toMatch(/onmouseover\s*=/i);
  });

  it("strips javascript: protocol from href-like attributes", () => {
    const html = renderChapterMarkdownToHtml("[click](javascript:alert(1))");
    expect(html.toLowerCase()).not.toContain("javascript:");
  });

  it("strips <iframe>, <object>, <embed>, and <link> tags", () => {
    const html = renderChapterMarkdownToHtml(
      [
        "<iframe src='evil'></iframe>",
        "<object data='evil'></object>",
        "<embed src='evil'>",
        "<link rel='stylesheet' href='evil.css'>",
        "ok",
      ].join("\n"),
    );
    expect(html).not.toMatch(/<iframe/i);
    expect(html).not.toMatch(/<object/i);
    expect(html).not.toMatch(/<embed/i);
    expect(html).not.toMatch(/<link/i);
    expect(html).toContain("ok");
  });
});
