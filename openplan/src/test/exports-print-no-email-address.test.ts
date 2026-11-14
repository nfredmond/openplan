/**
 * NO EXPORT PRINTS AN EMAIL ADDRESS (KI-2026-11-14-100, first full journey,
 * run 9).
 *
 * The SS4A application PDF named each section's finalizer by email address in
 * its provenance table. An exported application goes to a funder and may be
 * published, so it must not carry staff contact details. The export now names
 * the finalizer by workspace role; the stored finalizer id and the audit trail
 * are unchanged.
 *
 * This guard renders both exports, the SS4A application packet and the
 * Safety action plan report packet, from fixtures whose workspace members have
 * email addresses that the auth admin API would return, and asserts the output
 * holds none. It also scans the export builders' source under
 * `src/lib/grants/` and `src/lib/reports/` for an auth email read. The last
 * block renders both to PDF with Chrome and reads them back with poppler.
 *
 * Blind category: an email address a planner types into section text or a
 * report field (their own words, printed as written), live RLS on the roster
 * read, and the hosted Chrome bundle. The PDF block is skipped where Chrome or
 * poppler is not installed. PDF text is matched with whitespace collapsed,
 * which is the Windows reading; Linux portability belongs to another lane.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { ApplicationSectionRow } from "@/lib/grants/application";
import { loadFinalizerNames } from "@/lib/grants/application-finalizers";
import { buildGrantApplicationHtml, type GrantApplicationExportSection } from "@/lib/grants/application-html";
import { SS4A_APPENDIX_KEYS } from "@/lib/grants/ss4a-appendix-keys";
import { buildSs4aEvidenceAppendices } from "@/lib/grants/ss4a-evidence-appendices";
import { buildSafetySeedPreview } from "@/lib/grants/ss4a-safety-seed";
import { buildReportHtml, type ReportGenerationData } from "@/lib/reports/html";
import { renderHtmlToPdf } from "@/lib/reports/pdf";
import { buildSafetyActionPlanSection } from "@/lib/reports/safety-action-plan";
import { buildSafetyCrashEvidence } from "@/lib/safety/crash-evidence";
import { buildProjectStageGateSnapshot, buildProjectStageGateSummary } from "@/lib/stage-gates/summary";
import { stripSourceComments } from "@/test/helpers/source-text";
import { safetySeedFixture } from "./fixtures/grants/safety-seed";
import { completeEvidenceRecords, EVIDENCE_DATE, EVIDENCE_IDS, fixtureNetwork } from "./fixtures/grants/ss4a-evidence";

/** Any email address, as a reader would recognize one. */
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;

const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const OWNER_ID = "22222222-2222-4222-8222-222222222222";
const ADMIN_ID = "44444444-4444-4444-8444-444444444444";
const MEMBER_ID = "77777777-7777-4777-8777-777777777777";
const MEMBERS = [
  { user_id: OWNER_ID, role: "owner", email: "planning.director@county.example.gov" },
  { user_id: ADMIN_ID, role: "admin", email: "18@openplan.test" },
  { user_id: MEMBER_ID, role: "member", email: "intern+grants@county.example.gov" },
];

/** A service-role client whose roster members all have email addresses the auth admin API would return. */
function rosterService() {
  const getUserById = vi.fn(async (id: string) => ({
    data: { user: { email: MEMBERS.find((member) => member.user_id === id)?.email ?? "outsider@other.example.org" } },
  }));
  const from = () => {
    let columns = "";
    const chain = {
      select(value: string) {
        columns = value;
        return chain;
      },
      eq: () => chain,
      order: () => chain,
      maybeSingle: async () => ({ data: { user_id: OWNER_ID }, error: null }),
      limit: async () => ({
        data: columns === "user_id, role" ? MEMBERS.map(({ user_id, role }) => ({ user_id, role })) : [],
        error: null,
      }),
    };
    return chain;
  };
  return { service: { from, auth: { admin: { getUserById } } }, getUserById };
}

