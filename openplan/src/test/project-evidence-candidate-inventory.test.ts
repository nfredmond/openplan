import { describe, expect, it } from "vitest";
import { PROJECT_EVIDENCE_FILE_BYTE_LIMIT } from "@/lib/project-evidence-bundles/contracts";
import { loadProjectEvidenceCandidateInventory } from "@/lib/project-evidence-bundles/inventory";

const PROJECT = {
  id: "11111111-1111-4111-8111-111111111111",
  workspace_id: "22222222-2222-4222-8222-222222222222",
  name: "Main Street",
  updated_at: "2026-08-26T18:00:00.000Z",
};

type FakeRow = Record<string, unknown>;

function fakeClient(
  data: Record<string, FakeRow[]>,
  errors: Record<string, string> = {}
) {
  const calls: Array<{ table: string; select: string; filters: Array<[string, string]>; limit: number | null }> = [];
  return {
    calls,
    client: {
      from(table: string) {
        return {
          select(select: string) {
            const call = { table, select, filters: [] as Array<[string, string]>, limit: null as number | null };
            calls.push(call);
            let offset=0;
            const chain = {
              eq(column: string, value: string) {
                call.filters.push([column, value]);
                return chain;
              },
              range(from:number,to:number) { offset=from; call.limit=to+1; return chain; },
              or(filter:string,options:{referencedTable:string}) { call.filters.push([options.referencedTable+".or",filter]); return chain; },
              order() {
                return chain;
              },
              limit(value: number) {
                call.limit = value;
                return chain;
              },
              then(resolve: (value: unknown) => void) {
                resolve({
                  data: errors[table] ? null : (data[table] ?? []).slice(offset, call.limit ?? undefined),
                  error: errors[table] ? { message: errors[table] } : null,
                });
              },
            };
            return chain;
          },
        };
      },
    },
  };
}

