/**
 * THE SS4A COVER NAMES THE PROJECT AND THE WORKSPACE (KI-2026-11-14-340).
 *
 * The first proven job's three SS4A covers named the program, the funder and
 * the assembly time, but no applicant: a reader learned whose work it was, and
 * that it was a demonstration, only on page 2. The cover now prints the linked
 * project and the workspace by the names the product holds. A failed read
 * says so and never guesses a name.
 *
 * Not changed here: the program summary on the cover ("very accessible to
 * small and rural agencies") is the opportunity's stored summary, copied from
 * `grants/programs/us-federal.ts`, a source the readiness registry pins by
 * hash; and the standing caveat's dash is a hashed text that saved work is
 * checked against.
 *
 * Blind category: a legal applicant, which is the agency's to state in its
 * own sections; the route's workspace read against a live database (RLS on
 * `workspaces` lets a member read its own row); the hosted Chrome bundle. The
 * PDF block is skipped where Chrome or poppler is missing.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { loadApplicationApplicant, type ApplicationApplicant } from "@/lib/grants/application-applicant";
import { buildGrantApplicationHtml } from "@/lib/grants/application-html";
import { renderHtmlToPdf } from "@/lib/reports/pdf";
import { findPdfPhrase } from "../../scripts/lib/pdf-text-match.mjs";

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";

type Call = { table: string; method: string; args: unknown[] };

/** A client whose name reads answer from `rows`; a table set to "error" fails, "throw" throws. */
function client(rows: Record<string, unknown>, calls: Call[] = []) {
  return {
    from(table: string) {
      if (rows[table] === "throw") throw new Error(`Unexpected table: ${table}`);
      const self: Record<string, unknown> = {};
      for (const method of ["select", "eq"]) {
        self[method] = (...args: unknown[]) => {
          calls.push({ table, method, args });
          return self;
        };
      }
      self.maybeSingle = async () => rows[table] === "error"
        ? { data: null, error: { message: "denied" } }
        : { data: rows[table] ?? null, error: null };
      return self;
    },
  };
}

const OPPORTUNITY = {
  id: "o", title: "Safe Streets and Roads for All (SS4A)", agency_name: "U.S. Department of Transportation", summary: null,
  expected_award_amount: null, closes_at: null, opportunity_status: null, decision_state: null,
};

function packet(applicant?: ApplicationApplicant): string {
  return buildGrantApplicationHtml({ opportunity: OPPORTUNITY, programTitle: null, sections: [], attachments: [], generatedAt: "2026-11-14T17:57:00.000Z", applicant });
}

function cover(applicant?: ApplicationApplicant): string {
  return packet(applicant).match(/<header class="hero">[\s\S]*?<\/header>/)![0];
}

const SIERRA: ApplicationApplicant = {
  project: { status: "named", name: "Sierra County safety demonstration" },
  workspace: { status: "named", name: "OpenPlan proof run, Sierra County demonstration" },
};

describe("loadApplicationApplicant", () => {
  it("reads the workspace's and the project's names, the project scoped to the workspace", async () => {
    const calls: Call[] = [];
    const applicant = await loadApplicationApplicant(
      client({ workspaces: { name: "Sierra County demonstration" }, projects: { name: "Sierra County safety demonstration" } }, calls),
      { workspaceId: WORKSPACE_ID, projectId: PROJECT_ID },
    );
    expect(applicant).toEqual({
      workspace: { status: "named", name: "Sierra County demonstration" },
      project: { status: "named", name: "Sierra County safety demonstration" },
    });
    expect(calls).toEqual(expect.arrayContaining([
      { table: "workspaces", method: "select", args: ["name"] },
      { table: "workspaces", method: "eq", args: ["id", WORKSPACE_ID] },
      { table: "projects", method: "select", args: ["name"] },
      { table: "projects", method: "eq", args: ["id", PROJECT_ID] },
      { table: "projects", method: "eq", args: ["workspace_id", WORKSPACE_ID] },
    ]));
  });

  it("reuses a project name the caller already read, and reads no project when none is linked", async () => {
    const calls: Call[] = [];
    const reused = await loadApplicationApplicant(client({ workspaces: { name: "W" } }, calls), { workspaceId: WORKSPACE_ID, projectId: PROJECT_ID, projectName: "Read once" });
    expect(reused.project).toEqual({ status: "named", name: "Read once" });
    const unlinked = await loadApplicationApplicant(client({ workspaces: { name: "W" } }, calls), { workspaceId: WORKSPACE_ID, projectId: null });
    expect(unlinked.project).toEqual({ status: "not_linked" });
    expect(calls.filter((call) => call.table === "projects")).toEqual([]);
  });

  it("says a failed or thrown read could not be read, never a name and never 'not linked'", async () => {
    const failed = await loadApplicationApplicant(client({ workspaces: "error", projects: "throw" }), { workspaceId: WORKSPACE_ID, projectId: PROJECT_ID });
    expect(failed).toEqual({ workspace: { status: "unread" }, project: { status: "unread" } });
  });
});

describe("the cover", () => {
  it("prints the project and the workspace by name", () => {
    const html = cover(SIERRA);
    expect(html).toContain("<div><dt>Project</dt><dd>Sierra County safety demonstration</dd></div>");
    expect(html).toContain("<div><dt>Workspace</dt><dd>OpenPlan proof run, Sierra County demonstration</dd></div>");
  });

  it("states an absent project and an unread workspace in words", () => {
    const html = cover({ project: { status: "not_linked" }, workspace: { status: "unread" } });
    expect(html).toContain("<div><dt>Project</dt><dd>No project linked</dd></div>");
    expect(html).toContain("<div><dt>Workspace</dt><dd>Could not be read</dd></div>");
  });

  it("prints neither for a caller that passes no applicant", () => {
    expect(cover()).not.toContain("<dt>Workspace</dt>");
  });
});

const CHROME = [process.env.CHROME_EXECUTABLE_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"]
  .find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)));
function popplerDir(): string | null {
  const exe = process.platform === "win32" ? ".exe" : "";
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (dir && existsSync(path.join(dir, `pdftotext${exe}`)) && existsSync(path.join(dir, `pdftoppm${exe}`))) return dir;
  }
  return null;
}
const POPPLER = popplerDir();
const PDF_TOOLS = Boolean(CHROME) && POPPLER !== null;
const workDir = PDF_TOOLS ? mkdtempSync(path.join(tmpdir(), "openplan-ss4a-cover-")) : "";
afterAll(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

describe.runIf(PDF_TOOLS)("the cover as a PDF, read back with pdftotext", () => {
  it("names the project and the workspace on page 1", async () => {
    process.env.CHROME_EXECUTABLE_PATH = CHROME;
    const file = path.join(workDir, "cover.pdf");
    writeFileSync(file, await renderHtmlToPdf(packet(SIERRA), { footerLabel: "cover" }));
    const exe = process.platform === "win32" ? ".exe" : "";
    const page1 = execFileSync(path.join(POPPLER!, `pdftotext${exe}`), ["-f", "1", "-l", "1", file, "-"]).toString();
    expect(findPdfPhrase([page1], "Sierra County safety demonstration")).not.toEqual([]);
    expect(findPdfPhrase([page1], "OpenPlan proof run, Sierra County demonstration")).not.toEqual([]);
  }, 120_000);
});
