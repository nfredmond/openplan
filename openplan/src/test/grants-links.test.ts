import { describe, expect, it } from "vitest";
import {
  isGrantsAwardCommand,
  isGrantsCommand,
  isGrantsReimbursementCommand,
  resolveWorkspaceCommandHref,
} from "@/lib/operations/grants-links";
import type { WorkspaceCommandQueueItem } from "@/lib/operations/workspace-summary";

function buildCommand(overrides: Partial<WorkspaceCommandQueueItem>): WorkspaceCommandQueueItem {
  return {
    key: "anchor-project-funding-needs",
    moduleKey: "grants",
    moduleLabel: "Grants OS",
    title: "Anchor project funding needs",
    detail: "1 project funding lane has linked opportunities but still no recorded funding-need anchor.",
    href: "/projects/project-anchor#project-funding-opportunities",
    targetProjectId: "project-anchor",
    tone: "warning",
    priority: 3,
    badges: [{ label: "Missing anchors", value: 1 }],
    ...overrides,
  };
}

describe("grants-links", () => {
  it("treats module-tagged grants commands as shared grants commands", () => {
    expect(
      isGrantsCommand(
        buildCommand({
          key: "anchor-project-funding-needs",
        })
      )
    ).toBe(true);
  });

  it("identifies reimbursement-focused grants commands", () => {
    expect(
      isGrantsReimbursementCommand(
        buildCommand({
          key: "start-project-reimbursement-packets",
          href: "/projects/project-gap#project-invoices",
          targetProjectId: "project-gap",
        })
      )
    ).toBe(true);

    expect(
      isGrantsReimbursementCommand(
        buildCommand({
          key: "anchor-project-funding-needs",
        })
      )
    ).toBe(false);
  });

  it("identifies award-conversion grants commands", () => {
    expect(
      isGrantsAwardCommand(
        buildCommand({
          key: "record-awarded-funding",
          targetOpportunityId: "opportunity-award-1",
        })
      )
    ).toBe(true);

    expect(
      isGrantsAwardCommand(
        buildCommand({
          key: "advance-project-reimbursement-invoicing",
          targetInvoiceId: "invoice-1",
        })
      )
    ).toBe(false);
  });

  it("routes award-conversion commands into the grants award conversion composer", () => {
    expect(
      resolveWorkspaceCommandHref(
        buildCommand({
          key: "record-awarded-funding",
          targetOpportunityId: "opportunity-award-1",
        })
      )
    ).toBe("/grants?focusOpportunityId=opportunity-award-1#grants-award-conversion-composer");
  });

  it("routes reimbursement-start commands into the grants reimbursement composer", () => {
    expect(
      resolveWorkspaceCommandHref(
        buildCommand({
          key: "start-project-reimbursement-packets",
          href: "/projects/project-gap#project-invoices",
          targetProjectId: "project-gap",
        })
      )
    ).toBe("/grants?focusProjectId=project-gap#grants-reimbursement-composer");
  });

  it("routes invoice follow-through commands into the grants reimbursement triage lane", () => {
    expect(
      resolveWorkspaceCommandHref(
        buildCommand({
          key: "advance-project-reimbursement-invoicing",
          href: "/projects/project-gap#project-invoices",
          targetProjectId: "project-gap",
          targetInvoiceId: "invoice-1",
        })
      )
    ).toBe("/grants?focusInvoiceId=invoice-1#grants-reimbursement-triage");
  });
});
