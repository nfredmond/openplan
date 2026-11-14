/**
 * PDF rendering for report artifacts — one pipeline, two typesetting tiers.
 *
 * ONE CONTENT SOURCE. Both tiers consume the same `html` string: Chrome renders
 * it, and the built-in writer renders `htmlToPdfBlocks(html)` of the identical
 * document. The difference between them is purely typographic — no section,
 * figure or caveat can differ, because there is only one content source. That
 * is a structural guarantee rather than a promise, and it is why the built-in
 * tier is fed from the HTML instead of a second hand-built line list (which is
 * exactly how the routes' old PDF branches became thinner documents than their
 * own HTML exports).
 *
 * WHY NEITHER TIER ALONE. Requiring Chrome would break the $0/self-host
 * constraint: an agency running this on its own box would get a 500 on the
 * deliverable and no explanation, and "requiring operator setup" is a defect
 * here, not a documented workaround. Making the text tier universal would be a
 * capability regression on deployments that already produce styled packets, and
 * would make Explore's "PDF" button produce something visibly worse than the
 * "Generate report" button beside it, from the same run.
 *
 * The tier is DISCLOSED, never silent: in the artifact itself, on the response,
 * on the stored artifact record, and on the dashboard's deployment-health panel.
 */

import type { Browser, PaperFormat } from "puppeteer-core";
import { existsSync } from "node:fs";
import { htmlToPdfBlocks } from "./pdf-text";
import { writeTextPdf } from "./pdf-writer";

export type PdfFormat = "Letter" | "A4";

export type RenderHtmlToPdfOptions = {
  format?: PdfFormat;
  marginsPx?: number;
  footerLabel?: string;
};

/** Where a self-hosted deployment is looked at when no path is configured. */
const DEFAULT_CHROME_PATH = "/usr/bin/google-chrome";

function isServerlessRuntime(): boolean {
  return process.env.VERCEL === "1" || process.env.AWS_LAMBDA_FUNCTION_NAME !== undefined;
}

async function launchBrowser(): Promise<Browser> {
  const puppeteer = (await import("puppeteer-core")).default;

  if (isServerlessRuntime()) {
    // The bundle must be a release that knows the function's Node.js runtime.
    // Release 129 unpacked the Amazon Linux 2 libraries on every runtime but
    // Node 20, so on the hosted site's Node 24 (Amazon Linux 2023) the browser
    // died at launch with "libnspr4.so: cannot open shared object file" and
    // every hosted PDF came from the built-in writer (KI-2026-11-14-301).
    // Release 153 dropped `headless` and `defaultViewport` from its export;
    // its documentation launches with the headless shell.
    const chromium = (await import("@sparticuz/chromium")).default;
    return puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: "shell",
    });
  }

  return puppeteer.launch({
    executablePath: process.env.CHROME_EXECUTABLE_PATH?.trim() || DEFAULT_CHROME_PATH,
    headless: true,
  });
}

