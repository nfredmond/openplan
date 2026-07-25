import { describe, expect, it } from "vitest";
import { decodeHtmlEntities, htmlToPdfBlocks } from "@/lib/reports/pdf-text";
import type { PdfBlock } from "@/lib/reports/pdf-writer";

/**
 * The PDF is derived from the SAME html string the HTML export serves, so the
 * two cannot carry different content. These tests pin the extraction that makes
 * that true — in particular that document order survives and that a wrapper
 * `<div>` does not duplicate its children's text as a stray paragraph.
 */

function texts(blocks: PdfBlock[]): string[] {
  return blocks.map((b) =>
    b.kind === "row" ? b.cells.join(" | ") : b.kind === "spacer" ? "[spacer]" : b.text
  );
}

describe("htmlToPdfBlocks", () => {
  it("maps headings, paragraphs and list items in document order", () => {
    const blocks = htmlToPdfBlocks(`
      <h1>Corridor Analysis</h1>
      <h2>Scores</h2>
      <p>Accessibility is 61.</p>
      <h3>Detail</h3>
      <ul><li>First</li><li>Second</li></ul>
    `);

    expect(blocks).toEqual([
      { kind: "title", text: "Corridor Analysis" },
      { kind: "heading", level: 1, text: "Scores" },
      { kind: "paragraph", text: "Accessibility is 61." },
      { kind: "heading", level: 2, text: "Detail" },
      { kind: "listItem", text: "First" },
      { kind: "listItem", text: "Second" },
    ]);
  });

  it("attaches text to the innermost block, so a wrapper div does not duplicate it", () => {
    const blocks = htmlToPdfBlocks(`<div class="card"><h2>Equity</h2><p>Tract detail.</p></div>`);

    expect(texts(blocks)).toEqual(["Equity", "Tract detail."]);
  });

  it("keeps a table row's cells together instead of splitting them into paragraphs", () => {
    const blocks = htmlToPdfBlocks(`
      <table>
        <tr><th>Metric</th><th>Value</th></tr>
        <tr><td>Total Transit Stops</td><td>18</td></tr>
      </table>
    `);

    const rows = blocks.filter((b): b is Extract<PdfBlock, { kind: "row" }> => b.kind === "row");
    expect(rows).toHaveLength(2);
    expect(rows[0].cells).toEqual(["Metric", "Value"]);
    expect(rows[1].cells).toEqual(["Total Transit Stops", "18"]);
  });

  it("drops head, style and script content entirely", () => {
    const blocks = htmlToPdfBlocks(`
      <!doctype html><html><head><title>Ignore me</title>
      <style>.header h1 { font-size: 24px; color: #1d4ed8; }</style>
      </head><body><script>var x = 1;</script><h1>Real Title</h1></body></html>
    `);

    expect(texts(blocks)).toEqual(["Real Title"]);
  });

  it("strips inline formatting without losing the words it wrapped", () => {
    const blocks = htmlToPdfBlocks(`<p>The <strong>screening-grade</strong> figure is <em>not</em> calibrated.</p>`);
    expect(texts(blocks)).toEqual(["The screening-grade figure is not calibrated."]);
  });

  it("decodes the entities the HTML builders emit", () => {
    const blocks = htmlToPdfBlocks(`<p>Grass Valley &amp; Nevada City &mdash; &quot;core&quot; &lt;corridor&gt;</p>`);
    expect(texts(blocks)).toEqual(['Grass Valley & Nevada City — "core" <corridor>']);
  });

  it("collapses whitespace but keeps words apart across a br", () => {
    const blocks = htmlToPdfBlocks(`<p>one\n\n   two<br/>three</p>`);
    expect(texts(blocks)).toEqual(["one two three"]);
  });

  it("skips HTML comments", () => {
    const blocks = htmlToPdfBlocks(`<p>Kept</p><!-- <p>Dropped</p> --><p>Also kept</p>`);
    expect(texts(blocks)).toEqual(["Kept", "Also kept"]);
  });

  it("is deterministic", () => {
    const html = `<h1>A</h1><div><p>B</p><table><tr><td>C</td><td>D</td></tr></table></div>`;
    expect(htmlToPdfBlocks(html)).toEqual(htmlToPdfBlocks(html));
  });

  it("emits nothing for an empty or text-free document", () => {
    expect(htmlToPdfBlocks("")).toEqual([]);
    expect(htmlToPdfBlocks("<div></div><p>   </p>")).toEqual([]);
  });

  it("does not leave a trailing or leading spacer around a table", () => {
    const blocks = htmlToPdfBlocks(`<table><tr><td>only</td></tr></table>`);
    expect(blocks[blocks.length - 1].kind).not.toBe("spacer");
    expect(blocks[0].kind).not.toBe("spacer");
  });

  /**
   * The property that matters most: every <h2> the HTML export shows must reach
   * the PDF. This is the shape of the real corridor report.
   */
  it("carries every section heading of a report-shaped document", () => {
    const sections = [
      "Corridor Scores",
      "Funding Program Lens",
      "Analysis Summary",
      "AI Interpretation",
      "Demographics &amp; Commute",
      "Employment",
      "Transit Access",
      "Safety",
      "Equity &amp; EJ",
      "Title VI",
      "Data Sources &amp; Quality",
      "Active Map View",
      "Analysis Query",
    ];
    const html = `<h1>Report</h1>${sections
      .map((s) => `<div class="section"><h2>${s}</h2><p>Body for ${s}.</p></div>`)
      .join("")}`;

    const headings = htmlToPdfBlocks(html)
      .filter((b): b is Extract<PdfBlock, { kind: "heading" }> => b.kind === "heading")
      .map((b) => b.text);

    expect(headings).toEqual(sections.map((s) => decodeHtmlEntities(s)));
  });
});

describe("decodeHtmlEntities", () => {
  it("decodes named and numeric references", () => {
    expect(decodeHtmlEntities("&amp;&lt;&gt;&quot;&#39;&nbsp;")).toBe("&<>\"' ");
    expect(decodeHtmlEntities("&#8212;")).toBe("—");
    expect(decodeHtmlEntities("&#x2014;")).toBe("—");
  });

  it("leaves an unknown reference alone rather than mangling it", () => {
    expect(decodeHtmlEntities("&notarealentity;")).toBe("&notarealentity;");
  });
});
