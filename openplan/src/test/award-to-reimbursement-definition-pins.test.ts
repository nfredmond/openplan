// @vitest-environment node
/**
 * Every fixed value in the fourth proven job's definition entry
 * (grant-award-to-reimbursement-record-in-three-places) is the product's own,
 * in every role. The third job's lesson
 * (a-checker-and-its-example-can-both-be-wrong): a definition that names a
 * status, a label or a profile the product does not print refuses every
 * honest record, and a checker and its synthetic example can share the
 * mistake. Each value here is read from the product's exported constant, from
 * what the product's worksheet code prints, or, where the product exports
 * nothing, from its source text with comments stripped.
 *
 * Blind category: the source-text pins show a word is in the component or
 * route, not that the hosted site shows it on the screen the journey uses.
 * The rendered worksheet is the product's code run here, not the hosted
 * deployment.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DRAWN_INVOICE_STATUSES } from "@/lib/dashboard/chart-series";
import { GRANT_PROGRAM_CATALOG } from "@/lib/grants/program-catalog";
import { buildAwardDrawdownLedger } from "@/lib/invoicing/drawdown-ledger";
import { BILLING_INVOICE_STATUSES, CLAIMED_INVOICE_STATUSES } from "@/lib/invoicing/invoice-records";
import { US_CA_LAPM_REIMBURSEMENT_PROFILE } from "@/lib/invoicing/profiles/us-ca-lapm";
import { US_FEDERAL_GENERIC_REIMBURSEMENT_PROFILE } from "@/lib/invoicing/profiles/us-federal-generic";
import {
  WORKSHEET_DOCUMENT_TITLE,
  WORKSHEET_FOOTER_NOTE,
  WORKSHEET_NO_FORM_PACK_NOTE,
  WORKSHEET_PREPARED_NOTE,
  buildReimbursementWorksheetHtml,
  summarizeWorksheetCostEntries,
  worksheetCurrencyNote,
} from "@/lib/invoicing/reimbursement-worksheet";
import { INTERIM_DEFAULT_RATIONALE, resolveReimbursementProfile } from "@/lib/invoicing/reimbursement-profile-binding";
import { BUILTIN_PDF_NOTICE } from "@/lib/reports/pdf";
import { stripSourceComments } from "./helpers/source-text";
import { profileForPlace, worksheetHtmlAt } from "./fixtures/proven-job-award";

const REPO_ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const readText = (path: string) => readFileSync(resolve(REPO_ROOT, path), "utf8");
const code = (path: string) => stripSourceComments(readText(path));
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the definition is untyped JSON
type Json = any;
const DEFINITIONS: Json = JSON.parse(readText("schemas/proven_job_definitions.v1.json"));
const EXAMPLE: Json = JSON.parse(readText("schemas/examples/proven_job_record.v1.award.synthetic.json"));
const JOB: Json = DEFINITIONS.jobs.find((job: Json) => job.id === "grant-award-to-reimbursement-record-in-three-places");
const RULE = JOB.award;
const ROLES = ["county", "city", "tribal-area"];

/** One ledger line per status, to see which figure the product puts each status in. */
function ledgerFor(status: string) {
  const result = buildAwardDrawdownLedger({
    award: { awarded_amount: 1000, match_amount: 0, match_posture: null },
    invoiceRead: { ok: true, invoices: [{ id: "a", invoice_number: "A", status, amount: 100, retention_amount: 10, retention_percent: 0 }] },
  });
  if (!result.ok) throw new Error(result.message);
  return result.ledger;
}

