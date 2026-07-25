import { describe, expect, it } from "vitest";
import {
  measureText,
  toPdfLiteral,
  writeTextPdf,
  type PdfBlock,
} from "@/lib/reports/pdf-writer";

/**
 * The property this module exists for: NOTHING IS DROPPED.
 *
 * The two writers it replaces emitted `/Count 1` and cut their content with
 * `.slice(0, 48)` / `.slice(0, 60)`, so a multi-chapter RTP packet exported as
 * one clipped page with no indication anything was missing.
 */

const decoder = new TextDecoder("latin1");

function asText(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

/** Every `(…) Tj` operand across the document, in page order. */
function drawnStrings(bytes: Uint8Array): string[] {
  const source = asText(bytes);
  const out: string[] = [];
  for (const match of source.matchAll(/\(([\s\S]*?)\) Tj/g)) {
    out.push(match[1]);
  }
  return out;
}

function doc(blocks: PdfBlock[], title = "Test Packet") {
  return { title, generatedAt: null, blocks };
}

describe("writeTextPdf structure", () => {
  it("declares a page count matching the pages it actually emitted", () => {
    const blocks: PdfBlock[] = Array.from({ length: 400 }, (_, i) => ({
      kind: "paragraph" as const,
      text: `Paragraph number ${i} with enough words to occupy a full line of the text column.`,
    }));

    const result = writeTextPdf(doc(blocks));
    const source = asText(result.bytes);

    const pageObjects = [...source.matchAll(/\/Type \/Page[^s]/g)].length;
    const declared = Number(/\/Count (\d+)/.exec(source)?.[1]);

    expect(result.pageCount).toBeGreaterThan(1);
    expect(declared).toBe(result.pageCount);
    expect(pageObjects).toBe(result.pageCount);
  });

  it("writes xref offsets that point at their own object headers", () => {
    const result = writeTextPdf(
      doc([
        { kind: "heading", level: 1, text: "Chapter One" },
        { kind: "paragraph", text: "Body text." },
      ])
    );
    const source = asText(result.bytes);

    const xrefStart = Number(/startxref\n(\d+)/.exec(source)?.[1]);
    expect(Number.isFinite(xrefStart)).toBe(true);
    expect(source.slice(xrefStart, xrefStart + 4)).toBe("xref");

    const offsets = [...source.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    expect(offsets.length).toBeGreaterThan(4);

    offsets.forEach((offset, index) => {
      // Entry i (0-based) describes object i+1.
      expect(source.slice(offset)).toMatch(new RegExp(`^${index + 1} 0 obj`));
    });
  });

  it("declares a byte-accurate /Length for every content stream", () => {
    const result = writeTextPdf(
      doc([
        { kind: "paragraph", text: "Ordinary ASCII." },
        // Multi-byte source characters that serialize to octal escapes.
        { kind: "paragraph", text: "Em dash — curly quote ’ ellipsis … accented Peñasco." },
      ])
    );
    const source = asText(result.bytes);

    const streams = [...source.matchAll(/<< \/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/g)];
    expect(streams.length).toBeGreaterThan(0);

    for (const [, declared, body] of streams) {
      expect(new TextEncoder().encode(body).length).toBe(Number(declared));
    }
  });

  it("produces byte-identical output for identical input", () => {
    const blocks: PdfBlock[] = [
      { kind: "heading", level: 2, text: "Repeatable" },
      { kind: "paragraph", text: "Determinism is what makes artifact assertions safe." },
      { kind: "row", cells: ["Metric", "42"] },
    ];

    const a = writeTextPdf(doc(blocks));
    const b = writeTextPdf(doc(blocks));

    expect(Array.from(a.bytes)).toEqual(Array.from(b.bytes));
  });

  it("carries no creation date or document id that would break determinism", () => {
    const source = asText(writeTextPdf(doc([{ kind: "paragraph", text: "x" }])).bytes);
    expect(source).not.toMatch(/CreationDate/);
    expect(source).not.toMatch(/\/ID\s*\[/);
  });
});

describe("writeTextPdf never truncates", () => {
  it("renders the LAST line of a very long document", () => {
    const blocks: PdfBlock[] = Array.from({ length: 5000 }, (_, i) => ({
      kind: "paragraph" as const,
      text: `Line ${i}`,
    }));
    blocks.push({ kind: "paragraph", text: "FINAL-SENTINEL-LINE" });

    const result = writeTextPdf(doc(blocks));
    const drawn = drawnStrings(result.bytes);

    expect(drawn).toContain("FINAL-SENTINEL-LINE");
    expect(drawn).toContain("Line 0");
    expect(drawn).toContain("Line 4999");
  });

  it("keeps every one of a long chapter list, not the first N", () => {
    const blocks: PdfBlock[] = Array.from({ length: 120 }, (_, i) => ({
      kind: "heading" as const,
      level: 2 as const,
      text: `Chapter ${i + 1}`,
    }));

    const drawn = drawnStrings(writeTextPdf(doc(blocks)).bytes);

    for (let i = 1; i <= 120; i += 1) {
      expect(drawn).toContain(`Chapter ${i}`);
    }
  });

  it("announces the page-limit backstop instead of cutting silently", () => {
    const blocks: PdfBlock[] = Array.from({ length: 2000 }, (_, i) => ({
      kind: "paragraph" as const,
      text: `Filler paragraph ${i} carrying enough text to consume a line of the column.`,
    }));

    const result = writeTextPdf(doc(blocks), { maxPages: 3 });
    const drawn = drawnStrings(result.bytes).join(" ");

    expect(drawn).toMatch(/reached the 3-page safety limit/);
    expect(drawn).toMatch(/were not rendered/);
    expect(drawn).toMatch(/Nothing above this page has been shortened/);
  });
});

describe("writeTextPdf typesetting", () => {
  it("numbers every page as i of N", () => {
    const blocks: PdfBlock[] = Array.from({ length: 300 }, (_, i) => ({
      kind: "paragraph" as const,
      text: `Paragraph ${i} with sufficient length to fill out the available text column width.`,
    }));

    const result = writeTextPdf(doc(blocks));
    const drawn = drawnStrings(result.bytes);

    for (let page = 1; page <= result.pageCount; page += 1) {
      expect(drawn).toContain(`Page ${page} of ${result.pageCount}`);
    }
  });

  it("appends a footer label when one is supplied", () => {
    const drawn = drawnStrings(
      writeTextPdf(doc([{ kind: "paragraph", text: "x" }]), { footerLabel: "Nevada County RTP" }).bytes
    );
    expect(drawn.some((s) => s.includes("Nevada County RTP"))).toBe(true);
  });

  it("wraps by measured width so no line overflows the text column", () => {
    const longWord = "Supercalifragilistic".repeat(12);
    const blocks: PdfBlock[] = [
      { kind: "paragraph", text: "W".repeat(400) },
      { kind: "paragraph", text: longWord },
      { kind: "paragraph", text: Array.from({ length: 80 }, () => "widthy").join(" ") },
    ];

    const result = writeTextPdf(doc(blocks));
    // Letter width 612 - 2 * 50pt margin.
    const usable = 512;

    for (const drawnText of drawnStrings(result.bytes)) {
      // Footers are 8pt; body is 10pt. Measure at the larger to stay strict.
      expect(measureText(drawnText, "F1", 10)).toBeLessThanOrEqual(usable + 0.5);
    }
  });

  it("breaks an unbreakable token rather than letting it run off the page", () => {
    const url = `https://example.gov/${"segment".repeat(60)}`;
    const drawn = drawnStrings(writeTextPdf(doc([{ kind: "paragraph", text: url }])).bytes);
    const rejoined = drawn.filter((s) => s.includes("segment") || s.includes("https")).join("");
    expect(rejoined).toContain("https://example.gov/");
    expect(rejoined.match(/segment/g)?.length).toBe(60);
  });
});

describe("writeTextPdf encoding", () => {
  it("renders WinAnsi punctuation as itself, not as a question mark", () => {
    const result = writeTextPdf(
      doc([{ kind: "paragraph", text: "Grass Valley — the “core” corridor’s peak … Peñasco" }])
    );
    const drawn = drawnStrings(result.bytes).join(" ");

    expect(drawn).toContain("\\227"); // em dash
    expect(drawn).toContain("\\223"); // left double quote
    expect(drawn).toContain("\\224"); // right double quote
    expect(drawn).toContain("\\222"); // right single quote
    expect(drawn).toContain("\\205"); // ellipsis
    expect(drawn).toContain("\\361"); // n-tilde
    expect(result.unsupportedCharacters).toEqual([]);
  });

  it("escapes the delimiters that would otherwise corrupt the stream", () => {
    expect(toPdfLiteral("a(b)c\\d")).toBe("a\\(b\\)c\\\\d");
  });

  it("reports characters it could not represent instead of hiding them", () => {
    const result = writeTextPdf(doc([{ kind: "paragraph", text: "Kanji 日本語 here" }]));
    expect(result.unsupportedCharacters).toEqual(["日", "本", "語"]);
    expect(drawnStrings(result.bytes).join(" ")).toContain("???");
  });

  it("declares WinAnsiEncoding on both fonts", () => {
    const source = asText(writeTextPdf(doc([{ kind: "paragraph", text: "x" }])).bytes);
    expect(source).toMatch(/\/BaseFont \/Helvetica \/Encoding \/WinAnsiEncoding/);
    expect(source).toMatch(/\/BaseFont \/Helvetica-Bold \/Encoding \/WinAnsiEncoding/);
  });
});

describe("measureText", () => {
  it("measures a known Helvetica string against its AFM widths", () => {
    // "AV" at 10pt = (667 + 667) / 1000 * 10.
    expect(measureText("AV", "F1", 10)).toBeCloseTo(13.34, 5);
    // Bold "AV" = (722 + 667) / 1000 * 10.
    expect(measureText("AV", "F2", 10)).toBeCloseTo(13.89, 5);
  });

  it("scales linearly with point size", () => {
    expect(measureText("hello world", "F1", 20)).toBeCloseTo(measureText("hello world", "F1", 10) * 2, 5);
  });

  it("counts an em dash as wider than a hyphen", () => {
    expect(measureText("—", "F1", 10)).toBeGreaterThan(measureText("-", "F1", 10));
  });
});
