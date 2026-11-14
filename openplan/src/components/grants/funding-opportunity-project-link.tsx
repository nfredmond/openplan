"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { projectLinkAnchorId } from "@/lib/grants/opportunity-project-link";

type ProjectOption = { id: string; name: string };

type Props = {
  opportunityId: string;
  workspaceId: string;
  currentProject: ProjectOption | null;
  projectOptions: ProjectOption[];
};

/**
 * Links, relinks or unlinks the opportunity's project through the opportunity
 * PATCH route. The route checks the workspace and refuses a change once
 * records were built from the current project; this shows its answer as given.
 * Mounted only for callers who may write grants.
 */
export function FundingOpportunityProjectLink({ opportunityId, workspaceId, currentProject, projectOptions }: Props) {
  const anchorId = projectLinkAnchorId(opportunityId);
  const form = (
    <ProjectLinkForm
      key={currentProject?.id ?? "none"}
      opportunityId={opportunityId}
      workspaceId={workspaceId}
      currentProject={currentProject}
      projectOptions={projectOptions}
    />
  );
  return (
    <div id={anchorId} className="mt-4 scroll-mt-24 text-sm">
      {currentProject ? (
        <details>
          <summary className="cursor-pointer font-semibold text-foreground">Change project</summary>
          {form}
        </details>
      ) : (
        form
      )}
    </div>
  );
}

function ProjectLinkForm({ opportunityId, workspaceId, currentProject, projectOptions }: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState(currentProject?.id ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const selectId = `${projectLinkAnchorId(opportunityId)}-select`;
  const changed = selected !== (currentProject?.id ?? "");
  // A linked project missing from the options still shows as the current choice.
  const options =
    currentProject && !projectOptions.some((project) => project.id === currentProject.id)
      ? [currentProject, ...projectOptions]
      : projectOptions;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!changed || saving) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const response = await fetch(`/api/funding-opportunities/${encodeURIComponent(opportunityId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: selected || null }),
      });
      const body = (await response.json().catch(() => null)) as {
        error?: unknown;
        details?: unknown;
        opportunity?: { id?: unknown; workspace_id?: unknown; project_id?: unknown };
      } | null;
      if (!response.ok) {
        const parts = [body?.error, body?.details].filter((part): part is string => typeof part === "string");
        throw new Error(parts.length > 0 ? parts.join(". ") : "The project link was not saved.");
      }
      const row = body?.opportunity;
      if (row?.id !== opportunityId || row.workspace_id !== workspaceId || (row.project_id ?? "") !== selected) {
        throw new Error("The saved project could not be confirmed. Reload the page.");
      }
      setSaved(true);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The project link was not saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="mt-2 flex flex-wrap items-end gap-2" onSubmit={(event) => void save(event)}>
      <div className="min-w-0 flex-1 basis-56 space-y-1.5">
        <label htmlFor={selectId} className="font-semibold text-foreground">
          Project
        </label>
        <select
          id={selectId}
          className="w-full rounded-md border border-input bg-background p-2 font-normal"
          value={selected}
          disabled={saving}
          onChange={(event) => {
            setSelected(event.target.value);
            setError(null);
            setSaved(false);
          }}
        >
          <option value="">Not linked</option>
          {options.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" disabled={!changed || saving}>
        {saving ? "Saving…" : "Save project"}
      </Button>
      {error ? (
        <p role="alert" className="w-full break-words text-destructive">
          {error}
        </p>
      ) : null}
      {saved ? (
        <p role="status" className="w-full text-emerald-700 dark:text-emerald-300">
          Project saved.
        </p>
      ) : null}
    </form>
  );
}
