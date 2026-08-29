import { JurisdictionReadinessPanel } from "@/components/jurisdiction-readiness/jurisdiction-readiness-panel";
import { jurisdictionReadinessRegistrySha256 } from "@/lib/jurisdiction-readiness/custody";
import { buildJurisdictionReadinessPayload } from "@/lib/jurisdiction-readiness/payload";
import { placeOfRecordFromProject, type ProjectPlaceRow } from "@/lib/projects/project-place";

/** Keep the project page's readiness display and exact download on one payload. */
export function ProjectJurisdictionReadiness({
  project,
}: {
  project: Pick<ProjectPlaceRow, "place_label" | "place_country_code" | "place_subdivision_code"> & { id: string };
}) {
  const place = placeOfRecordFromProject(project);
  const payload = buildJurisdictionReadinessPayload(
    { countryCode: place.countryCode, subdivisionCode: place.subdivisionCode, label: place.label },
    jurisdictionReadinessRegistrySha256(),
  );
  return (
    <JurisdictionReadinessPanel
      reports={payload.reports}
      downloadHref={`/api/projects/${project.id}/jurisdiction-readiness?download=1`}
      compact
    />
  );
}