describe("the fourth job's statuses are the product's", () => {
  it("lists the product's statuses, claimed statuses and the dashboard's drawn statuses", () => {
    expect(RULE.statuses.all).toEqual([...BILLING_INVOICE_STATUSES]);
    expect(RULE.statuses.claimed).toEqual([...CLAIMED_INVOICE_STATUSES]);
    expect(RULE.statuses.drawn).toEqual([...DRAWN_INVOICE_STATUSES]);
    expect(RULE.statuses.order).toEqual(BILLING_INVOICE_STATUSES.filter((status) => status !== "rejected"));
  });

  it("puts each status in the ledger figure the definition says", () => {
    for (const status of BILLING_INVOICE_STATUSES) {
      const ledger = ledgerFor(status);
      expect(ledger.claimedCount === 1, `${status} claimed`).toBe(RULE.statuses.claimed.includes(status));
      expect(ledger.paidCount === 1, `${status} paid`).toBe(RULE.statuses.paid.includes(status));
      expect(ledger.draftedCount === 1, `${status} draft`).toBe(RULE.statuses.draft.includes(status));
      expect(ledger.rejectedCount === 1, `${status} rejected`).toBe(RULE.statuses.rejected.includes(status));
      // Net is gross less retention; paid is net, claimed and rejected are gross.
      if (ledger.paidCount) expect(ledger.paidToDate).toBe(90);
      if (ledger.claimedCount) expect(ledger.claimedGrossToDate).toBe(100);
      if (ledger.rejectedCount) expect(ledger.rejectedGross).toBe(100);
    }
  });

  it("holds the request trigger's move rules", () => {
    const sql = readText("openplan/supabase/migrations/20261117000100_reimbursement_request_status_custody.sql");
    const ranks = JSON.parse(/ranks constant jsonb := '([^']+)'/.exec(sql)![1]);
    expect(Object.entries(ranks).sort((a, b) => Number(a[1]) - Number(b[1])).map(([status]) => status)).toEqual(RULE.statuses.order);
    expect(sql).toContain(`IF OLD.status NOT IN (${RULE.statuses.rejectedFrom.map((status: string) => `'${status}'`).join(", ")}) THEN`);
    expect(sql).toContain(`IF OLD.status <> '${RULE.statuses.paidFrom[0]}' THEN`);
    expect(RULE.statuses.paidFrom).toHaveLength(1);
  });

  it("prints each status with the worksheet's own label", () => {
    const journey = structuredClone(EXAMPLE.journeys[0]);
    for (const status of BILLING_INVOICE_STATUSES) {
      journey.requests = [{ ...journey.requests[0], history: [{ status, control: "x", responseStatus: 200, at: "2026-11-20T10:10:00Z" }] }];
      expect(worksheetHtmlAt(journey, "2026-11-20T10:11:00Z"), status).toContain(`<td>${RULE.statuses.labels[status]}`);
    }
  });
});

describe("the fourth job's controls are the product's", () => {
  const button = code("openplan/src/components/invoicing/invoice-status-advance-button.tsx");
  it("names the control the product shows for each forward move", () => {
    const order = RULE.statuses.order;
    for (let index = 1; index < order.length; index += 1) {
      const pattern = new RegExp(`case "${order[index - 1]}":\\s*return "${RULE.controls.moves[order[index]]}";`);
      expect(button, `${order[index - 1]} to ${order[index]}`).toMatch(pattern);
    }
  });

  it("names Mark rejected, Mark paid, Resubmit, the composer and Close out award", () => {
    expect(button).toContain(`"${RULE.controls.moves.rejected}"`);
    expect(button).toContain(`"${RULE.controls.moves.paid}"`);
    expect(button).toContain(`>\n        ${RULE.controls.resubmit}\n`);
    expect(code("openplan/src/components/invoicing/invoice-record-composer.tsx")).toContain(`data-testid="${RULE.controls.create}-open"`);
    expect(code("openplan/src/components/grants/funding-award-closeout-control.tsx")).toMatch(new RegExp(`>\\s*${RULE.controls.closeOut}\\s*<`));
  });

  it("expects the statuses the routes answer", () => {
    const create = code("openplan/src/app/api/invoicing/invoices/route.ts");
    expect(create).toMatch(new RegExp(`status: ${RULE.controls.createStatus}`));
    expect(code("openplan/src/app/api/invoicing/invoices/[invoiceId]/route.ts")).toContain(`code: "${RULE.productRefusals.list[1].code}"`);
  });
});

