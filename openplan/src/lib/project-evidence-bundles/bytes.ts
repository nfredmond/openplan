import { readFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildEngagementBilledSummary } from "@/lib/invoicing/receivables";
import {
  buildClientInvoiceHtml,
  type ClientInvoicePdfClient,
  type ClientInvoicePdfEngagement,
  type ClientInvoicePdfInvoice,
  type ClientInvoicePdfLineItem,
} from "@/lib/invoicing/invoice-pdf";
import { renderReportPdf } from "@/lib/reports/pdf";
import { KB_DOCUMENTS_BUCKET, sanitizeFilename } from "@/lib/knowledge-base/documents";
import { AERIAL_ARTIFACT_BUCKET } from "@/lib/aerial/artifact-custody";
import { AERIAL_IMAGERY_BUCKET, sanitizeImageryFilename } from "@/lib/aerial/imagery";
import {
  resolveContainedLocalPath,
  resolveRunWorkDir,
  workerLocalRoot,
} from "@/lib/models/artifact-source";
import { resolveTenantScopedStorageTarget } from "@/lib/files/tenant-scoped-storage";
import type { ProjectEvidenceCandidate } from "./contracts";
import { ProjectEvidenceBundleError, safeEvidenceFilename, type ResolvedProjectEvidenceFile } from "./archive";

type ProjectScope = { id: string; workspace_id: string };
type ServiceClient = SupabaseClient;

async function storedBytes(
  service: ServiceClient,
  bucket: string,
  objectPath: string,
  label: string
): Promise<Buffer> {
  const result = await service.storage.from(bucket).download(objectPath);
  if (result.error || !result.data) {
    throw new ProjectEvidenceBundleError(
      "missing_evidence",
      `${label} could not be read from private storage.`
    );
  }
  return Buffer.from(await result.data.arrayBuffer());
}

function failMissing(candidate: ProjectEvidenceCandidate): never {
  throw new ProjectEvidenceBundleError("missing_evidence", `${candidate.title} is no longer available.`);
}

function result(
  candidate: ProjectEvidenceCandidate,
  bytes: Buffer,
  filename: string,
  contentType: string | null
): ResolvedProjectEvidenceFile {
  return { candidate, bytes, filename: safeEvidenceFilename(filename, `${candidate.recordId}.bin`), contentType };
}

async function knowledgeBaseBytes(
  caller: SupabaseClient,
  service: ServiceClient,
  project: ProjectScope,
  candidate: ProjectEvidenceCandidate
): Promise<ResolvedProjectEvidenceFile> {
  const read = await caller
    .from("kb_documents")
    .select("id, workspace_id, project_id, title, original_filename, content_type, storage_ref")
    .eq("id", candidate.recordId)
    .eq("workspace_id", project.workspace_id)
    .eq("project_id", project.id)
    .maybeSingle();
  const row = read.data;
  if (read.error || !row || typeof row.storage_ref !== "string" || !row.storage_ref.trim()) failMissing(candidate);
  const raw = row.storage_ref.trim();
  const ref = resolveTenantScopedStorageTarget(raw, {
    bucket: KB_DOCUMENTS_BUCKET,
    objectPathPrefix: `${project.workspace_id}/${row.id}/`,
  });
  if (!ref) failMissing(candidate);
  const bytes = await storedBytes(service, ref.bucket, ref.objectPath, candidate.title);
  return result(
    candidate,
    bytes,
    sanitizeFilename(row.original_filename ?? row.title),
    typeof row.content_type === "string" ? row.content_type : candidate.contentType
  );
}