describe("project evidence candidate inventory", () => {
  it("discovers a campaign-targeted report through project coverage without inventing a second target",async()=>{
    const campaign={id:"campaign",workspace_id:PROJECT.workspace_id,project_id:PROJECT.id};
    const fake=fakeClient({engagement_campaigns:[campaign],engagement_campaign_projects:[{engagement_campaigns:campaign}],report_artifacts:[{
      id:"campaign-pdf",report_id:"campaign-report",artifact_kind:"pdf",storage_path:"retained.pdf",metadata_json:{sha256:"hash",engagementReviewJobId:"job",scope:"public"},
      reports:{workspace_id:PROJECT.workspace_id,project_id:null,engagement_campaign_id:"campaign",title:"Campaign review"},
    }]});
    const inventory=await loadProjectEvidenceCandidateInventory(fake.client,PROJECT);
    expect(inventory.failureMessage).toBeNull();
    expect(inventory.readFailed).toBe(false);
    expect(inventory.candidates.filter(row=>row.sourceId==="report_artifacts")).toHaveLength(1);
    expect(inventory.candidates.find(row=>row.recordId==="campaign-pdf")?.recordedChecksumSha256).toBe("hash");
    const query=fake.calls.find(call=>call.table==="report_artifacts");
    expect(inventory.candidates.find(row=>row.recordId==="campaign-pdf")?.title).toContain("public review copy");
    expect(query?.select).toContain("engagement_campaign_id");
    expect(query?.filters).toContainEqual(["reports.workspace_id",PROJECT.workspace_id]);
    expect(query?.filters).toContainEqual(["reports.or",`project_id.eq.${PROJECT.id},engagement_campaign_id.in.(campaign)`]);
    expect(query?.filters).not.toContainEqual(["reports.project_id",PROJECT.id]);
  });

  it("uses the existing library registry without the 20-row display cap and defaults only the GeoPackage and latest report artifact", async () => {
    const fake = fakeClient({
      report_artifacts: [
        {
          id: "a",
          report_id: "report-1",
          artifact_kind: "pdf",
          storage_path: `${PROJECT.workspace_id}/report-1/a.pdf`,
          generated_at: "2026-08-26T10:00:00Z",
          updated_at: "2026-08-26T10:00:00Z",
          metadata_json: {},
          reports: { workspace_id: PROJECT.workspace_id, project_id: PROJECT.id, title: "Board packet" },
        },
        {
          id: "b",
          report_id: "report-1",
          artifact_kind: "pdf",
          storage_path: `${PROJECT.workspace_id}/report-1/b.pdf`,
          generated_at: "2026-08-25T10:00:00Z",
          updated_at: "2026-08-25T10:00:00Z",
          metadata_json: {},
          reports: { workspace_id: PROJECT.workspace_id, project_id: PROJECT.id, title: "Board packet" },
        },
      ],
      client_invoices: [
        {
          id: "invoice-1",
          project_id: PROJECT.id,
          invoice_number: "12",
          status: "draft",
          created_at: "2026-08-24T00:00:00Z",
          updated_at: "2026-08-24T00:00:00Z",
        },
      ],
      aerial_artifact_custody: [
        {
          id: "custody-1",
          processing_job_id: "job-1",
          kind: "orthomosaic",
          ordinal: 0,
          state: "failed",
          failure_detail: "The source link expired before custody completed.",
          created_at: "2026-08-24T00:00:00Z",
          aerial_missions: { title: "Survey" },
          aerial_processing_jobs: { project_id: PROJECT.id },
        },
      ],
      project_evidence_bundles: [],
    });

    const inventory = await loadProjectEvidenceCandidateInventory(fake.client, PROJECT);
    expect(inventory.readFailed).toBe(false);
    expect(inventory.candidates.filter((item) => item.defaultSelected).map((item) => item.id)).toEqual([
      `project_geopackage:${PROJECT.id}`,
      "report_artifacts:a",
    ]);
    expect(inventory.candidates.find((item) => item.id === "report_artifacts:b")?.defaultSelected).toBe(false);
    expect(inventory.candidates.find((item) => item.id === "report_artifacts:a")?.evidenceDescriptor?.support).toEqual({
      status: "not_a_numeric_claim",
      reason: null,
    });
    expect(inventory.candidates.find((item) => item.id === "invoice_pdfs:invoice-1")).toMatchObject({
      defaultSelected: false,
      retrievalState: "rendered_on_freeze",
      custodyState: "rendered_on_freeze",
    });
    expect(inventory.candidates.find((item) => item.id === "aerial_artifact_custody:custody-1")).toMatchObject({
      selectable: false,
      retrievalState: "reference_only",
      exclusionReason: "OpenPlan does not hold bytes for this deliverable.",
    });
    const libraryCalls = fake.calls.filter((call) =>
      !["project_evidence_bundles", "plans", "engagement_campaigns", "engagement_campaign_projects"].includes(call.table)
    );
    expect(libraryCalls).toHaveLength(7);
    expect(libraryCalls.every((call) => call.limit === 501)).toBe(true);
    expect(libraryCalls.every((call) => call.filters.some(([column, value]) => (column.endsWith("project_id") && value === PROJECT.id) || (column === "reports.or" && value === `project_id.eq.${PROJECT.id}`)))).toBe(true);
    expect(fake.calls.find((call) => call.table === "kb_documents")?.select).toContain("checksum");
    expect(fake.calls.find((call) => call.table === "model_run_artifacts")?.select).toContain("file_url");
  });

  it("visibly stops at 500 review candidates instead of silently claiming a complete list", async () => {
    const knowledgeRows = Array.from({ length: 501 }, (_, index) => ({
      id: `doc-${index}`,
      project_id: PROJECT.id,
      title: `Document ${index}`,
      source_kind: "uploaded_txt",
      original_filename: `${index}.txt`,
      content_type: "text/plain",
      byte_size: 1,
      storage_ref: `storage://kb-documents/${PROJECT.workspace_id}/doc-${index}/${index}.txt`,
      checksum: null,
      status: "stored",
      created_at: new Date(Date.UTC(2026, 7, 26, 0, 0, 0, index)).toISOString(),
      updated_at: "2026-08-26T00:00:00Z",
    }));
    const fake = fakeClient({ kb_documents: knowledgeRows, project_evidence_bundles: [] });
    const inventory = await loadProjectEvidenceCandidateInventory(fake.client, PROJECT);
    expect(inventory.inventoryTruncated).toBe(true);
    expect(inventory.candidates).toHaveLength(500);
    expect(inventory.candidates[0].required).toBe(true);
    expect(inventory.candidates.at(-1)?.title).toBe("Document 498");
  });

  it("distinguishes a source read failure from an empty source and refuses a trusted review state", async () => {
    const fake = fakeClient({ project_evidence_bundles: [] }, { report_artifacts: "connection dropped" });
    const inventory = await loadProjectEvidenceCandidateInventory(fake.client, PROJECT);
    expect(inventory.readFailed).toBe(true);
    expect(inventory.failureMessage).toContain("Reports: connection dropped");
    expect(inventory.sourceOutcomes.report_artifacts).toEqual({ count: 0, failed: true, pending: false });
  });

  it("keeps a known oversized file visible as reference-only evidence", async () => {
    const fake = fakeClient({
      kb_documents: [
        {
          id: "oversized",
          project_id: PROJECT.id,
          title: "Survey archive",
          byte_size: PROJECT_EVIDENCE_FILE_BYTE_LIMIT + 1,
          storage_ref: `storage://kb-documents/${PROJECT.workspace_id}/oversized/survey.zip`,
          status: "ready",
          created_at: "2026-08-26T00:00:00Z",
          updated_at: "2026-08-26T00:00:00Z",
        },
      ],
      project_evidence_bundles: [],
    });
    const inventory = await loadProjectEvidenceCandidateInventory(fake.client, PROJECT);
    expect(inventory.candidates.find((item) => item.recordId === "oversized")).toMatchObject({
      retrievalState: "reference_only",
      defaultSelected: false,
      selectable: false,
      exclusionReason: expect.stringContaining("reference-only"),
    });
  });
});
