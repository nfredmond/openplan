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

  it("keeps safe markdown links while removing unsafe URL attributes", () => {
    const safe = renderChapterMarkdownToHtml("[OpenPlan](https://openplan.city)");
    expect(safe).toContain('<a href="https://openplan.city">OpenPlan</a>');

    const unsafe = renderChapterMarkdownToHtml("[click](&#106;avascript:alert(1))");
    expect(unsafe).toContain("click");
    expect(unsafe).not.toMatch(/href=/i);
    expect(unsafe).not.toMatch(/javascript/i);
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

  it("strips unquoted event-handler attributes", () => {
    const html = renderChapterMarkdownToHtml("<div onclick=alert(1)>hi</div>");
    expect(html).not.toMatch(/onclick/i);
    expect(html).toContain("hi");
  });

  it("strips onload handler on <svg>", () => {
    const html = renderChapterMarkdownToHtml(
      "<svg onload=\"alert('svg')\"><circle cx='5' cy='5' r='4'/></svg>",
    );
    expect(html).not.toMatch(/onload/i);
  });

  it("strips onerror handler on <img>", () => {
    const html = renderChapterMarkdownToHtml(
      "<img src='x' onerror='alert(1)'>",
    );
    expect(html).not.toMatch(/onerror/i);
  });

  it("strips <script> blocks nested inside <svg>", () => {
    const html = renderChapterMarkdownToHtml(
      "<svg><script>alert(1)</script><circle/></svg>",
    );
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toContain("alert(");
  });

  it("strips entity-encoded javascript: URIs that the legacy regex missed", () => {
    const html = renderChapterMarkdownToHtml(
      '<a href="&#106;avascript:alert(1)">click</a>',
    );
    expect(html).not.toMatch(/javascript/i);
    expect(html).not.toContain("alert(");
  });

  it("strips data:text/html URIs that the legacy regex missed", () => {
    const html = renderChapterMarkdownToHtml(
      '<a href="data:text/html,<script>alert(1)</script>">click</a>',
    );
    expect(html).not.toMatch(/data:text\/html/i);
    expect(html).not.toContain("alert(");
  });

  it("strips <style> tags and inline style attributes", () => {
    const html = renderChapterMarkdownToHtml(
      "<style>body{display:none}</style><p style=\"color:red\">hi</p>",
    );
    expect(html).not.toMatch(/<style/i);
    expect(html).not.toMatch(/style\s*=/i);
    expect(html).toContain("hi");
  });

  it("wraps GFM tables in a chapter-markdown-table-wrap div for horizontal overflow", () => {
    const table = [
      "| A | B |",
      "| --- | --- |",
      "| 1 | 2 |",
    ].join("\n");
    const html = renderChapterMarkdownToHtml(table);
    expect(html).toContain('<div class="chapter-markdown-table-wrap">');
    expect(html).toMatch(/<div class="chapter-markdown-table-wrap">\s*<table/);
    expect(html).toMatch(/<\/table>\s*<\/div>/);
  });
});
