export type GenerateReportArtifactResult = {
  warningCount: number;
};

export type ReportActionClientOptions = {
  headers?: Record<string, string>;
};

export async function generateReportArtifact(
  reportId: string,
  options: ReportActionClientOptions = {}
): Promise<GenerateReportArtifactResult> {
  const response = await fetch(`/api/reports/${reportId}/generate`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(options.headers ?? {}) },
    body: JSON.stringify({ format: "html" }),
  });

  const payload = (await response.json().catch(() => null)) as
    | {
        error?: string;
        warnings?: Array<unknown>;
      }
    | null;

  if (!response.ok) {
    throw new Error(payload?.error || "Failed to generate report artifact");
  }

  return {
    warningCount: payload?.warnings?.length ?? 0,
  };
}

export type CreateRtpPacketRecordOptions = {
  rtpCycleId: string;
  title?: string;
  modelingCountyRunId?: string | null;
  generateAfterCreate?: boolean;
  headers?: Record<string, string>;
};

export type CreateRtpPacketRecordResult = {
  reportId: string;
  warningCount: number;
};

export async function createRtpPacketRecord({
  rtpCycleId,
  title,
  modelingCountyRunId,
  generateAfterCreate = false,
  headers,
}: CreateRtpPacketRecordOptions): Promise<CreateRtpPacketRecordResult> {
  const createResponse = await fetch("/api/reports", {
    method: "POST",
    headers: { "content-type": "application/json", ...(headers ?? {}) },
    body: JSON.stringify({
      rtpCycleId,
      reportType: "board_packet",
      ...(title ? { title } : {}),
      ...(modelingCountyRunId ? { modelingCountyRunId } : {}),
    }),
  });

  const createPayload = (await createResponse.json().catch(() => null)) as
    | {
        error?: string;
        reportId?: string;
        report?: { id?: string | null } | null;
      }
    | null;

  const reportId = createPayload?.reportId ?? createPayload?.report?.id ?? null;

  if (!createResponse.ok || !reportId) {
    throw new Error(createPayload?.error || "Failed to create RTP packet record");
  }

  if (!generateAfterCreate) {
    return {
      reportId,
      warningCount: 0,
    };
  }

  const generation = await generateReportArtifact(reportId, { headers });

  return {
    reportId,
    warningCount: generation.warningCount,
  };
}