describe("the fourth job's profiles are the product's, in every role", () => {
  it("names each descriptor's id and name", () => {
    expect(RULE.profiles.byRole.county).toEqual({ profileId: US_CA_LAPM_REIMBURSEMENT_PROFILE.profileId, profileName: US_CA_LAPM_REIMBURSEMENT_PROFILE.profileName });
    for (const role of ["city", "tribal-area"]) {
      expect(RULE.profiles.byRole[role]).toEqual({ profileId: US_FEDERAL_GENERIC_REIMBURSEMENT_PROFILE.profileId, profileName: US_FEDERAL_GENERIC_REIMBURSEMENT_PROFILE.profileName });
    }
  });

  it("is what the product binds for each role's place, matched to the place", () => {
    for (const role of ROLES) {
      const place = EXAMPLE.journeys.find((journey: Json) => journey.role === role).place;
      const binding = profileForPlace(place);
      expect(binding.profileId, role).toBe(RULE.profiles.byRole[role].profileId);
      expect(binding.selection, role).toBe(RULE.profiles.selection);
    }
    // A workspace with no place is an interim default, and the definition refuses it.
    const unset = resolveReimbursementProfile({ workspaceJurisdiction: null });
    expect(unset.kind === "resolved" && unset.binding.selection).not.toBe(RULE.profiles.selection);
  });

  it("refuses the interim sentence the product prints for an unchosen profile", () => {
    const binding = resolveReimbursementProfile({ workspaceJurisdiction: null });
    if (binding.kind !== "resolved") throw new Error("unresolved");
    const ledger = ledgerFor("paid");
    const html = buildReimbursementWorksheetHtml({
      workspace: { name: "W" }, award: { title: "T" }, period: null, ledger, profile: binding.binding,
      interimDefaultRationale: INTERIM_DEFAULT_RATIONALE, costs: summarizeWorksheetCostEntries({ ok: true, entries: [] }),
    });
    expect(html).toContain(RULE.worksheet.interimNotice);
  });
});

describe("the fourth job's worksheet words are the product's", () => {
  const sheet = RULE.worksheet;
  const closedHtml = (role: string) => {
    const journey = EXAMPLE.journeys.find((entry: Json) => entry.role === role);
    return worksheetHtmlAt(journey, journey.downloads[1].at);
  };

  it("names the title, the prepared note, the footer and the fallback notice", () => {
    expect(sheet.title).toBe(WORKSHEET_DOCUMENT_TITLE);
    expect(sheet.preparedNote).toBe(WORKSHEET_PREPARED_NOTE);
    expect(new RegExp(sheet.pageFooter).test(`   ${WORKSHEET_FOOTER_NOTE} · Page 3 of 4`)).toBe(true);
    expect(code("openplan/src/lib/reports/pdf.ts")).toContain("} · Page <span class=\"pageNumber\"></span> of <span class=\"totalPages\"></span></div>`");
    expect(BUILTIN_PDF_NOTICE.startsWith(sheet.fallbackNotice)).toBe(true);
    expect(sheet.currencyNote).toBe(worksheetCurrencyNote({ code: "USD", declared: true }));
  });

  it("names every figure row the product prints, in its order, in every role", () => {
    for (const role of ROLES) {
      const html = closedHtml(role);
      let at = 0;
      for (const row of sheet.positionRows) {
        const found = html.indexOf(`<th scope="row">${row.label}`, at);
        expect(found, `${role} ${row.label}`).toBeGreaterThan(at);
        at = found;
      }
      for (const heading of Object.values(sheet.sections)) expect(html, `${role} ${heading}`).toContain(`<h2>${heading}</h2>`);
      expect(html).toContain(sheet.closeBasisLabels.reconciled_with_balance);
      expect(html).toContain(sheet.costsNone);
      expect(html).toContain(sheet.resubmitsNote.replace("{number}", "INV-2"));
      expect(html).toContain(sheet.processLine.replace("Process: ", "<strong>Process:</strong> ").replace("{profileName}", RULE.profiles.byRole[role].profileName));
      for (const template of sheet.headerLines) expect(html, `${role} ${template}`).toContain(`<strong>${template.split(":")[0]}:</strong>`);
    }
    // The open worksheet prints no close-out row.
    const open = worksheetHtmlAt(EXAMPLE.journeys[0], EXAMPLE.journeys[0].downloads[0].at);
    for (const row of sheet.positionRows.filter((entry: Json) => entry.whenClosed)) expect(open).not.toContain(row.label);
    // The due dates nobody entered read the definition's words.
    expect(open).toContain(`<span class="empty">${sheet.notRecorded}</span>`);
  });

  it("names the item headings the worksheet prints", () => {
    for (const kind of JOB.pdfs) {
      expect(JOB.itemHeadings[kind]).toEqual({ "award-position": sheet.sections.position, "invoice-records": sheet.sections.invoices });
    }
  });

  it("prints no refused phrase and no form name in any role's honest worksheet", () => {
    for (const role of ROLES) {
      const html = closedHtml(role).toLowerCase();
      for (const phrase of RULE.refusedPhrases.phrases) expect(html, `${role}: ${phrase}`).not.toContain(phrase.toLowerCase());
      for (const name of RULE.formNames.names) expect(html, `${role}: ${name}`).not.toContain(name.toLowerCase());
    }
    expect(WORKSHEET_NO_FORM_PACK_NOTE).not.toMatch(/SF|5-A/);
  });
});

