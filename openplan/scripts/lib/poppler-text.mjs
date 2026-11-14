/**
 * Read PDF page text with Poppler's pdftotext, and refuse any other
 * pdftotext (KI-2026-11-14-190).
 *
 * Why. The proven job checker and the first-job journey script ask the same
 * question of each exported PDF: is this phrase on this page? The answer
 * depends on the extractor. Git Bash on Windows puts Git's own xpdf 4.06
 * `pdftotext` ahead of Poppler on PATH, and xpdf joins and splits words
 * differently, so a record read there is not read the way CI and the
 * journey read it. Both callers use this module, so both read pages the same
 * way (`pdftotext -layout -enc UTF-8`, split on form feeds) and both refuse a
 * pdftotext whose `-v` output does not name Poppler.
 *
 * Blind category. The check reads what the program says about itself. A
 * program that prints Poppler's version line but extracts differently would
 * pass.
 *
 * Plain ESM with no dependencies, so vitest, Node scripts and CommonJS
 * scripts (Node 22.12 or later, through require) can all load it.
 */
import { execFileSync, spawnSync } from "node:child_process";

/** How to fix PATH, printed with every refusal. */
export const POPPLER_PATH_FIX =
  "Put Poppler's bin folder ahead of every other folder on PATH and run again. " +
  "In Git Bash on Windows, Git's /ucrt64/bin holds xpdf's pdftotext: run " +
  'export PATH="/c/path/to/poppler/Library/bin:$PATH" first. ' +
  "On Linux, install poppler-utils.";

/**
 * What a PDF tool on PATH says it is: whether it was found, whether its
 * version output names Poppler, and the first line of that output.
 * Poppler prints its version on stderr and, depending on the release, exits
 * 0 or 99, so the exit code is not read.
 * @param {string} tool
 * @param {{spawn?: typeof spawnSync}} [options]
 * @returns {{found: boolean, poppler: boolean, version: string | null}}
 */
export function pdfToolVersion(tool, { spawn = spawnSync } = {}) {
  const result = spawn(tool, ["-v"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.error) {
    if (result.error.code === "ENOENT") return { found: false, poppler: false, version: null };
    throw result.error;
  }
  const text = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const version = text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "";
  return { found: true, poppler: /\bpoppler\b/i.test(text), version };
}

/**
 * Throw unless `tool` on PATH is Poppler's. Returns its version line.
 * @param {string} tool
 * @param {{spawn?: typeof spawnSync}} [options]
 * @returns {string}
 */
export function assertPopplerTool(tool, options = {}) {
  const found = pdfToolVersion(tool, options);
  if (!found.found) throw new Error(`${tool} is not on PATH; the PDF checks need Poppler's. ${POPPLER_PATH_FIX}`);
  if (!found.poppler) {
    throw new Error(
      `the ${tool} on PATH is not Poppler's: it reports "${found.version}". ` +
        `The PDF checks read text the way Poppler does, and another extractor splits words differently. ${POPPLER_PATH_FIX}`,
    );
  }
  return found.version;
}

/**
 * Every page's text, as `pdftotext -layout -enc UTF-8` prints it, split on
 * form feeds, without the empty entry after the last form feed. Refuses a
 * pdftotext that is not Poppler's before reading.
 * @param {string} absolutePath
 * @param {{spawn?: typeof spawnSync, execFile?: typeof execFileSync}} [options]
 * @returns {string[]}
 */
export function popplerPdfPages(absolutePath, { spawn = spawnSync, execFile = execFileSync } = {}) {
  assertPopplerTool("pdftotext", { spawn });
  const output = execFile("pdftotext", ["-layout", "-enc", "UTF-8", absolutePath, "-"], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const pages = String(output).split("\f");
  if (pages.length > 1 && pages[pages.length - 1].trim() === "") pages.pop();
  return pages;
}