/** The SS4A packet as run 9 assembled it: six seeded sections finalized by three members. */
async function ss4aPacket() {
  const roster = rosterService();
  const finalizerIds = [OWNER_ID, ADMIN_ID, MEMBER_ID];
  const names = await loadFinalizerNames(roster.service, OWNER_ID, WORKSPACE_ID, finalizerIds);
  const preview = buildSafetySeedPreview(safetySeedFixture());
  const sections: GrantApplicationExportSection[] = preview.sections.map((draft, index) => {
    const row: ApplicationSectionRow = {
      id: draft.section_id, workspace_id: WORKSPACE_ID, opportunity_id: EVIDENCE_IDS.opportunity, section_key: draft.section_key,
      title: draft.section_key, guidance: null, sort_order: index, source: "catalog", suggested_evidence: [], ai_drafting_enabled: true,
      status: "final", final_markdown: draft.draft_markdown, finalized_from_draft_id: null, finalized_by: finalizerIds[index % 3],
      finalized_at: "2026-11-14T05:54:00.000Z", updated_by: null, created_at: "2026-11-14T00:00:00.000Z", updated_at: "2026-11-14T05:54:00.000Z",
    };
    return { section: row, provenance: { origin: "safety_seed_unedited", safetySeed: draft.provenance, model: null, groundedSentenceCount: null,
      totalSentenceCount: null, finalizedBy: names.nameFor(row.finalized_by!), finalizedAt: row.finalized_at } };
  });
  const html = buildGrantApplicationHtml({
    opportunity: { id: EVIDENCE_IDS.opportunity, title: "SS4A application", agency_name: "U.S. Department of Transportation", summary: null,
      expected_award_amount: null, closes_at: null, opportunity_status: null, decision_state: null },
    programTitle: null, sections, attachments: [], generatedAt: "2026-11-14T06:00:00.000Z",
    evidenceAppendices: buildSs4aEvidenceAppendices(completeEvidenceRecords(), new Set(SS4A_APPENDIX_KEYS)),
    safetySeedHistory: [preview.sections[0].provenance],
  });
  return { html, getUserById: roster.getUserById };
}

