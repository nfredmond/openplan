import {
  freezeDualDemandAgreementSnapshot,
  type DualDemandAgreementSnapshotV1,
  type DualDemandAgreementVerificationState,
  type VerifiedDualDemandAgreement,
} from "@/lib/models/verified-dual-demand-agreement";
import {
  loadRegisteredDualDemandAgreement,
  type RegisteredDualDemandAgreementState,
} from "@/lib/models/verified-dual-demand-agreement-server";

export const REPORT_AGREEMENT_SELECTIONS_VERSION = 1 as const;

export type AgreementCorridorSelection = {
  modelRunId: string;
  corridor: string;
};

export type ReportAgreementEvidence = {
  modelRunId: string;
  state:
    | { status: "absent" | "unreadable" | "invalid"; reason: string }
    | { status: "verified"; agreement: VerifiedDualDemandAgreement };
};

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function readAgreementCorridorSelections(
  metadata: unknown,
): AgreementCorridorSelection[] {
  const root = record(metadata);
  const rows = root?.agreementCorridorSelections;
  if (!Array.isArray(rows)) return [];
  const selections: AgreementCorridorSelection[] = [];
  const seen = new Set<string>();
  for (const value of rows) {
    const row = record(value);
    if (
      !row ||
      typeof row.modelRunId !== "string" ||
      typeof row.corridor !== "string" ||
      !row.corridor.trim()
    ) {
      continue;
    }
    const key = `${row.modelRunId}\u0000${row.corridor.trim()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    selections.push({ modelRunId: row.modelRunId, corridor: row.corridor.trim() });
  }
  return selections;
}

export function writeAgreementCorridorSelections(
  metadata: unknown,
  selections: readonly AgreementCorridorSelection[],
): Record<string, unknown> {
  return {
    ...(record(metadata) ?? {}),
    agreementCorridorSelectionsVersion: REPORT_AGREEMENT_SELECTIONS_VERSION,
    agreementCorridorSelections: selections.map((selection) => ({ ...selection })),
  };
}

export function retainCitedAgreementCorridorSelections(
  selections: readonly AgreementCorridorSelection[],
  citedModelRunIds: readonly string[],
): AgreementCorridorSelection[] {
  const cited = new Set(citedModelRunIds);
  return selections.filter((selection) => cited.has(selection.modelRunId));
}

export async function loadReportDualDemandAgreements(input: {
  supabase: unknown;
  modelRunIds: readonly string[];
  workspaceId: string;
  projectId: string;
}): Promise<Map<string, RegisteredDualDemandAgreementState>> {
  const uniqueIds = [...new Set(input.modelRunIds)];
  const states = await Promise.all(
    uniqueIds.map((modelRunId) =>
      loadRegisteredDualDemandAgreement(input.supabase, {
        modelRunId,
        artifactType: "demand_model_agreement",
        expectedWorkspaceId: input.workspaceId,
        expectedProjectId: input.projectId,
      }),
    ),
  );
  return new Map(uniqueIds.map((runId, index) => [runId, states[index]]));
}

export async function loadReportDualDemandAgreementPanel(input: {
  supabase: unknown;
  modelRunIds: readonly string[];
  workspaceId: string;
  projectId: string;
  reportMetadata: unknown;
}): Promise<{ evidence: ReportAgreementEvidence[]; selections: AgreementCorridorSelection[] }> {
  const states = await loadReportDualDemandAgreements(input);
  return {
    evidence: input.modelRunIds.map((modelRunId) => {
      const state = states.get(modelRunId);
      if (!state) return { modelRunId, state: { status: "absent", reason: "This cited run has no dual-model agreement artifact." } };
      return { modelRunId, state: state.status === "verified" ? { status: "verified", agreement: state.agreement } : state };
    }),
    selections: readAgreementCorridorSelections(input.reportMetadata),
  };
}

export function validateAgreementCorridorSelections(input: {
  selections: readonly AgreementCorridorSelection[];
  citedModelRunIds: readonly string[];
  agreementStates: ReadonlyMap<string, DualDemandAgreementVerificationState>;
}): { ok: true } | { ok: false; reason: string } {
  const cited = new Set(input.citedModelRunIds);
  for (const selection of input.selections) {
    if (!cited.has(selection.modelRunId)) {
      return { ok: false, reason: "A selected agreement corridor belongs to a model run this report does not cite." };
    }
    const state = input.agreementStates.get(selection.modelRunId);
    if (!state || state.status !== "verified") {
      return {
        ok: false,
        reason: `The selected corridor's agreement artifact is ${state?.status ?? "absent"}.`,
      };
    }
    if (!state.agreement.namedCorridors.some((row) => row.corridor === selection.corridor)) {
      return {
        ok: false,
        reason: `The corridor "${selection.corridor}" is absent from the verified agreement artifact.`,
      };
    }
  }
  return { ok: true };
}

export function freezeReportDualDemandAgreements(input: {
  agreements: readonly VerifiedDualDemandAgreement[];
  selections: readonly AgreementCorridorSelection[];
}): DualDemandAgreementSnapshotV1[] {
  const selectedByRun = new Map<string, string[]>();
  for (const selection of input.selections) {
    selectedByRun.set(selection.modelRunId, [
      ...(selectedByRun.get(selection.modelRunId) ?? []),
      selection.corridor,
    ]);
  }
  return input.agreements.map((agreement) =>
    freezeDualDemandAgreementSnapshot(
      agreement,
      selectedByRun.get(agreement.modelRunId) ?? [],
    ),
  );
}