function reportFilename(title: string | null, generatedAt: string | null, extension: string): string {
  const slug = (title ?? "openplan-report")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${[slug || "openplan-report", generatedAt?.slice(0, 10)].filter(Boolean).join("-")}.${extension}`;
}

async function reportBytes(
  caller: SupabaseClient,
  service: ServiceClient,
  project: ProjectScope,
  candidate: ProjectEvidenceCandidate
): Promise<ResolvedProjectEvidenceFile> {
  const read = await caller
    .from("report_artifacts")
    .select("id, report_id, artifact_kind, storage_path, generated_at, metadata_json, reports!inner(workspace_id, project_id, title)")
    .eq("id", candidate.recordId)
    .eq("reports.workspace_id", project.workspace_id)
    .eq("reports.project_id", project.id)
    .maybeSingle();
  if (read.error || !read.data) failMissing(candidate);
  const row = read.data as Record<string, unknown>;
  const reportValue = Array.isArray(row.reports) ? row.reports[0] : row.reports;
  const report = reportValue && typeof reportValue === "object" ? (reportValue as Record<string, unknown>) : null;
  const reportId = typeof row.report_id === "string" ? row.report_id : "";
  const kind = row.artifact_kind === "pdf" ? "pdf" : "html";
  const filename = reportFilename(
    typeof report?.title === "string" ? report.title : null,
    typeof row.generated_at === "string" ? row.generated_at : null,
    kind
  );
  const storagePath = typeof row.storage_path === "string" ? row.storage_path.trim() : "";
  if (storagePath) {
    const ref = resolveTenantScopedStorageTarget(storagePath, {
      bucket: "report-artifacts",
      objectPathPrefix: `${project.workspace_id}/${reportId}/`,
      extension: `.${kind}`,
    });
    if (!ref) failMissing(candidate);
    return result(
      candidate,
      await storedBytes(service, ref.bucket, ref.objectPath, candidate.title),
      filename,
      kind === "pdf" ? "application/pdf" : "text/html; charset=utf-8"
    );
  }
  const metadata = row.metadata_json && typeof row.metadata_json === "object"
    ? (row.metadata_json as Record<string, unknown>)
    : null;
  if (kind === "html" && typeof metadata?.htmlContent === "string" && metadata.htmlContent) {
    return result(candidate, Buffer.from(metadata.htmlContent, "utf8"), filename, "text/html; charset=utf-8");
  }
  return failMissing(candidate);
}

async function grantBytes(
  caller: SupabaseClient,
  service: ServiceClient,
  project: ProjectScope,
  candidate: ProjectEvidenceCandidate
): Promise<ResolvedProjectEvidenceFile> {
  const read = await caller
    .from("funding_opportunity_application_exports")
    .select("id, workspace_id, opportunity_id, storage_path, generated_at, funding_opportunities!inner(project_id, title)")
    .eq("id", candidate.recordId)
    .eq("workspace_id", project.workspace_id)
    .eq("funding_opportunities.project_id", project.id)
    .maybeSingle();
  if (read.error || !read.data) failMissing(candidate);
  const row = read.data as Record<string, unknown>;
  const opportunityValue = Array.isArray(row.funding_opportunities)
    ? row.funding_opportunities[0]
    : row.funding_opportunities;
  const opportunity = opportunityValue && typeof opportunityValue === "object"
    ? (opportunityValue as Record<string, unknown>)
    : null;
  const opportunityId = typeof row.opportunity_id === "string" ? row.opportunity_id : "";
  const storagePath = typeof row.storage_path === "string" ? row.storage_path.trim() : "";
  const ref = resolveTenantScopedStorageTarget(storagePath, {
    bucket: "grant-application-exports",
    objectPathPrefix: `${project.workspace_id}/${opportunityId}/`,
    extension: ".pdf",
  });
  if (!ref) failMissing(candidate);
  const title = typeof opportunity?.title === "string" ? opportunity.title : "application-packet";
  const filename = reportFilename(title, typeof row.generated_at === "string" ? row.generated_at : null, "pdf");
  return result(candidate, await storedBytes(service, ref.bucket, ref.objectPath, candidate.title), filename, "application/pdf");
}

function invoiceFilename(invoiceNumber: string): string {
  const slug = invoiceNumber.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
  return `invoice-${slug || "document"}.pdf`;
}

/** The invoice download route and evidence freezer both call this renderer. */
export async function resolveInvoicePdfBytes(
  caller: SupabaseClient,
  invoiceId: string,
  expectedProject?: ProjectScope
): Promise<{
  bytes: Buffer;
  filename: string;
  invoice: ClientInvoicePdfInvoice & { id: string; workspace_id: string; project_id: string | null };
  engine: string;
  pageCount: number | null;
}> {
  let query = caller
    .from("client_invoices")
    .select(
      "id, workspace_id, client_id, engagement_id, project_id, invoice_number, status, sent_date, paid_date, period_start, period_end, invoice_date, due_date, subtotal_amount, retention_percent, retention_amount, total_amount, payment_terms, currency_code, notes, created_by, created_at, updated_at"
    )
    .eq("id", invoiceId);
  if (expectedProject) {
    query = query.eq("workspace_id", expectedProject.workspace_id).eq("project_id", expectedProject.id);
  }
  const invoiceRead = await query.single();
  const invoice = invoiceRead.data as
    | (ClientInvoicePdfInvoice & {
        id: string;
        workspace_id: string;
        project_id: string | null;
        client_id: string;
        engagement_id: string | null;
      })
    | null;
  if (invoiceRead.error || !invoice) {
    throw new ProjectEvidenceBundleError("missing_evidence", "The invoice record is no longer available.");
  }
  const [workspaceResult, clientResult, lineItemsResult] = await Promise.all([
    caller.from("workspaces").select("id, name").eq("id", invoice.workspace_id).single(),
    caller
      .from("invoicing_clients")
      .select("name, billing_address, contact_name, contact_email")
      .eq("id", invoice.client_id)
      .single(),
    caller
      .from("client_invoice_line_items")
      .select("description, quantity, unit_label, unit_amount, amount, position")
      .eq("invoice_id", invoice.id)
      .order("position", { ascending: true }),
  ]);
  if (workspaceResult.error || clientResult.error || lineItemsResult.error) {
    throw new ProjectEvidenceBundleError("missing_evidence", "The invoice document could not be assembled.");
  }

  let engagement: ClientInvoicePdfEngagement = null;
  let engagementBilled = null;
  if (invoice.engagement_id) {
    const engagementRead = await caller
      .from("invoicing_engagements")
      .select("id, title, reference_code, not_to_exceed_amount")
      .eq("id", invoice.engagement_id)
      .single();
    if (engagementRead.error || !engagementRead.data) {
      throw new ProjectEvidenceBundleError("missing_evidence", "The invoice engagement could not be read.");
    }
    engagement = engagementRead.data as ClientInvoicePdfEngagement;
    const nte = (engagementRead.data as { not_to_exceed_amount?: unknown }).not_to_exceed_amount;
    if (nte !== null && nte !== undefined) {
      const invoicesRead = await caller
        .from("client_invoices")
        .select("id, status, engagement_id, subtotal_amount, retention_percent, retention_amount, total_amount")
        .eq("engagement_id", invoice.engagement_id);
      if (!invoicesRead.error) {
        engagementBilled = buildEngagementBilledSummary(
          engagementRead.data as Parameters<typeof buildEngagementBilledSummary>[0],
          (invoicesRead.data ?? []) as Parameters<typeof buildEngagementBilledSummary>[1]
        );
      }
    }
  }

  const html = buildClientInvoiceHtml({
    workspace: workspaceResult.data as { name: string | null },
    client: clientResult.data as ClientInvoicePdfClient,
    invoice,
    lineItems: (lineItemsResult.data ?? []) as ClientInvoicePdfLineItem[],
    engagement,
    engagementBilled,
  });
  const rendered = await renderReportPdf(html, {
    title: `Invoice ${invoice.invoice_number}`,
    generatedAt: invoice.invoice_date ?? null,
    footerLabel: "OpenPlan client invoice",
  });
  return {
    bytes: Buffer.from(rendered.bytes),
    filename: invoiceFilename(invoice.invoice_number),
    invoice,
    engine: rendered.engine,
    pageCount: rendered.pageCount,
  };
}

async function invoiceBytes(
  caller: SupabaseClient,
  project: ProjectScope,
  candidate: ProjectEvidenceCandidate
): Promise<ResolvedProjectEvidenceFile> {
  const rendered = await resolveInvoicePdfBytes(caller, candidate.recordId, project);
  return result(candidate, rendered.bytes, rendered.filename, "application/pdf");
}

async function aerialImageryBytes(
  caller: SupabaseClient,
  service: ServiceClient,
  project: ProjectScope,
  candidate: ProjectEvidenceCandidate
): Promise<ResolvedProjectEvidenceFile> {
  const read = await caller
    .from("aerial_imagery")
    .select("id, workspace_id, mission_id, storage_bucket, storage_path, original_filename, content_type, aerial_missions!inner(project_id, workspace_id)")
    .eq("id", candidate.recordId)
    .eq("workspace_id", project.workspace_id)
    .eq("aerial_missions.project_id", project.id)
    .maybeSingle();
  if (read.error || !read.data) failMissing(candidate);
  const row = read.data as Record<string, unknown>;
  const missionId = typeof row.mission_id === "string" ? row.mission_id : "";
  const storagePath = typeof row.storage_path === "string" ? row.storage_path : "";
  const ref = resolveTenantScopedStorageTarget(storagePath, {
    bucket: AERIAL_IMAGERY_BUCKET,
    objectPathPrefix: `${project.workspace_id}/${missionId}/${candidate.recordId}/`,
  });
  if (!ref || row.storage_bucket !== ref.bucket) failMissing(candidate);
  return result(
    candidate,
    await storedBytes(service, ref.bucket, ref.objectPath, candidate.title),
    sanitizeImageryFilename(typeof row.original_filename === "string" ? row.original_filename : "photo.bin"),
    typeof row.content_type === "string" ? row.content_type : candidate.contentType
  );
}

async function aerialCustodyBytes(
  caller: SupabaseClient,
  service: ServiceClient,
  project: ProjectScope,
  candidate: ProjectEvidenceCandidate
): Promise<ResolvedProjectEvidenceFile> {
  const read = await caller
    .from("aerial_artifact_custody")
    .select("id, workspace_id, mission_id, processing_job_id, state, storage_bucket, storage_path, content_type, aerial_processing_jobs!inner(project_id, workspace_id)")
    .eq("id", candidate.recordId)
    .eq("workspace_id", project.workspace_id)
    .eq("aerial_processing_jobs.project_id", project.id)
    .maybeSingle();
  if (read.error || !read.data || read.data.state !== "held") failMissing(candidate);
  const row = read.data as Record<string, unknown>;
  const missionId = typeof row.mission_id === "string" ? row.mission_id : "";
  const jobId = typeof row.processing_job_id === "string" ? row.processing_job_id : "";
  const storagePath = typeof row.storage_path === "string" ? row.storage_path : "";
  const ref = resolveTenantScopedStorageTarget(storagePath, {
    bucket: AERIAL_ARTIFACT_BUCKET,
    objectPathPrefix: `${project.workspace_id}/${missionId}/${jobId}/`,
  });
  if (!ref || row.storage_bucket !== ref.bucket) failMissing(candidate);
  return result(
    candidate,
    await storedBytes(service, ref.bucket, ref.objectPath, candidate.title),
    storagePath.split("/").pop() || `${candidate.recordId}.bin`,
    typeof row.content_type === "string" ? row.content_type : candidate.contentType
  );
}

async function modelArtifactBytes(
  caller: SupabaseClient,
  service: ServiceClient,
  project: ProjectScope,
  candidate: ProjectEvidenceCandidate
): Promise<ResolvedProjectEvidenceFile> {
  const read = await caller
    .from("model_run_artifacts")
    .select("id, run_id, artifact_type, file_url, model_runs!inner(workspace_id, model_id, models!inner(project_id, workspace_id))")
    .eq("id", candidate.recordId)
    .eq("model_runs.workspace_id", project.workspace_id)
    .eq("model_runs.models.project_id", project.id)
    .maybeSingle();
  if (read.error || !read.data || typeof read.data.file_url !== "string" || !read.data.file_url) {
    failMissing(candidate);
  }
  const fileUrl = read.data.file_url;
  const runId = typeof read.data.run_id === "string" ? read.data.run_id : "";
  const storageRef = fileUrl.startsWith("storage://")
    ? resolveTenantScopedStorageTarget(fileUrl, {
        bucket: "run-artifacts",
        objectPathPrefix: `model-runs/${runId}/`,
      })
    : null;
  if (storageRef) {
    return result(
      candidate,
      await storedBytes(service, storageRef.bucket, storageRef.objectPath, candidate.title),
      storageRef.objectPath.split("/").pop() || `${candidate.recordId}.bin`,
      candidate.contentType
    );
  }
  if (fileUrl.startsWith("http://") || fileUrl.startsWith("https://")) failMissing(candidate);
  const localRoot = workerLocalRoot();
  if (!localRoot) failMissing(candidate);
  const localPath = resolveContainedLocalPath(fileUrl, resolveRunWorkDir(localRoot, runId));
  if (!localPath) failMissing(candidate);
  try {
    return result(candidate, await readFile(localPath), path.basename(localPath), candidate.contentType);
  } catch {
    return failMissing(candidate);
  }
}

/** Re-read and resolve a selected row inside the reviewed project boundary. */
export async function resolveProjectEvidenceCandidateBytes(
  callerValue: unknown,
  serviceValue: unknown,
  project: ProjectScope,
  candidate: ProjectEvidenceCandidate
): Promise<ResolvedProjectEvidenceFile> {
  const caller = callerValue as SupabaseClient;
  const service = serviceValue as ServiceClient;
  switch (candidate.sourceId) {
    case "knowledge_base":
      return knowledgeBaseBytes(caller, service, project, candidate);
    case "report_artifacts":
      return reportBytes(caller, service, project, candidate);
    case "grant_application_exports":
      return grantBytes(caller, service, project, candidate);
    case "invoice_pdfs":
      return invoiceBytes(caller, project, candidate);
    case "aerial_imagery":
      return aerialImageryBytes(caller, service, project, candidate);
    case "aerial_artifact_custody":
      return aerialCustodyBytes(caller, service, project, candidate);
    case "model_run_artifacts":
      return modelArtifactBytes(caller, service, project, candidate);
    case "project_geopackage":
      throw new ProjectEvidenceBundleError("missing_evidence", "The project GeoPackage is generated with the bundle.");
  }
}