export async function renderHtmlToPdf(
  html: string,
  options: RenderHtmlToPdfOptions = {}
): Promise<Buffer> {
  const format: PaperFormat = options.format ?? "Letter";
  const marginPx = `${options.marginsPx ?? 48}px`;

  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    // puppeteer-core 25 removed `networkidle0`, which this used to pass (the
    // move off 23.x was forced by GHSA-jmr9-qjv8-65gv). `load` is the right
    // replacement HERE rather than merely the available one: the packet HTML
    // is self-contained, issues no XHR, and names only system fonts
    // (see the stylesheet in reports/html.ts), so there is no late-arriving
    // subresource for a network idle to have been waiting on. If a future
    // packet embeds a webfont or fetches anything, this needs a
    // `document.fonts.ready` wait added back with the mocks widened to match.
    await page.setContent(html, { waitUntil: "load" });
    const pdf = await page.pdf({
      format,
      printBackground: true,
      ...(options.footerLabel ? {
        displayHeaderFooter: true,
        headerTemplate: "<span></span>",
        footerTemplate: `<div style="font-family:Arial;font-size:8px;width:100%;padding:0 48px;text-align:right">${options.footerLabel.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!)} · Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>`,
      } : {}),
      margin: { top: marginPx, right: marginPx, bottom: marginPx, left: marginPx },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

export type ReportPdfEngine = "chrome" | "builtin";

export type PdfEngineAvailability = {
  chromeAvailable: boolean;
  source: "serverless-bundle" | "configured-path" | "default-path" | "none";
};

/**
 * Whether a browser rendering engine can be reached from this deployment.
 *
 * The serverless branch bundles Chromium, so it is available by construction.
 * Elsewhere the binary either exists on disk or it does not — and a CONFIGURED
 * path that does not exist is reported distinctly from an absent one, the same
 * way `deployment-health` distinguishes a pasted secret Mapbox token from a
 * missing one: telling an operator "not configured" when they believe they
 * configured it sends them looking in the wrong place.
 */
export function detectPdfEngineAvailability(): PdfEngineAvailability {
  if (isServerlessRuntime()) {
    return { chromeAvailable: true, source: "serverless-bundle" };
  }

  const configured = process.env.CHROME_EXECUTABLE_PATH?.trim();
  if (configured) {
    return existsSync(configured)
      ? { chromeAvailable: true, source: "configured-path" }
      : { chromeAvailable: false, source: "none" };
  }

  return existsSync(DEFAULT_CHROME_PATH)
    ? { chromeAvailable: true, source: "default-path" }
    : { chromeAvailable: false, source: "none" };
}

/**
 * The disclosure that travels INSIDE the document when Chrome was unavailable.
 *
 * It is the one disclosure that reaches a board meeting, so it leads with what
 * is NOT lost: every section is present. A reader must not be able to conclude
 * the packet was abridged.
 */
export const BUILTIN_PDF_NOTICE =
  "Typeset by OpenPlan's built-in PDF writer because this deployment has no browser rendering " +
  "engine. This is the complete written report (no section has been shortened or dropped), but " +
  "photographs, charts, styled layout, and table " +
  "rules from the HTML packet are not reproduced. Frozen image custody facts remain in the " +
  "document and artifact record. Non-Latin scripts are not rendered.";

/**
 * Why the browser engine was not used, in words safe to log and store: the
 * first line of the launch or render error, cut to 300 characters. Paths under
 * /tmp and library names can appear; request data cannot, because the error
 * comes from starting the browser or printing a page, not from the document.
 */
export function describePdfEngineFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const line = message.split("\n").map((part) => part.trim()).filter(Boolean).slice(0, 4).join(" | ");
  return (line || "unknown error").slice(0, 300);
}

export type RenderReportPdfResult = {
  bytes: Uint8Array;
  engine: ReportPdfEngine;
  /** Pages, when the engine knows. Chrome does not report it. */
  pageCount: number | null;
  /** Non-null only when the output differs from the styled HTML rendering. */
  disclosure: string | null;
  /**
   * Non-null only when a browser engine was expected and failed. A deployment
   * with no engine at all leaves it null; that case is a configuration, not a
   * fault.
   */
  engineFailure: string | null;
};

/**
 * Render a report's HTML to PDF, preferring Chrome and falling back honestly.
 *
 * Falls back on THROW as well as on absence: a Chrome binary that exists but
 * crashes for missing shared libraries is the common self-host failure, and a
 * deliverable must not 500 because of it. The fallback path itself cannot
 * throw — it is pure and dependency-free.
 */
export async function renderReportPdf(
  html: string,
  options: {
    title: string;
    generatedAt: string | null;
    footerLabel?: string;
    format?: PdfFormat;
  }
): Promise<RenderReportPdfResult> {
  const availability = detectPdfEngineAvailability();
  let engineFailure: string | null = null;

  if (availability.chromeAvailable) {
    try {
      const bytes = await renderHtmlToPdf(html, { format: options.format, footerLabel: options.footerLabel });
      return { bytes: new Uint8Array(bytes), engine: "chrome", pageCount: null, disclosure: null, engineFailure: null };
    } catch (error) {
      // Fall through to the built-in writer: a complete document still leaves
      // the building. The reason is logged here, once, for every caller. Before
      // this line existed the hosted site fell back on every PDF for weeks and
      // nothing said why.
      engineFailure = describePdfEngineFailure(error);
      console.error(`[pdf] the browser engine (${availability.source}) failed, so the built-in writer was used: ${engineFailure}`);
    }
  }

  const blocks = htmlToPdfBlocks(html);
  const result = writeTextPdf(
    {
      title: options.title,
      generatedAt: options.generatedAt,
      blocks: [{ kind: "note", text: BUILTIN_PDF_NOTICE }, ...blocks],
    },
    {
      pageSize: options.format === "A4" ? "a4" : "letter",
      footerLabel: options.footerLabel,
    }
  );

  return {
    bytes: result.bytes,
    engine: "builtin",
    pageCount: result.pageCount,
    disclosure: BUILTIN_PDF_NOTICE,
    engineFailure,
  };
}
