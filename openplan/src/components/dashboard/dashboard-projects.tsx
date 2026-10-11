import Link from "next/link";

import { COMING_UP_KIND_LABELS, type ComingUpItem } from "@/lib/dashboard/coming-up";
import {
  PROJECT_DELIVERY_PHASE_LABELS,
  PROJECT_STATUS_LABELS,
  type ProjectDeliveryPhase,
  type ProjectStatus,
} from "@/lib/projects/project-record-fields";

export type DashboardProjectRow = {
  id: string;
  name: string;
  status: string | null;
  delivery_phase: string | null;
};

function shortDate(dueOn: string) {
  const [year, month, day] = dueOn.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function stageLabel(row: DashboardProjectRow) {
  if (row.status && row.status !== "active") {
    return PROJECT_STATUS_LABELS[row.status as ProjectStatus] ?? row.status;
  }
  return row.delivery_phase
    ? PROJECT_DELIVERY_PHASE_LABELS[row.delivery_phase as ProjectDeliveryPhase] ?? row.delivery_phase
    : "Active";
}

/**
 * Projects, led by the next date on each. The index page lists every field;
 * this answers "which project needs me next."
 */
export function DashboardProjects({
  projects,
  nextDates,
  datesKnown,
  unreadable,
}: {
  projects: readonly DashboardProjectRow[];
  /** The soonest upcoming item per project id, from Coming up. */
  nextDates: ReadonlyMap<string, ComingUpItem>;
  /** False when a dated source could not be read, so "nothing dated" would be a guess. */
  datesKnown: boolean;
  unreadable: boolean;
}) {
  return (
    <section className="dashboard-panel" aria-labelledby="dashboard-projects">
      <header className="dashboard-panel-header">
        <h2 id="dashboard-projects" className="dashboard-panel-title">
          Projects
        </h2>
        <Link href="/projects" className="dashboard-panel-aside dashboard-link">
          All projects
        </Link>
      </header>

      {unreadable ? (
        <p className="dashboard-read-failed" role="status">
          Projects could not be read. Open the Projects page to try again.
        </p>
      ) : projects.length === 0 ? (
        <p className="dashboard-empty">No projects yet.</p>
      ) : (
        <table className="dashboard-table">
          <thead>
            <tr>
              <th scope="col">Next date</th>
              <th scope="col">Project</th>
              <th scope="col">Stage</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((project) => {
              const next = nextDates.get(project.id);
              return (
                <tr key={project.id}>
                  <td className="dashboard-table-date">
                    {next ? (
                      <>
                        <span className="font-semibold text-foreground">{shortDate(next.dueOn)}</span>
                        <span className="block text-muted-foreground">{COMING_UP_KIND_LABELS[next.kind]}</span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">{datesKnown ? "Nothing dated" : "Not available"}</span>
                    )}
                  </td>
                  <td>
                    <Link href={`/projects/${project.id}`} className="dashboard-table-link">
                      {project.name}
                    </Link>
                  </td>
                  <td className="text-muted-foreground">{stageLabel(project)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