/** The Safety action plan report packet for the same workspace. It reads no member identity. */
function reportPacket(): string {
  const network = fixtureNetwork();
  const plan = { ingestId: EVIDENCE_IDS.ingest, attachments: [{ segmentId: network.segments[0].id, segmentLabel: network.segments[0].label, countermeasureIds: ["walkways"] }] };
  const evidence = buildSafetyCrashEvidence({
    id: EVIDENCE_IDS.ingest, projectId: EVIDENCE_IDS.project, status: "ready", severityCompleteness: "fatal_only",
    sourceLabel: "NHTSA Fatality Analysis Reporting System (FARS)", attribution: null, crashCount: 4, geocodedCount: 4, storedCount: 4, truncated: false,
    yearsRequested: [2023, 2024], createdAt: EVIDENCE_DATE, dimensionCoverage: null, partyCompleteness: "not_supported", partyCount: null, involvementBasis: null,
  }, { severity: { fatal: 4, severe_injury: 0, injury: 0, pdo: 0, unknown: 0 }, role: null });
  return buildReportHtml({
    report: { id: "r1", title: "Safety action plan report", summary: null, report_type: "project_status", created_at: "2026-11-14T00:00:00.000Z" },
    workspace: { id: WORKSPACE_ID, name: "Example County" },
    project: { id: EVIDENCE_IDS.project, name: "Example safety project", summary: null, status: "active", plan_type: "corridor_plan",
      delivery_phase: "analysis", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-11-14T00:00:00.000Z" },
    runs: [], sections: [], deliverables: [], risks: [], issues: [], decisions: [], meetings: [], engagement: null, scenarioSetLinks: [],
    projectFundingSnapshot: null,
    projectRecordsSnapshot: {
      deliverables: { count: 0, latestTitle: null, latestAt: null }, risks: { count: 0, latestTitle: null, latestAt: null },
      issues: { count: 0, latestTitle: null, latestAt: null }, decisions: { count: 0, latestTitle: null, latestAt: null },
      meetings: { count: 0, latestTitle: null, latestAt: null },
    },
    stageGateSnapshot: buildProjectStageGateSnapshot(buildProjectStageGateSummary([], { templateId: "ca_stage_gates_v0_1" })),
    modelingEvidence: [],
    safetyActionPlan: buildSafetyActionPlanSection({ plan, evidence, network }),
  } as unknown as ReportGenerationData);
}

function visibleText(html: string): string {
  return html.replace(/<style[\s\S]*?<\/style>|<svg[\s\S]*?<\/svg>/g, " ").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
}

describe("the email pattern can fail", () => {
  it("matches the addresses run 9 printed and the fixture's members hold", () => {
    for (const member of MEMBERS) expect(EMAIL.test(`Finalized by ${member.email} on`), member.email).toBe(true);
    expect(EMAIL.test("Workspace owner")).toBe(false);
  });
});

describe("both exports name no member by email", () => {
  it("the SS4A packet names each finalizer by workspace role and reads no auth email", async () => {
    const { html, getUserById } = await ss4aPacket();
    const text = visibleText(html);
    expect(text.match(EMAIL)?.[0] ?? null).toBeNull();
    for (const label of ["Workspace owner", "Workspace admin", "Workspace member"]) expect(html).toContain(`<td>${label}</td>`);
    expect(getUserById).not.toHaveBeenCalled();
  });

  it("the Safety action plan report packet prints no email address", () => {
    const text = visibleText(reportPacket());
    expect(text).toContain("Example safety project");
    expect(text.match(EMAIL)?.[0] ?? null).toBeNull();
  });

  it("no export builder under src/lib/grants or src/lib/reports reads an auth email", () => {
    const offenders: string[] = [];
    for (const dir of ["src/lib/grants", "src/lib/reports"]) {
      for (const name of readdirSync(dir, { recursive: true }) as string[]) {
        if (!name.endsWith(".ts")) continue;
        const file = path.join(dir, name).replace(/\\/g, "/");
        const source = stripSourceComments(readFileSync(file, "utf8"));
        if (/getUserById|auth\.admin|\.email\b/.test(source)) offenders.push(`${file}: reads an auth email`);
        // The roster resolves emails unless told not to.
        for (const call of source.matchAll(/loadWorkspaceRoster\(([^)]*)\)/g)) {
          if (!/resolveEmails:\s*false/.test(call[1])) offenders.push(`${file}: reads the roster with emails`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Both documents as PDFs, read back with poppler.
// ---------------------------------------------------------------------------

const CHROME = [process.env.CHROME_EXECUTABLE_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"]
  .find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)));
/** Poppler's folder: the one that holds pdftoppm, pdftotext and pdfinfo (xpdf's pdftotext can come first on PATH). */
function popplerDir(): string | null {
  const exe = process.platform === "win32" ? ".exe" : "";
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (dir && ["pdftoppm", "pdftotext", "pdfinfo"].every((name) => existsSync(path.join(dir, `${name}${exe}`)))) return dir;
  }
  return null;
}
const POPPLER = popplerDir();
const PDF_TOOLS = Boolean(CHROME) && POPPLER !== null;
const workDir = PDF_TOOLS ? mkdtempSync(path.join(tmpdir(), "openplan-no-email-")) : "";
afterAll(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

async function pdfPages(name: string, html: string): Promise<string[]> {
  process.env.CHROME_EXECUTABLE_PATH = CHROME;
  const file = path.join(workDir, `${name}.pdf`);
  const bytes = await renderHtmlToPdf(html, { footerLabel: name });
  writeFileSync(file, bytes);
  // Set OPENPLAN_EXPORT_PDF_DIR to keep copies for a person to read.
  const keep = process.env.OPENPLAN_EXPORT_PDF_DIR;
  if (keep) {
    mkdirSync(keep, { recursive: true });
    writeFileSync(path.join(keep, `${name}.pdf`), bytes);
  }
  const exe = process.platform === "win32" ? ".exe" : "";
  const info = execFileSync(path.join(POPPLER!, `pdfinfo${exe}`), [file]).toString();
  const pages = Number(/Pages:\s+(\d+)/.exec(info)![1]);
  return Array.from({ length: pages }, (_, index) =>
    execFileSync(path.join(POPPLER!, `pdftotext${exe}`), ["-f", String(index + 1), "-l", String(index + 1), file, "-"]).toString().replace(/\s+/g, " "));
}

describe.runIf(PDF_TOOLS)("both exports as PDFs, read back with pdftotext", () => {
  it("the SS4A PDF holds no email address, names roles, and carries the DRAFT stamp on its first page", async () => {
    const pages = await pdfPages("ss4a-no-email", (await ss4aPacket()).html);
    expect(pages.join(" ").match(EMAIL)?.[0] ?? null).toBeNull();
    expect(pages.join(" ").toLowerCase()).toContain("workspace owner");
    expect(pages[0]).toMatch(/DRAFT: (\d+ unverified items?, )?6 unfilled placeholders remain in 6 sections/);
  }, 120_000);

  it("the Safety action plan report PDF holds no email address", async () => {
    const pages = await pdfPages("report-no-email", reportPacket());
    expect(pages.join(" ")).toContain("Example safety project");
    expect(pages.join(" ").match(EMAIL)?.[0] ?? null).toBeNull();
  }, 120_000);
});
