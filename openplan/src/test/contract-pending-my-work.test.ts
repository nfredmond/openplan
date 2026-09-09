import { describe, expect, it } from "vitest";
import { loadMyWork } from "@/lib/my-work/query";
import { createFakeSupabase, ME, NOW, ROSTER, WS_A, WS_B } from "./helpers/fake-my-work-tables";

describe("pending contract decisions in My Work", () => {
  it("reads scoped retained versions with their decision-specific destination", async () => {
    const kinds = ["baseline", "master", "received_review", "received_finance", "response", "accounting"];
    const fake = createFakeSupabase({ contract_pending_my_work: [
      ...kinds.map((review_kind, index) => ({ id: `decision-${index}`, workspace_id: WS_A, engagement_id: "contract-a", project_id: "project-a", title: `Synthetic ${review_kind}`, review_kind, reported_on: "2026-09-08" })),
      { id: "foreign", workspace_id: WS_B, engagement_id: "private", title: "Private assignment", review_kind: "baseline" },
    ] });
    const result = await loadMyWork(fake.client, { workspaceId: WS_A, userId: ME, roster: ROSTER, now: NOW, scope: "assigned" });
    const items = result.items.filter(item => item.sourceId === "contract_pending_reviews");
    expect(fake.selects.contract_pending_my_work).toBe("id, workspace_id, engagement_id, project_id, title, review_kind, reported_on");
    expect(items.map(item => item.id)).toEqual(kinds.map((kind, index) => `${kind}:decision-${index}`));
    expect(items.map(item => item.title)).toEqual(["Approve contract baseline: Synthetic baseline", "Approve master terms: Synthetic master", "Review received invoice: Synthetic received_review", "Approve received invoice: Synthetic received_finance", "Review proposed response: Synthetic response", "Reconcile accounting import: Synthetic accounting"]);
    expect(items.map(item => item.href)).toEqual(["baselines", "master-terms", "received", "received", "remaining&section=Responses", "accounting"].map(tab => `/invoicing/engagements/contract-a?tab=${tab}`));
    expect(items.every(item => item.block === "needs_review" && item.projectId === "project-a" && item.assigneeUserId === null)).toBe(true);
    expect(items[4].detail).toContain("changed inputs require a new comparison");
  });
  it("reports an unavailable decision queue instead of claiming nothing is pending", async () => {
    const fake = createFakeSupabase({}, { contract_pending_my_work: "Synthetic read failure" });
    const result = await loadMyWork(fake.client, { workspaceId: WS_A, userId: ME, roster: ROSTER, now: NOW });
    expect(result.reads.describe()).toContain("pending contract approvals and invoice reviews");
  });
});

it("routes submitted remaining-work reviews to the review section",async()=>{
 const fake=createFakeSupabase({contract_delivery_my_work:[{id:"update",workspace_id:WS_A,engagement_id:"contract-a",task_id:"task",project_id:"project-a",title:"Synthetic report",assignee_user_id:ME,reported_on:"2026-09-08"}]});const result=await loadMyWork(fake.client,{workspaceId:WS_A,userId:ME,roster:ROSTER,now:NOW});expect(result.items.find(i=>i.sourceId==="contract_work_reviews")).toMatchObject({block:"needs_review",href:"/invoicing/engagements/contract-a?tab=remaining#work-update-update"});
});

it("reads active contract tasks with scoped attributed deadlines",async()=>{
 const fake=createFakeSupabase({contract_active_tasks_my_work:[{id:"assignment",workspace_id:WS_A,engagement_id:"contract-a",project_id:"project-a",title:"Synthetic active work",assignee_user_id:ME,deadline:"2026-09-08"},{id:"foreign",workspace_id:WS_B,engagement_id:"private",title:"Private"}]});const result=await loadMyWork(fake.client,{workspaceId:WS_A,userId:ME,roster:ROSTER,now:NOW});const items=result.items.filter(i=>i.sourceId==="contract_tasks");expect(items).toHaveLength(1);expect(items[0]).toMatchObject({id:"assignment",block:"deadlines",projectId:"project-a",assigneeUserId:ME,title:"Synthetic active work",dueOn:"2026-09-08"});expect(fake.selects.contract_active_tasks_my_work).toBe("id, engagement_id, workspace_id, assignee_user_id, project_id, title, deadline");
});