describe("the fourth job's other fixed values are the product's", () => {
  it("uses the other journeys' demonstration label", () => {
    expect(readText("qa-harness/journey-campaign-lib.js")).toContain(`const DEMONSTRATION_LABEL = '${RULE.demonstrationLabel.text}';`);
  });

  it("tracks a catalog program open to counties, cities and tribes", () => {
    const catalogKey = JOB.journeyFields.find((rule: Json) => rule.field === "award.catalogKey").equals;
    expect(GRANT_PROGRAM_CATALOG.some((entry) => entry.key === catalogKey)).toBe(true);
  });

  it("refuses with the codes and statuses the database and routes use", () => {
    const migrations = ["20261117000000_award_closure_custody.sql", "20261117000100_reimbursement_request_status_custody.sql"].map((file) => readText(`openplan/supabase/migrations/${file}`)).join("\n");
    expect(migrations).toContain(`ERRCODE = '${RULE.custody.codes[0]}'`);
    expect(migrations).toContain(`ERRCODE = '${RULE.custody.codes[1]}'`);
    const patch = code("openplan/src/app/api/invoicing/invoices/[invoiceId]/route.ts");
    expect(patch).toContain('if (error?.code === "23514") throw new InvoiceUpdateRefusedError(error.message, 422);');
    expect(RULE.productRefusals.list[0].statuses).toEqual([422]);
    expect(code("openplan/src/app/api/funding-awards/[awardId]/closeout/route.ts")).toContain('canAccessWorkspaceAction("awards.close", access.membership.role)');
    expect(patch).toContain('{ error: "Owner or admin role required for invoice writes" }, { status: 403 }');
    expect(RULE.member.statuses).toEqual([403]);
  });

  it("works its hand totals from its fixed amounts with the product's ledger", () => {
    const fixed = RULE.fixed;
    const finals: Record<string, string> = Object.fromEntries(fixed.requests.map((entry: Json) => [entry.key, entry.path.at(-1)]));
    const result = buildAwardDrawdownLedger({
      award: { awarded_amount: fixed.ceiling, match_amount: fixed.match, match_posture: fixed.matchPosture },
      invoiceRead: { ok: true, invoices: fixed.requests.map((entry: Json) => ({ id: entry.key, invoice_number: entry.number, status: finals[entry.key], amount: entry.gross, retention_amount: entry.retention, retention_percent: 0 })) },
    });
    if (!result.ok) throw new Error(result.message);
    const dollars = (value: string) => Number(value);
    expect(result.ledger.claimedGrossToDate).toBe(dollars(fixed.handTotals.claimedGross));
    expect(result.ledger.paidToDate).toBe(dollars(fixed.handTotals.paidNet));
    expect(result.ledger.outstandingClaimed).toBe(dollars(fixed.handTotals.outstandingNet));
    expect(result.ledger.rejectedGross).toBe(dollars(fixed.handTotals.rejectedGross));
    expect(result.ledger.remainingAgainstCeiling).toBe(dollars(fixed.handTotals.remaining));
    // The close-out command releases the ceiling minus net paid (20261117000000).
    expect(dollars(fixed.ceiling) - result.ledger.paidToDate).toBe(dollars(fixed.handTotals.released));
  });

  it("states its limits without an em dash", () => {
    for (const text of Object.values(JOB.limitTexts)) expect(String(text)).not.toContain("—");
  });
});
