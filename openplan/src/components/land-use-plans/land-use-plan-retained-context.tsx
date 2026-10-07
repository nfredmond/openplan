import type { SavedPlanContext } from "@/lib/land-use-plans/plan-context";

type Props = { value: { status: "retained"; context: SavedPlanContext } | { status: "legacy" } };

/** Present the reviewed assessment separately from current plan context and retry controls. */
export function LandUsePlanRetainedContext({ value }: Props) {
  const title = value.status === "legacy" ? "Context not retained with this version" : "Context retained with this version";
  return <section aria-label={title} className="min-w-0 space-y-4 rounded-xl border border-border bg-card p-5">
    <div><h2 className="text-lg font-semibold">{title}</h2>
      {value.status === "retained" ? <p className="mt-1 text-sm text-muted-foreground">These are the saved area and staff assessment reviewed with this version. They do not establish legal sufficiency.</p> : null}</div>
    {value.status === "legacy" ? <p className="text-sm">This version did not retain its plan context. Current plan context cannot establish what reviewers saw.</p> : <>
      <div><h3 className="font-medium">Plan area</h3><p className="break-words text-sm">{value.context.place.label}</p>
        <p className="text-sm text-muted-foreground">Area source: {value.context.place.source}. Study geometry and legal authority are different facts.</p></div>
      <div className="space-y-3"><h3 className="font-medium">Responsible bodies</h3>
        {value.context.assessment.authorities.map(authority => <article key={authority.id} className="min-w-0 border-l-2 border-border pl-3 text-sm">
          <p className="break-words font-medium">{authority.label}</p><p className="break-words">{authority.role} · {authority.kind}</p>
          <p>{authority.jurisdiction ? [authority.jurisdiction.country, authority.jurisdiction.subdivision].filter(Boolean).join(" / ") : "Jurisdiction was not assessed."}</p>
          {authority.sourceUrls.length ? <ul className="mt-1 space-y-1">{authority.sourceUrls.map((url, index) => <li key={`${index}:${url}`}><a href={url} className="break-all underline">{url}</a></li>)}</ul> : <p className="text-muted-foreground">No authority source was retained.</p>}
        </article>)}</div>
      <div className="space-y-2 text-sm"><h3 className="font-medium">Applicability assessment</h3>
        <p>{value.context.assessment.applicability.status === "staff_assessed" ? "Staff assessed applicability." : "Applicability remains unresolved."}</p>
        <p className="whitespace-pre-wrap break-words">{value.context.assessment.applicability.explanation}</p>
        {value.context.assessment.applicability.status === "staff_assessed" ? <>
          <p>Assessed bodies: {value.context.assessment.authorities.filter(authority => value.context.assessment.applicability.status === "staff_assessed" && value.context.assessment.applicability.authorityIds.includes(authority.id)).map(authority => authority.label).join(", ")}</p>
          <ul className="space-y-1">{value.context.assessment.applicability.sourceUrls.map((url, index) => <li key={`${index}:${url}`}><a href={url} className="break-all underline">{url}</a></li>)}</ul>
        </> : null}</div>
    </>}
  </section>;
}
