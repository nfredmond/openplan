"use client";

import { useState } from "react";
import Link from "next/link";

import { AerialMissionCreator } from "@/components/aerial/aerial-mission-creator";

export type AerialMissionLauncherProject = {
  id: string;
  name: string;
};

/**
 * The register's front door for starting a mission.
 *
 * THE DEFECT THIS CLOSES. Missions could only be created from a project detail
 * page, because `AerialMissionCreator` — correctly — requires a `projectId`:
 * the mission-project link is load-bearing (posture, evidence chains, the RTP
 * roll-up all hang off it). But `/aerial` is where a planner who thinks in
 * missions actually stands, and it offered no way to start one. The fix is not
 * to relax the link; it is to put a project picker in front of the same
 * creator, so the link is chosen instead of skipped.
 *
 * The creator is keyed on the chosen project so switching projects resets the
 * form — a half-typed mission for one project must not silently submit against
 * another.
 */
export function AerialMissionLauncher({
  projects,
  projectsUnreadable,
  projectListTruncatedAt = null,
  initialProjectId = null,
}: {
  projects: AerialMissionLauncherProject[];
  /**
   * True when the project list read failed. The picker is withheld rather than
   * rendered empty: a zero-option picker over a failed read would tell the
   * planner this workspace has no projects, which the page does not know.
   */
  projectsUnreadable: boolean;
  /**
   * Set when the list hit the page's cap, so the assumption ("your project is
   * probably among the most recent N") is on screen instead of silent.
   */
  projectListTruncatedAt?: number | null;
  /** Preselects the project this register was opened for, when there is one. */
  initialProjectId?: string | null;
}) {
  const validInitialProjectId =
    initialProjectId && projects.some((project) => project.id === initialProjectId)
      ? initialProjectId
      : "";
  const [projectId, setProjectId] = useState(validInitialProjectId);
  // From the same list the picker renders, so the name shown can never disagree
  // with the option that was chosen.
  const projectName = projects.find((project) => project.id === projectId)?.name ?? null;

  if (projectsUnreadable) {
    return (
      <div className="module-alert text-sm">
        The project list could not be read, so a mission cannot be started from this page right now.
        The failure is named at the top of this page. Missions can still be logged from a project&apos;s
        own page once projects load again.
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="module-empty-state text-sm">
        Every aerial mission belongs to a project — that link is what carries its imagery into the
        project&apos;s evidence chain. This workspace has no projects yet, so there is nothing to fly
        for.{" "}
        <Link href="/projects" className="underline underline-offset-2 hover:text-foreground">
          Create a project first
        </Link>
        , then come back to log the mission.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="max-w-md space-y-1.5">
        <label
          htmlFor="aerial-mission-launcher-project"
          className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
        >
          Project this mission is for
        </label>
        <select
          id="aerial-mission-launcher-project"
          className="module-select"
          value={projectId}
          onChange={(event) => setProjectId(event.target.value)}
        >
          <option value="">Choose a project…</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
        {projectListTruncatedAt ? (
          <p className="text-[0.72rem] text-muted-foreground">
            Only the {projectListTruncatedAt} most recently created projects are listed here. A
            project older than these can still get a mission from its own page.
          </p>
        ) : null}
      </div>

      {projectId ? (
        <AerialMissionCreator
          key={projectId}
          projectId={projectId}
          // THE PROJECT IS NAMED, NOT POINTED AT. This used to read "the
          // project chosen above", which was true while the form sat under the
          // picker. The form is a flow now and covers the picker while it is
          // open, so "above" would refer to something the planner cannot see —
          // and the whole reason this launcher exists is that the mission's
          // project link is chosen rather than skipped.
          titleLabel={`Log a mission for ${projectName ?? "the chosen project"}`}
          description={
            projectName
              ? `This mission will be linked to ${projectName}, and its evidence packages will feed that project's evidence chain.`
              : "This mission will be linked to the project chosen above, and its evidence packages will feed that project's evidence chain."
          }
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          Pick a project to open the mission form.
        </p>
      )}
    </div>
  );
}
