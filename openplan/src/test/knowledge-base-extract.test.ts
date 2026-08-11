import { readFileSync } from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { beforeAll, describe, expect, it } from "vitest";
import {
  DocumentParseError,
  extractDocument,
  extractedFromText,
  isExtractableSourceKind,
  NoExtractableTextError,
  resolveSourceKind,
  resolveStoredSourceKind,
} from "@/lib/knowledge-base/extract";

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

/** Build a minimal, valid .docx around the given <w:body> inner XML. */
async function buildDocx(bodyInnerXml: string): Promise<Uint8Array> {
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${bodyInnerXml}</w:body>
</w:document>`;
  const zip = new JSZip();
  zip.file("[Content_Types].xml", CONTENT_TYPES_XML);
  zip.folder("_rels")!.file(".rels", RELS_XML);
  zip.folder("word")!.file("document.xml", documentXml);
  return zip.generateAsync({ type: "uint8array" });
}

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

describe("resolveSourceKind", () => {
  it("maps supported content types", () => {
    expect(resolveSourceKind("application/pdf", "x.pdf")).toBe("uploaded_pdf");
    expect(
      resolveSourceKind(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "x.docx"
      )
    ).toBe("uploaded_docx");
    expect(resolveSourceKind("text/plain", "x.txt")).toBe("uploaded_txt");
    expect(resolveSourceKind("text/markdown", "x.md")).toBe("uploaded_md");
  });

  it("strips content-type parameters", () => {
    expect(resolveSourceKind("application/pdf; charset=binary", null)).toBe("uploaded_pdf");
  });

  it("falls back to the filename extension for generic octet-stream", () => {
    expect(resolveSourceKind("application/octet-stream", "plan.pdf")).toBe("uploaded_pdf");
    expect(resolveSourceKind("application/octet-stream", "notes.md")).toBe("uploaded_md");
    expect(resolveSourceKind("", "report.docx")).toBe("uploaded_docx");
  });

  it("returns null for non-extractable formats (they may still be storable)", () => {
    expect(resolveSourceKind("image/png", "scan.png")).toBeNull();
    expect(resolveSourceKind("application/octet-stream", "mystery")).toBeNull();
  });
});

describe("resolveStoredSourceKind", () => {
  it("maps images, spreadsheets, CAD, and listed office formats", () => {
    expect(resolveStoredSourceKind("image/png", "scan.png")).toEqual({
      kind: "uploaded_image",
      contentType: "image/png",
    });
    expect(resolveStoredSourceKind("text/csv", "costs.csv")).toEqual({
      kind: "uploaded_spreadsheet",
      contentType: "text/csv",
    });
    expect(resolveStoredSourceKind("image/vnd.dwg", "site.dwg")).toEqual({
      kind: "uploaded_cad",
      contentType: "image/vnd.dwg",
    });
    expect(resolveStoredSourceKind("application/msword", "memo.doc")).toEqual({
      kind: "uploaded_other",
      contentType: "application/msword",
    });
  });

  it("falls back to the filename extension for generic content types, answering the CANONICAL type", () => {
    expect(resolveStoredSourceKind("application/octet-stream", "exhibit.tif")).toEqual({
      kind: "uploaded_image",
      contentType: "image/tiff",
    });
    expect(resolveStoredSourceKind("", "model.dxf")).toEqual({
      kind: "uploaded_cad",
      contentType: "image/vnd.dxf",
    });
    // Vendor spelling of the same declared type still lands on the canonical one.
    expect(resolveStoredSourceKind("application/acad", "plan.dwg")).toEqual({
      kind: "uploaded_cad",
      contentType: "image/vnd.dwg",
    });
  });

  it("keeps genuinely unknown formats on the refusal path", () => {
    expect(resolveStoredSourceKind("application/zip", "bundle.zip")).toBeNull();
    expect(resolveStoredSourceKind("text/html", "page.html")).toBeNull();
    expect(resolveStoredSourceKind("image/svg+xml", "icon.svg")).toBeNull();
    expect(resolveStoredSourceKind("application/octet-stream", "mystery")).toBeNull();
    expect(resolveStoredSourceKind("application/x-msdownload", "setup.exe")).toBeNull();
  });
});

describe("isExtractableSourceKind", () => {
  it("splits the union exactly along the stored boundary", () => {
    expect(isExtractableSourceKind("uploaded_pdf")).toBe(true);
    expect(isExtractableSourceKind("pasted_text")).toBe(true);
    expect(isExtractableSourceKind("uploaded_image")).toBe(false);
    expect(isExtractableSourceKind("uploaded_spreadsheet")).toBe(false);
    expect(isExtractableSourceKind("uploaded_cad")).toBe(false);
    expect(isExtractableSourceKind("uploaded_other")).toBe(false);
  });
});

describe("extractDocument — plain text", () => {
  it("extracts UTF-8 text as a single page", async () => {
    const result = await extractDocument(encode("Line one.\nLine two."), "uploaded_txt");
    expect(result.pageCount).toBe(1);
    expect(result.pages).toHaveLength(1);
    expect(result.text).toContain("Line one.");
    expect(result.charCount).toBe(result.text.length);
  });

  it("throws NoExtractableTextError for an empty text file", async () => {
    await expect(extractDocument(encode("   \n\n  "), "uploaded_txt")).rejects.toBeInstanceOf(
      NoExtractableTextError
    );
  });
});

describe("extractedFromText (pasted path)", () => {
  it("builds a single-page document", () => {
    const doc = extractedFromText("Pasted RTP goal statement.");
    expect(doc.pageCount).toBe(1);
    expect(doc.text).toContain("Pasted RTP goal");
  });

  it("rejects empty pasted text", () => {
    expect(() => extractedFromText("")).toThrow(NoExtractableTextError);
  });
});

describe("extractDocument — DOCX (real mammoth)", () => {
  it("extracts body text", async () => {
    const bytes = await buildDocx(
      "<w:p><w:r><w:t>Regional Transportation Plan draft narrative.</w:t></w:r></w:p>"
    );
    const result = await extractDocument(bytes, "uploaded_docx");
    expect(result.text).toContain("Regional Transportation Plan");
    expect(result.pageCount).toBe(1);
  });

  it("throws NoExtractableTextError for an empty-body document", async () => {
    const bytes = await buildDocx("");
    await expect(extractDocument(bytes, "uploaded_docx")).rejects.toBeInstanceOf(
      NoExtractableTextError
    );
  });
});

describe("extractDocument — PDF (real unpdf)", () => {
  let pdfBytes: Uint8Array;
  beforeAll(() => {
    // vitest runs from the openplan package root.
    pdfBytes = new Uint8Array(
      readFileSync(path.resolve(process.cwd(), "src/test/fixtures/knowledge-base/sample.pdf"))
    );
  });

  it("extracts the text layer with page anchoring", async () => {
    const result = await extractDocument(pdfBytes, "uploaded_pdf");
    expect(result.pageCount).toBeGreaterThanOrEqual(1);
    expect(result.text).toContain("OpenPlan");
    expect(result.pages[0].page).toBe(1);
  });

  it("does not detach the caller's buffer (bytes remain usable afterward)", async () => {
    const before = pdfBytes.byteLength;
    await extractDocument(pdfBytes, "uploaded_pdf");
    expect(pdfBytes.byteLength).toBe(before);
    expect(before).toBeGreaterThan(0);
  });

  it("throws NoExtractableTextError for a text-less (scanned-style) PDF", async () => {
    const emptyPdf = encode(
      "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\ntrailer<</Root 1 0 R/Size 4>>\n%%EOF"
    );
    await expect(extractDocument(emptyPdf, "uploaded_pdf")).rejects.toBeInstanceOf(
      NoExtractableTextError
    );
  });

  it("throws DocumentParseError for bytes that are not a PDF", async () => {
    await expect(extractDocument(encode("this is not a pdf"), "uploaded_pdf")).rejects.toBeInstanceOf(
      DocumentParseError
    );
  });
});
