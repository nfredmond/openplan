import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { packetFixture } from "./helpers/owp-reimbursement-fixture";
import { reimbursementCommandSchema, reimbursementTotals } from "@/lib/programs/work-program/reimbursement";
import { buildPeriodReportHtml, buildPeriodReportWorkbook } from "@/lib/programs/work-program/reporting-export";
import { utils } from "xlsx";
describe("Reimbursement reviewed amounts and reusable packets", () => {
 it("reconstructs reimbursement and match without adding prior packet requests", () => {
  const { draft, report } = packetFixture();
  expect(reimbursementTotals(draft, report)).toEqual({ totalCost: "12.35", eligibleTotal: "12.35", reimbursementTotal: "10.00", matchTotal: "2.35" });
  draft.costs[0].eligibleAmount = "11.35"; draft.costs[0].shares[0].amount = "9.00";
  expect(reimbursementTotals(draft, report).reimbursementTotal).toBe("9.00");
 });
 it("refuses duplicate sources, billing, excess eligibility and unbalanced shares", () => {
  for (const fault of ["duplicate", "billing", "excess", "split", "foreign", "negative", "duplicateFund"] as const) {
   const { draft, report, actual } = packetFixture();
   if (fault === "duplicate") draft.costs.push(draft.costs[0]);
   if (fault === "billing") actual.kind = "billed";
   if (fault === "excess") draft.costs[0].eligibleAmount = "20.00";
   if (fault === "split") draft.costs[0].shares[0].amount = "9.00";
   if (fault === "foreign") draft.costs[0].shares[0].fundId = randomUUID();
   if (fault === "negative") draft.costs[0].shares[0].amount = "-1.00";
   if (fault === "duplicateFund") draft.costs[0].shares[1].fundId = draft.costs[0].shares[0].fundId;
   expect(() => reimbursementTotals(draft, report), fault).toThrow();
  }
 });
 it("requires evidence and rejects extra precision at the request boundary", () => {
  const { draft } = packetFixture();
  const command = { kind: "save", requestId: randomUUID(), claimId: randomUUID(), expectedVersion: 0, draft };
  expect(reimbursementCommandSchema.safeParse(command).success).toBe(true);
  draft.costs[0].eligibleAmount = "12.351";
  expect(reimbursementCommandSchema.safeParse(command).success).toBe(false);
  draft.costs[0].eligibleAmount = "12.35"; draft.authorityEvidence = "";
  expect(reimbursementCommandSchema.safeParse(command).success).toBe(false);
 });
 it("exports source identities, reviewed evidence, match and unknown remaining work without changing numeric-looking identifiers", () => {
  const { report, actual } = packetFixture();
  actual.detail.contractId = randomUUID(); actual.detail.projectId = randomUUID(); actual.spend_entry_id = randomUUID();
  report.snapshot.reimbursement!.contractCosts = [{ id: randomUUID(), engagement_id: actual.detail.contractId, spend_entry_id: actual.spend_entry_id }];
  const html = buildPeriodReportHtml(report), book = buildPeriodReportWorkbook(report);
  expect(html).toContain("Reimbursement supporting packet"); expect(html).toContain(report.snapshot.reimbursement!.sourceReportHash);
  expect(book.SheetNames).toEqual(expect.arrayContaining(["Eligibility decisions", "Funding shares", "Cost work links", "Packet history"]));
  const rows = utils.sheet_to_json<(string | number)[]>(book.Sheets["Eligibility decisions"], { header: 1 });
  expect(rows[1].slice(3)).toEqual([12.35, 12.35, "000123.45"]);
  const shares = utils.sheet_to_json<(string | number)[]>(book.Sheets["Funding shares"], { header: 1 });
  expect(shares[1][3]).toBe("000123.45"); expect(shares[1][5]).toBe(10);
  const links = utils.sheet_to_json<(string | number)[]>(book.Sheets["Cost work links"], { header: 1 });
  expect(links[1].slice(0,5)).toEqual([actual.id, actual.detail.projectId, actual.detail.contractId, "Unresolved", actual.spend_entry_id]);
  expect(html).toContain(actual.spend_entry_id); expect(book.SheetNames).toContain("Shared contract costs");
  report.snapshot.reimbursement!.reimbursementTotal = "99.00";
  expect(() => buildPeriodReportHtml(report)).toThrow("Retained reimbursement totals do not reconcile");
 });
});
