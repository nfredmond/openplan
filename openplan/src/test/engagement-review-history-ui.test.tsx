import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EngagementReviewFiles } from "@/components/engagement/engagement-review-files";
const job=(id:string,format:number|null,scope="internal")=>({id,report_id:id,scope,snapshot_format:format,filters_json:{},snapshot_sha256:"synthetic",status:"complete",phase:"Ready",failure_detail:null,created_at:"2026-09-14T00:00:00Z",artifacts_json:[]});
beforeEach(()=>{
 localStorage.clear();vi.stubGlobal("fetch",vi.fn(async()=>({ok:true,json:async()=>({jobs:[job("old",1),job("new",2),job("unknown",null),job("public",1,"public")],canWrite:true})})));
});
describe("decision-history scope at report preparation and retrieval",()=>{
 it("shows the broader private history scope before queueing and removes it for public selection",async()=>{
  render(<EngagementReviewFiles campaignId="synthetic-consultation"/>);
  await screen.findByLabelText("Disclosure scope");
  expect(screen.getByText(/Internal files also retain the entire consultation decision history/)).toBeVisible();
  fireEvent.change(screen.getByLabelText("Disclosure scope"),{target:{value:"public"}});
  expect(screen.queryByText(/Internal files also retain the entire consultation decision history/)).not.toBeInTheDocument();
  expect(screen.getByLabelText("Review status")).toHaveValue("approved");
 });
 it("distinguishes old, new and unknown saved formats instead of showing absent history as zero",async()=>{
  render(<EngagementReviewFiles campaignId="synthetic-consultation"/>);
  expect(await screen.findByText(/This earlier saved format does not contain decision history/)).toBeVisible();
  expect(screen.getByText(/Includes the entire consultation decision history/)).toBeVisible();
  expect(screen.getByText(/Decision-history availability could not be determined/)).toBeVisible();
  expect(screen.getAllByText(/This earlier saved format does not contain decision history/)).toHaveLength(1);
 });
 it("retains the old-format notice when opening that exact saved report",async()=>{
  render(<EngagementReviewFiles campaignId="synthetic-consultation" reportId="old"/>);
  expect(await screen.findByText(/This earlier saved format does not contain decision history/)).toBeVisible();
  expect(screen.queryByText(/Includes the entire consultation decision history/)).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Disclosure scope")).not.toBeInTheDocument();
 });
});
