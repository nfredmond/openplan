import { JurisdictionReadinessPanel } from "@/components/jurisdiction-readiness/jurisdiction-readiness-panel";
import { jurisdictionReadinessRegistrySha256 } from "@/lib/jurisdiction-readiness/custody";
import { buildProjectJurisdictionReadinessPayload } from "@/lib/jurisdiction-readiness/payload";
import type { ProjectJurisdictionRow } from "@/lib/projects/project-jurisdiction";

/** The page, download and new artifacts use the same project-context reader. */
export function ProjectJurisdictionReadiness({ project }: { project: ProjectJurisdictionRow & { id: string } }) {
  let payload;
  try { payload = buildProjectJurisdictionReadinessPayload(project, jurisdictionReadinessRegistrySha256()); }
  catch { return <p role="alert">Saved jurisdiction is invalid or could not be read. Jurisdiction assessment is unavailable.</p>; }
  // Planner wording for a project with no declaration. The payload's own
  // disclosure stays as is: it is part of the hashed export that reports keep.
  const undeclared = payload.contextSource === "legacy_study_place";
  return <section className="space-y-4">
    <p>{undeclared ? "Jurisdiction not declared. This assessment uses the project's study place. It does not settle adopting authority or legal applicability." : payload.disclosure}</p>
    {payload.entries.length === 0 && <p>Jurisdiction explicitly unresolved. No study-place fallback applies.</p>}
    {payload.entries.map((entry, index) => <section key={index}>
      <h3>{entry.declaration?.label ?? (project.place_label?.trim() || "Study place not set")}</h3>
      {undeclared ? null : <p>{entry.assessmentScope}</p>}
      <JurisdictionReadinessPanel reports={entry.assessment.reports} compact />
      {entry.administrativeGuidance && <details><summary>Separate administrative state-level guidance, identity unverified</summary><JurisdictionReadinessPanel reports={entry.administrativeGuidance.reports} compact /></details>}
    </section>)}
    <a href={`/api/projects/${project.id}/jurisdiction-readiness?download=1`}>Download project jurisdiction assessment JSON</a>
  </section>;
}
