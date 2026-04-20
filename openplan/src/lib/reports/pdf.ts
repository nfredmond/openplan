import type { Browser, PaperFormat } from "puppeteer-core";

export type PdfFormat = "Letter" | "A4";

export type RenderHtmlToPdfOptions = {
  format?: PdfFormat;
  marginsPx?: number;
};

function isServerlessRuntime(): boolean {
  return process.env.VERCEL === "1" || process.env.AWS_LAMBDA_FUNCTION_NAME !== undefined;
}

async function launchBrowser(): Promise<Browser> {
  const puppeteer = (await import("puppeteer-core")).default;

  if (isServerlessRuntime()) {
    const chromium = (await import("@sparticuz/chromium")).default;
    return puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
      defaultViewport: chromium.defaultViewport,
    });
  }

  return puppeteer.launch({
    executablePath: process.env.CHROME_EXECUTABLE_PATH ?? "/usr/bin/google-chrome",
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
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdf = await page.pdf({
      format,
      printBackground: true,
      margin: { top: marginPx, right: marginPx, bottom: marginPx, left: marginPx },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
