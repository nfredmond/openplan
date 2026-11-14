/**
 * A BROWSER ENGINE THAT FAILS IS SAID, NOT SWALLOWED (KI-2026-11-14-301).
 *
 * On the hosted site every PDF came from the built-in writer for weeks: the
 * bundled serverless browser died at launch on the Node 24 runtime, the catch
 * block was empty, and the only trace was a smaller file with no map in it.
 * The agent-run proof journey found it because it looks for the high-injury
 * map in the exported PDF.
 *
 * These tests hold three things: the reason reaches the log and the result;
 * a complete document still comes back; and the serverless launch passes the
 * options release 153 of the bundle documents.
 *
 * Blind category: whether the bundle really launches on the hosted runtime.
 * No unit test can see that. The proven-job record's map check on a hosted
 * PDF is the check that can.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const launch = vi.fn();
const executablePath = vi.fn(async () => "/tmp/chromium");

vi.mock("puppeteer-core", () => ({ default: { launch: (...args: unknown[]) => launch(...args) } }));
vi.mock("@sparticuz/chromium", () => ({ default: { args: ["--no-sandbox"], executablePath: () => executablePath() } }));

import { describePdfEngineFailure, renderReportPdf } from "@/lib/reports/pdf";

const HTML = "<html><body><h1>Safety action plan</h1><p>One paragraph.</p></body></html>";
const OPTIONS = { title: "Safety action plan", generatedAt: "2026-11-14T00:00:00.000Z" };

describe("the serverless browser engine", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubEnv("VERCEL", "1");
    launch.mockReset();
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    errorSpy.mockRestore();
  });

  it("says why it fell back, in the log and in the result, and still returns the whole document", async () => {
    launch.mockRejectedValue(new Error(
      "Failed to launch the browser process:  Code: 127\n\nstderr:\n/tmp/chromium: error while loading shared libraries: libnspr4.so: cannot open shared object file: No such file or directory\n\nTROUBLESHOOTING: https://pptr.dev/troubleshooting",
    ));
    const result = await renderReportPdf(HTML, OPTIONS);
    expect(result.engine).toBe("builtin");
    expect(result.engineFailure).toContain("libnspr4.so");
    expect(result.disclosure).not.toBeNull();
    expect(result.bytes.length).toBeGreaterThan(500);
    expect(Buffer.from(result.bytes.subarray(0, 5)).toString("latin1")).toBe("%PDF-");
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logged = String(errorSpy.mock.calls[0][0]);
    expect(logged).toContain("serverless-bundle");
    expect(logged).toContain("libnspr4.so");
  });

  it("is silent and reports no failure when the browser renders", async () => {
    const page = { setContent: vi.fn(async () => undefined), pdf: vi.fn(async () => new Uint8Array([37, 80, 68, 70, 45])) };
    launch.mockResolvedValue({ newPage: async () => page, close: async () => undefined });
    const result = await renderReportPdf(HTML, OPTIONS);
    expect(result.engine).toBe("chrome");
    expect(result.engineFailure).toBeNull();
    expect(result.disclosure).toBeNull();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("launches the bundle with the headless shell and no option the bundle no longer exports", async () => {
    const page = { setContent: vi.fn(async () => undefined), pdf: vi.fn(async () => new Uint8Array([37, 80, 68, 70, 45])) };
    launch.mockResolvedValue({ newPage: async () => page, close: async () => undefined });
    await renderReportPdf(HTML, OPTIONS);
    expect(launch).toHaveBeenCalledTimes(1);
    const options = launch.mock.calls[0][0] as Record<string, unknown>;
    expect(options.headless).toBe("shell");
    expect(options.executablePath).toBe("/tmp/chromium");
    expect(options.args).toEqual(["--no-sandbox"]);
    // Release 153 exports neither `headless` nor `defaultViewport`; passing an
    // undefined read from it would hide a typo as a default.
    expect(Object.keys(options).sort()).toEqual(["args", "executablePath", "headless"]);
  });
});

describe("describePdfEngineFailure", () => {
  it("keeps the first lines, joined, and stays short", () => {
    expect(describePdfEngineFailure(new Error("first line\n\n  second line  \nthird"))).toBe("first line | second line | third");
    expect(describePdfEngineFailure("plain string")).toBe("plain string");
    expect(describePdfEngineFailure(new Error(""))).toBe("unknown error");
    expect(describePdfEngineFailure(new Error("x".repeat(1000))).length).toBe(300);
  });
});
