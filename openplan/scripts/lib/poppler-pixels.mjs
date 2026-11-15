/**
 * Render one PDF page with Poppler's pdftoppm and count its highlight-red
 * pixels (KI-2026-11-14-303).
 *
 * Why. The first-job journey finds the high-injury map by pixels: the page
 * near the map heading must carry at least MIN_RED_PIXELS highlight-red
 * pixels. The proven job checker asks the same question of the recorded map
 * page, so both use this module: the same pdftoppm call (72 dpi, one page,
 * binary PPM), the same color rule and the same threshold.
 *
 * The PPM bytes are the portable part. On November 14, 2026 the six real
 * PDFs of the first proven job rendered to identical PPM bytes with Poppler
 * 25.07 on Windows and Poppler 24.02 on Ubuntu 24.04, while their PNG bytes
 * differed (the PNG encoder, not the pixels). A record's `pixelSha256` is the
 * SHA-256 of these PPM bytes; the PNG hash is kept for the journey's own
 * image file but is not recomputed.
 *
 * Blind category. The count says the page holds enough highlight red, not
 * that the red marks are the ranked segments of the right place. A Poppler
 * release that changes rasterization would change the pixel hash and could
 * change the count.
 *
 * Plain ESM with no dependencies, so vitest, Node scripts and CommonJS
 * scripts (Node 22.12 or later, through require) can all load it.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { assertPopplerTool } from "./poppler-text.mjs";

/** The fewest highlight-red pixels a map page may hold. */
export const MIN_RED_PIXELS = 40;

/** The resolution every map page is rendered at, in dots per inch. */
export const MAP_RENDER_DPI = 72;

/**
 * Read a binary PPM (P6) and count highlight-red and non-background pixels.
 * Highlight red: red 140 to 230, green and blue at most 90, red at least 90
 * above green.
 * @param {Uint8Array} buffer
 * @returns {{width: number, height: number, redPixels: number, inkFraction: number}}
 */
export function analyzePpm(buffer) {
  let offset = 0;
  const tokens = [];
  while (tokens.length < 4) {
    while (offset < buffer.length && /\s/.test(String.fromCharCode(buffer[offset]))) offset += 1;
    if (buffer[offset] === 0x23) {
      while (offset < buffer.length && buffer[offset] !== 0x0a) offset += 1;
      continue;
    }
    let token = "";
    while (offset < buffer.length && !/\s/.test(String.fromCharCode(buffer[offset]))) {
      token += String.fromCharCode(buffer[offset]);
      offset += 1;
    }
    tokens.push(token);
  }
  offset += 1;
  const [magic, w, h, max] = tokens;
  if (magic !== "P6" || Number(max) !== 255) throw new Error("Only 8-bit binary PPM (P6) is read.");
  const width = Number(w);
  const height = Number(h);
  let red = 0;
  let ink = 0;
  for (let i = offset; i + 2 < buffer.length; i += 3) {
    const r = buffer[i];
    const g = buffer[i + 1];
    const b = buffer[i + 2];
    if (r >= 140 && r <= 230 && g <= 90 && b <= 90 && r - g >= 90) red += 1;
    if (r < 235 || g < 235 || b < 235) ink += 1;
  }
  return { width, height, redPixels: red, inkFraction: width && height ? ink / (width * height) : 0 };
}

/**
 * One page as binary PPM bytes, as `pdftoppm -f <page> -l <page> -r 72
 * -singlefile <pdf>` writes them to standard output. Refuses a pdftoppm that
 * is not Poppler's before rendering.
 * @param {string} absolutePath
 * @param {number} page
 * @param {{spawn?: typeof spawnSync, execFile?: typeof execFileSync}} [options]
 * @returns {Buffer}
 */
export function popplerPagePpm(absolutePath, page, { spawn = spawnSync, execFile = execFileSync } = {}) {
  assertPopplerTool("pdftoppm", { spawn });
  const args = ["-f", String(page), "-l", String(page), "-r", String(MAP_RENDER_DPI), "-singlefile", absolutePath];
  return Buffer.from(execFile("pdftoppm", args, { maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }));
}
