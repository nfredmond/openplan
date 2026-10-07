import { loadReportAdoption } from "@/lib/land-use-plans/report-adoption";

type Props = Parameters<typeof loadReportAdoption>[0];

/** Read the decision retained by this report, including editions later superseded. */
export async function LandUsePlanReportAdoption({ supabase, metadata, planId, versionId, contentHash }: Props) {
  const heading = <h2 id="report-adoption-heading" className="text-2xl font-semibold">Saved adoption decision</h2>;
  const retained = await loadReportAdoption({ supabase, metadata, planId, versionId, contentHash });
  if (retained.status === "absent") {
    return <section aria-labelledby="report-adoption-heading" className="mt-8 rounded-lg border p-5">{heading}<p className="mt-3">This report did not retain the adoption details. OpenPlan has not substituted a later decision. This does not establish whether an agency adopted the plan.</p></section>;
  }

  if (retained.status === "invalid") {
    return <section aria-labelledby="report-adoption-heading" className="mt-8 rounded-lg border p-5">{heading}<p role="alert" className="mt-3">The adoption details could not be verified against the version retained in this report. OpenPlan withheld the decision details. The plan content below passed its separate version check.</p></section>;
  }
  const decision = retained.decision;
  return <section aria-labelledby="report-adoption-heading" className="mt-8 rounded-lg border p-5">
    {heading}
    <p className="mt-3 text-sm text-muted-foreground">This is the decision retained when this report was published. Later decisions do not replace it here. These details do not establish legal validity.</p>
    <dl className="mt-4 grid gap-4 sm:grid-cols-2">
      <div><dt className="text-sm text-muted-foreground">Decision body</dt><dd className="mt-1 whitespace-pre-wrap">{decision.body}</dd></div>
      <div><dt className="text-sm text-muted-foreground">Decision type</dt><dd className="mt-1 capitalize">{decision.kind}</dd></div>
      <div><dt className="text-sm text-muted-foreground">Instrument</dt><dd className="mt-1">{decision.instrumentType} {decision.instrumentIdentifier}</dd></div>
      <div><dt className="text-sm text-muted-foreground">Decision date</dt><dd className="mt-1">{decision.decidedOn}</dd></div>
      <div><dt className="text-sm text-muted-foreground">Effective date</dt><dd className="mt-1">{decision.effectiveOn ?? "Not recorded"}</dd></div>
      <div><dt className="text-sm text-muted-foreground">Vote</dt><dd className="mt-1 whitespace-pre-wrap">{decision.vote || "Not recorded"}</dd></div>
    </dl>
  </section>;
}
