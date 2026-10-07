import { buildIdentity } from "@/lib/runtime/app-version";
import { NextRequest, NextResponse } from "next/server";
import { authorizeBcaProject } from "@/lib/bca/workbench/access";
import { bcaDocumentSchema } from "@/lib/bca/workbench/schema";
import { readJsonOrNullWithLimit } from "@/lib/http/body-limit";
import { bcaHtml, exportBcaPackage } from "@/lib/bca/workbench/export";
import { renderReportPdf } from "@/lib/reports/pdf";
import { createApiAuditLogger } from "@/lib/observability/audit";
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) {
  const audit = createApiAuditLogger("projects.bca-analyses.export", request);
  const { projectId } = await context.params,
    access = await authorizeBcaProject(projectId, false);
  if (access.error) return access.error;
  const body = await readJsonOrNullWithLimit(request, 1000000);
  if (!body.ok) return body.response;
  const parsed = bcaDocumentSchema.safeParse(body.data);
  if (!parsed.success || parsed.data.projectId !== projectId)
    return NextResponse.json(
      { error: "Invalid analysis or project identity" },
      { status: 400 },
    );
  try {
    const pdf = await renderReportPdf(bcaHtml(parsed.data), {
      title: parsed.data.title,
      generatedAt: null,
      format: "Letter",
      footerLabel: "OpenPlan BCA | Analyst review required",
    });
    const bytes = await exportBcaPackage(parsed.data, {
      "build-identity.json": JSON.stringify(buildIdentity(), null, 2),
      "report.pdf": pdf.bytes,
      "pdf-rendering.txt": `Renderer: ${pdf.engine}\n${pdf.disclosure ?? "Styled HTML rendering."}\nAccessibility conformance and program acceptance have not been established. TCEP requires remediated accessible PDFs.\n`,
    });
    audit.info("package_created", { projectId, bytes: bytes.byteLength, renderer: pdf.engine });
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "content-type": "application/zip",
        "content-disposition": 'attachment; filename="openplan-bca.zip"',
        "cache-control": "private, no-store",
      },
    });
  } catch {
    audit.error("package_failed", { projectId });
    return NextResponse.json(
      {
        error:
          "Could not create the calculation package. Your inputs remain available for JSON download.",
      },
      { status: 500 },
    );
  }
}
