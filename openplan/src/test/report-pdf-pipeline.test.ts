import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const existsSyncMock = vi.fn();
const launchMock = vi.fn();

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  const patched = { ...actual, existsSync: (...args: unknown[]) => existsSyncMock(...args) };
  return { ...patched, default: patched };
});

vi.mock("puppeteer-core", () => ({
  default: { launch: (...args: unknown[]) => launchMock(...args) },
}));

import {
  BUILTIN_PDF_NOTICE,
  detectPdfEngineAvailability,
  renderReportPdf,
} from "@/lib/reports/pdf";

/**
 * One pipeline, two typesetting tiers, one content source.
 *
 * Both tiers consume the same `html` string, so no section, figure or caveat
 * can differ between them — the fork is purely typographic. That is what makes
 * the fallback honest rather than a silent fidelity downgrade, and these tests
 * pin it along with the disclosure that accompanies it.
 */

const decoder = new TextDecoder("latin1");

function drawnText(bytes: Uint8Array): string {
  const source = decoder.decode(bytes);
  return [...source.matchAll(/\(([\s\S]*?)\) Tj/g)].map((m) => m[1]).join(" ");
}

const REPORT_HTML = `<!doctype html><html><head><style>h1{color:red}</style></head><body>
  <h1>Nevada County RTP Packet</h1>
  <h2>Corridor Scores</h2><p>Accessibility 61 of 100.</p>
  <h2>Safety</h2><p>No crash source answered.</p>
  <h2>Appendix</h2><p>Adoption checklist.</p>
</body></html>`;

describe("detectPdfEngineAvailability", () => {
  const ORIGINAL = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.VERCEL;
    delete process.env.AWS_LAMBDA_FUNCTION_NAME;
    delete process.env.CHROME_EXECUTABLE_PATH;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL };
  });

  it("treats a serverless runtime as always having a bundled engine", () => {
    process.env.VERCEL = "1";
    expect(detectPdfEngineAvailability()).toEqual({
      chromeAvailable: true,
      source: "serverless-bundle",
    });
    // The bundle is a build artifact, not a file on this host.
    expect(existsSyncMock).not.toHaveBeenCalled();
  });

  it("uses a configured path when the binary is really there", () => {
    process.env.CHROME_EXECUTABLE_PATH = "/opt/chrome/chrome";
    existsSyncMock.mockReturnValue(true);

    expect(detectPdfEngineAvailability()).toEqual({ chromeAvailable: true, source: "configured-path" });
    expect(existsSyncMock).toHaveBeenCalledWith("/opt/chrome/chrome");
  });

  /**
   * A configured-but-wrong path is a paste mistake with a specific fix.
   * Reporting it as "missing" sends the operator looking for something they
   * believe they already did.
   */
  it("reports a configured path that does not exist as unavailable", () => {
    process.env.CHROME_EXECUTABLE_PATH = "/opt/chrome/typo";
    existsSyncMock.mockReturnValue(false);

    expect(detectPdfEngineAvailability().chromeAvailable).toBe(false);
  });

  it("falls back to the conventional path when none is configured", () => {
    existsSyncMock.mockReturnValue(true);
    expect(detectPdfEngineAvailability()).toEqual({ chromeAvailable: true, source: "default-path" });
    expect(existsSyncMock).toHaveBeenCalledWith("/usr/bin/google-chrome");
  });

  it("reports no engine when nothing is installed", () => {
    existsSyncMock.mockReturnValue(false);
    expect(detectPdfEngineAvailability()).toEqual({ chromeAvailable: false, source: "none" });
  });
});

describe("renderReportPdf", () => {
  const ORIGINAL = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.VERCEL;
    delete process.env.AWS_LAMBDA_FUNCTION_NAME;
    delete process.env.CHROME_EXECUTABLE_PATH;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL };
  });

  it("uses Chrome when one is available, with no disclosure", async () => {
    existsSyncMock.mockReturnValue(true);
    const close = vi.fn();
    launchMock.mockResolvedValue({
      newPage: async () => ({ setContent: async () => {}, pdf: async () => Buffer.from("%PDF-chrome") }),
      close,
    });

    const result = await renderReportPdf(REPORT_HTML, { title: "Packet", generatedAt: null });

    expect(result.engine).toBe("chrome");
    expect(result.disclosure).toBeNull();
    expect(close).toHaveBeenCalled();
  });

  it("uses the built-in writer when no engine exists, and says so IN the document", async () => {
    existsSyncMock.mockReturnValue(false);

    const result = await renderReportPdf(REPORT_HTML, { title: "Packet", generatedAt: null });

    expect(result.engine).toBe("builtin");
    expect(result.disclosure).toBe(BUILTIN_PDF_NOTICE);
    expect(launchMock).not.toHaveBeenCalled();

    const text = drawnText(result.bytes);
    // The disclosure travels with the document, because that is the copy that
    // reaches a board meeting.
    expect(text).toContain("built-in PDF writer");
    expect(text).toContain("no section has been shortened or dropped");
  });

  /**
   * A Chrome binary that exists but crashes for missing shared libraries is the
   * common self-host failure. A deliverable must not 500 because of it.
   */
  it("falls back on a Chrome THROW, not only on its absence", async () => {
    existsSyncMock.mockReturnValue(true);
    launchMock.mockRejectedValue(new Error("libnss3.so: cannot open shared object file"));

    const result = await renderReportPdf(REPORT_HTML, { title: "Packet", generatedAt: null });

    expect(result.engine).toBe("builtin");
    expect(result.disclosure).toBe(BUILTIN_PDF_NOTICE);
    expect(drawnText(result.bytes)).toContain("Corridor Scores");
  });

  it("carries every section of the HTML into the built-in rendering", async () => {
    existsSyncMock.mockReturnValue(false);

    const result = await renderReportPdf(REPORT_HTML, { title: "Packet", generatedAt: null });
    const text = drawnText(result.bytes);

    for (const heading of ["Corridor Scores", "Safety", "Appendix"]) {
      expect(text).toContain(heading);
    }
    expect(text).toContain("Adoption checklist.");
    // Styles and the doctype must not leak into the document body.
    expect(text).not.toContain("color:red");
    expect(text).not.toContain("doctype");
  });

  it("reports a page count for the built-in tier and none for Chrome", async () => {
    existsSyncMock.mockReturnValue(false);
    const builtin = await renderReportPdf(REPORT_HTML, { title: "Packet", generatedAt: null });
    expect(builtin.pageCount).toBeGreaterThanOrEqual(1);

    existsSyncMock.mockReturnValue(true);
    launchMock.mockResolvedValue({
      newPage: async () => ({ setContent: async () => {}, pdf: async () => Buffer.from("%PDF-chrome") }),
      close: vi.fn(),
    });
    const chrome = await renderReportPdf(REPORT_HTML, { title: "Packet", generatedAt: null });
    expect(chrome.pageCount).toBeNull();
  });

  it("is deterministic on the built-in tier for identical input", async () => {
    existsSyncMock.mockReturnValue(false);
    const a = await renderReportPdf(REPORT_HTML, { title: "Packet", generatedAt: "2026-07-24" });
    const b = await renderReportPdf(REPORT_HTML, { title: "Packet", generatedAt: "2026-07-24" });
    expect(Array.from(a.bytes)).toEqual(Array.from(b.bytes));
  });
});
