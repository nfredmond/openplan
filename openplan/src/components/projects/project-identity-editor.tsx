"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, Loader2, MapPin, Pencil, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { StateBlock } from "@/components/ui/state-block";
import { StatusBadge } from "@/components/ui/status-badge";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  PROJECT_DELIVERY_PHASES,
  PROJECT_DELIVERY_PHASE_LABELS,
  PROJECT_STATUSES,
  PROJECT_STATUS_LABELS,
  type ProjectDeliveryPhase,
  type ProjectStatus,
} from "@/lib/projects/project-record-fields";
import { StudyAreaPicker } from "@/components/models/study-area-picker";
import { CorridorUpload } from "@/components/corridor/CorridorUpload";
import { parseCorridorText } from "@/lib/models/study-area";
import { CensusTractCoverageControl } from "@/components/geographies/census-tract-coverage-control";
import {
  DRAWN_PLACE_SOURCE,
  UPLOADED_PLACE_SOURCE,
  type PlaceOfRecord,
} from "@/lib/geographies/place-of-record";
import type { PlaceBoundaryResponse } from "@/lib/api/place-geographies";

/**
 * Edit the project's own record, or delete it.
 *
 * Until now a project's name, summary, status, plan type and delivery phase were
 * write-once: set at creation and unchangeable forever, because `projects` had
 * no detail route. A typo in a project name outlived the project.
 *
 * HOW THE DELETE CONTROL ASKS (revised — the earlier note here said it asked
 * nothing at all). The original reasoning was half right: a browser `confirm()`
 * that says "are you sure?" is worse than useless, because the server already
 * counts every table that references the project and refuses with the list. The
 * half that was wrong is what it concluded. Pressing Delete on an EMPTY project
 * deleted it outright, with no question anywhere — the irreversible case was the
 * one case that got no confirmation — and a planner could only discover that a
 * project was NOT deletable by attempting the delete and reading the refusal.
 *
 * So the order is now: ask the server what deleting would cost
 * (`GET /api/projects/[id]/delete-preflight`, sharing its counting code with the
 * DELETE route so the two cannot disagree), then either render the refusal with
 * its named, linked blockers — unchanged, verbatim from the server — or open the
 * shared confirm dialog, which names the project, states what goes with it, and
 * offers the reversible alternative the refusal has always pointed at: mark it
 * complete instead.
 */

type ProjectRecord = {
  id: string;
  name: string;
  summary: string | null;
  status: string;
  planType: string;
  deliveryPhase: string;
  /**
   * The study area as the shared place-of-record shape, WITHOUT its boundary.
   *
   * `{label, isDrawn}` could not answer "WHICH county is this", which is what
   * every downstream derivation needs — and it made this component re-decide
   * "drawn" from a comparison the shared module already owns. The polygon is
   * excluded because a TIGERweb county boundary is megabytes and this crosses an
   * RSC boundary; `placeIdentityOnly` names that omission at the call site.
   */
  place: PlaceOfRecord;
};

type DeleteBlocker = {
  table: string;
  label: string;
  count: number;
  severity: "blocking" | "evidence";
  behavior: "cascade" | "orphan";
  reason: string;
  href: string;
};

type DeleteRefusal = {
  headline: string;
  alternative: string;
  blockers: DeleteBlocker[];
};

/**
 * What `GET /api/projects/[id]/delete-preflight` answers. Same shape as the
 * refusal plus the verdict, because the two are produced by one function on the
 * server and drifting them apart here would be how they drift apart at all.
 */
type DeletePreflight = DeleteRefusal & { deletable: boolean };

const PLAN_TYPE_SUGGESTIONS = [
  "corridor_plan",
  "active_transportation_plan",
  "safety_plan",
  "regional_plan",
];

export function ProjectIdentityEditor({
  project,
  canWrite,
  workspaceHomeLabel = null,
}: {
  project: ProjectRecord;
  canWrite: boolean;
  /** Named so the empty state can state the real fallback rather than invent one. */
  workspaceHomeLabel?: string | null;
}) {
  const router = useRouter();
  const { confirm, confirmDialog } = useConfirmDialog();
  // "Drawn" is decided by the shared constant rather than re-derived here.
  const placeIsDrawn = project.place.source === DRAWN_PLACE_SOURCE;
  const placeIsUploaded = project.place.source === UPLOADED_PLACE_SOURCE;
  const placeIsUnresolvedShape = placeIsDrawn || placeIsUploaded;
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(project.name);
  const [summary, setSummary] = useState(project.summary ?? "");
  const [status, setStatus] = useState(project.status);
  const [planType, setPlanType] = useState(project.planType);
  const [deliveryPhase, setDeliveryPhase] = useState(project.deliveryPhase);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<DeleteRefusal | null>(null);
  const [editingPlace, setEditingPlace] = useState(false);
  const [placeText, setPlaceText] = useState("");
  const [pickedPlace, setPickedPlace] = useState<PlaceBoundaryResponse | null>(null);
  /**
   * A boundary read out of a file the planner already had.
   *
   * A tester arrived with study-area.geojson in their handover folder, watched
   * Data Hub parse it correctly, and then had to REDRAW it by hand here because
   * this control offered only click-to-draw or typed coordinates. The reader
   * that understands GeoJSON, KML, KMZ and shapefiles already existed — it was
   * mounted by one caller (Explore) and unreachable from the other. This is the
   * shared-capability-inside-one-of-its-callers shape the repo has a rule about,
   * so this mounts the same component rather than growing a second reader.
   */
  const [uploadedBoundary, setUploadedBoundary] = useState<unknown>(null);
  const [savingPlace, setSavingPlace] = useState(false);

  function resetToRecord() {
    setName(project.name);
    setSummary(project.summary ?? "");
    setStatus(project.status);
    setPlanType(project.planType);
    setDeliveryPhase(project.deliveryPhase);
    setError(null);
    setEditing(false);
  }

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSaving(true);

    try {
      const response = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          summary: summary.trim() ? summary : null,
          status,
          planType,
          deliveryPhase,
        }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Could not save this project.");
        return;
      }

      setEditing(false);
      router.refresh();
    } catch {
      setError("Could not reach the server to save this project.");
    } finally {
      setSaving(false);
    }
  }

  /** Send the place as a REFERENCE when one was searched; the server re-resolves it. */
  async function savePlace(place: unknown) {
    setError(null);
    setSavingPlace(true);
    try {
      const response = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ place }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
        setError(body.message ?? body.error ?? "Could not save this study area.");
        return;
      }

      setEditingPlace(false);
      setPlaceText("");
      setPickedPlace(null);
      setUploadedBoundary(null);
      router.refresh();
    } catch {
      setError("Could not reach the server to save this study area.");
    } finally {
      setSavingPlace(false);
    }
  }

  async function handleSavePlace() {
    if (pickedPlace) {
      await savePlace({ mode: "place", kind: pickedPlace.kind, geoid: pickedPlace.geoid });
      return;
    }

    // A boundary from a file has no resolvable place identity, but its capture
    // path is still evidence. Preserve "uploaded" rather than calling it drawn.
    const geometry = uploadedBoundary ?? parseCorridorText(placeText);
    if (!geometry) {
      setError("Search for a place, upload a boundary file, or draw an area before saving.");
      return;
    }
    await savePlace({ mode: uploadedBoundary ? "uploaded" : "drawn", geometry });
  }

  async function handleClearPlace() {
    await savePlace(null);
  }

  /** The reversible alternative the refusal copy has always named. Offered inside the dialog. */
  async function retireProject() {
    setError(null);
    setDeleting(true);
    try {
      const response = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "complete" }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
        setError(body.message ?? body.error ?? "Could not retire this project.");
        return;
      }
      setStatus("complete");
      router.refresh();
    } catch {
      setError("Could not reach the server to retire this project.");
    } finally {
      setDeleting(false);
    }
  }

  async function handleDelete() {
    setError(null);
    setRefusal(null);
    setDeleting(true);

    let preflight: DeletePreflight;
    try {
      const response = await fetch(`/api/projects/${project.id}/delete-preflight`);
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
        setError(body.message ?? body.error ?? "Could not check what is attached to this project.");
        return;
      }
      preflight = (await response.json()) as DeletePreflight;
    } catch {
      setError("Could not reach the server to check what is attached to this project.");
      return;
    } finally {
      setDeleting(false);
    }

    // Not deletable: show the server's own refusal, named blockers and all.
    // Nothing was destroyed to find this out.
    if (!preflight.deletable) {
      setRefusal({
        headline: preflight.headline,
        alternative: preflight.alternative,
        blockers: preflight.blockers,
      });
      return;
    }

    const confirmed = await confirm({
      headline: `Delete “${project.name}”?`,
      consequence: `${preflight.headline} This cannot be undone.`,
      confirmLabel: "Delete this project",
      alternative: {
        label: "Mark it complete instead",
        description:
          "Retiring a project keeps its record and everything that ever hangs off it, and can be undone by changing the status back.",
        onSelect: retireProject,
      },
    });
    if (!confirmed) return;

    setDeleting(true);
    try {
      const response = await fetch(`/api/projects/${project.id}`, { method: "DELETE" });

      if (response.status === 409) {
        // The pre-flight is advisory: something can be attached between the
        // check and the delete. The route is what refuses, and its refusal is
        // what the planner reads.
        setRefusal((await response.json()) as DeleteRefusal);
        return;
      }

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
        setError(body.message ?? body.error ?? "Could not delete this project.");
        return;
      }

      router.push("/projects");
      router.refresh();
    } catch {
      setError("Could not delete this project.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <article id="project-identity" className="module-section-surface scroll-mt-24">
      <div className="module-section-header">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-[color:var(--pine)]/10 text-[color:var(--pine)]">
            <Pencil className="h-5 w-5" />
          </span>
          <div className="module-section-heading">
            <p className="module-section-label">Project record</p>
            <h2 className="module-section-title">Name, status, and phase</h2>
            <p className="module-section-description">
              The project&apos;s own details. Everything else on this page hangs off this record.
            </p>
          </div>
        </div>
        {canWrite && !editing ? (
          <Button variant="outline" onClick={() => setEditing(true)}>
            <Pencil className="h-4 w-4" />
            Edit project
          </Button>
        ) : null}
      </div>

      {!editing ? (
        <dl className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div>
            <dt className="text-sm text-muted-foreground">Name</dt>
            <dd className="text-sm font-medium text-foreground">{project.name}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Status</dt>
            <dd className="text-sm font-medium text-foreground">
              {PROJECT_STATUS_LABELS[project.status as ProjectStatus] ?? project.status}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Delivery phase</dt>
            <dd className="text-sm font-medium text-foreground">
              {PROJECT_DELIVERY_PHASE_LABELS[project.deliveryPhase as ProjectDeliveryPhase] ??
                project.deliveryPhase}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Plan type</dt>
            <dd className="text-sm font-medium text-foreground">{project.planType}</dd>
          </div>
          {project.summary ? (
            <div className="sm:col-span-2 xl:col-span-4">
              <dt className="text-sm text-muted-foreground">Summary</dt>
              <dd className="text-sm text-foreground">{project.summary}</dd>
            </div>
          ) : null}
        </dl>
      ) : (
        <form className="mt-4 grid gap-4 md:grid-cols-2" onSubmit={handleSave}>
          <div className="space-y-2 md:col-span-2">
            <label className="text-sm font-medium text-foreground" htmlFor="project-name">
              Name
            </label>
            <Input
              id="project-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={120}
              required
            />
          </div>

          <div className="space-y-2 md:col-span-2">
            <label className="text-sm font-medium text-foreground" htmlFor="project-summary">
              Summary
            </label>
            <Textarea
              id="project-summary"
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              maxLength={2000}
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground" htmlFor="project-status">
              Status
            </label>
            <select
              id="project-status"
              className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              {PROJECT_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {PROJECT_STATUS_LABELS[value]}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground" htmlFor="project-phase">
              Delivery phase
            </label>
            <select
              id="project-phase"
              className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
              value={deliveryPhase}
              onChange={(event) => setDeliveryPhase(event.target.value)}
            >
              {PROJECT_DELIVERY_PHASES.map((value) => (
                <option key={value} value={value}>
                  {PROJECT_DELIVERY_PHASE_LABELS[value]}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2 md:col-span-2">
            <label className="text-sm font-medium text-foreground" htmlFor="project-plan-type">
              Plan type
            </label>
            <Input
              id="project-plan-type"
              value={planType}
              onChange={(event) => setPlanType(event.target.value)}
              list="project-plan-type-options"
              maxLength={80}
            />
            {/* Suggestions, not a closed list: the column has no CHECK because
                the kinds of plan an agency runs vary by agency and country. */}
            <datalist id="project-plan-type-options">
              {PLAN_TYPE_SUGGESTIONS.map((value) => (
                <option key={value} value={value} />
              ))}
            </datalist>
          </div>

          <div className="flex flex-wrap items-center gap-3 md:col-span-2">
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save project
            </Button>
            <Button type="button" variant="outline" onClick={resetToRecord} disabled={saving}>
              <X className="h-4 w-4" />
              Cancel
            </Button>
          </div>
        </form>
      )}

      {error ? (
        <StateBlock className="mt-4" title="That did not save" description={error} tone="danger" compact />
      ) : null}

      <div className="mt-6 border-t border-border pt-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-foreground">Study area</p>
            <p className="text-sm text-muted-foreground">
              The area this project covers. Model runs, county onboarding, and safety acquisitions
              start here instead of asking again. This is separate from the map marker below, which
              is the project&apos;s site.
            </p>
          </div>
          {canWrite && !editingPlace ? (
            <Button variant="outline" onClick={() => setEditingPlace(true)}>
              <MapPin className="h-4 w-4" />
              {project.place.label ? "Change area" : "Set study area"}
            </Button>
          ) : null}
        </div>

        {!editingPlace ? (
          <div className="mt-3">
            {/*
              A STUDY AREA WITHOUT A NAME IS STILL A STUDY AREA.

              This branched on `label` alone, and a hand-drawn area carries no
              place name — so immediately after saving a polygon, and after a
              reload, this readout said "No study area set" while the board on
              the SAME PAGE said the area "was drawn by hand". A fresh tester hit
              it on 2026-08-14 and could not tell which was true. The board reads
              `place.source`, which is the thing that actually says whether an
              area exists; this now agrees with it, and falls back to naming the
              shape rather than denying it.
            */}
            {project.place.label || placeIsUnresolvedShape ? (
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone={placeIsUnresolvedShape ? "warning" : "success"}>
                  {project.place.label || (placeIsUploaded ? "Uploaded area" : "Drawn area")}
                </StatusBadge>
                {placeIsUnresolvedShape ? (
                  <span className="text-sm text-muted-foreground">
                    {placeIsUploaded ? "Uploaded file" : "Drawn area"} — modules can inherit its
                    shape, but cannot derive a county filter, crash-data scope, or jurisdiction rule
                    from it.
                  </span>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No study area set.{" "}
                {workspaceHomeLabel
                  ? `Model runs and county onboarding will start from this workspace's home geography (${workspaceHomeLabel}).`
                  : "This workspace has no home geography either, so every module will ask each time."}
              </p>
            )}
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            <StudyAreaPicker
              corridorText={placeText}
              onCorridorChange={(text) => {
                setPlaceText(text);
                setUploadedBoundary(null);
              }}
              onPlaceResolved={setPickedPlace}
              // Setting a project's area launches no run, so the engine-routing
              // hint would be advice about something that is not going to happen.
              showRunEngineHint={false}
              externalLabel={uploadedBoundary ? "Uploaded area" : project.place.label}
            />
            <p className="text-sm text-muted-foreground">
              Searching gives this project a place identity, which is what lets county onboarding,
              stage-gate templates, and grant eligibility resolve. A drawn area sets the shape only.
            </p>
            <CorridorUpload
              onUpload={(geojson) => {
                setUploadedBoundary(geojson);
                setPickedPlace(null);
                setPlaceText(JSON.stringify(geojson));
              }}
              isCurrentBoundary={uploadedBoundary !== null}
            />
            <p className="text-sm text-muted-foreground">
              Have a corridor file for the project map?{" "}
              <Link className="font-medium text-foreground underline underline-offset-4" href={`/projects/${project.id}?tab=map#project-map-presence`}>
                Upload it on this project&apos;s Evidence tab.
              </Link>
            </p>

            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={() => void handleSavePlace()} disabled={savingPlace}>
                {savingPlace ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Save study area
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setPlaceText("");
                  setPickedPlace(null);
                  setUploadedBoundary(null);
                  setEditingPlace(false);
                }}
                disabled={savingPlace}
              >
                <X className="h-4 w-4" />
                Cancel
              </Button>
              {project.place.label ? (
                <Button variant="outline" onClick={() => void handleClearPlace()} disabled={savingPlace}>
                  Clear area
                </Button>
              ) : null}
            </div>
          </div>
        )}

        <CensusTractCoverageControl
          place={project.place}
          origin="project_study_area"
          // FALSE, always. `resolveCensusTractScope` scopes the equity layer to
          // the WORKSPACE home geography and to nothing else, so loading a
          // project's county changes what is stored (shared, public data) but
          // not what this workspace's map draws. The control says so rather
          // than implying a change the map will not show.
          affectsWorkspaceLayer={false}
        />
      </div>

      {canWrite ? (
        <div className="mt-6 border-t border-border pt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-foreground">Delete this project</p>
              <p className="text-sm text-muted-foreground">
                Only possible while nothing is attached. Once this project carries reports, runs,
                funding, or invoices, retire it by setting its status to Complete instead.
              </p>
            </div>
            {/*
              Destructive, and trailing an ellipsis: this button no longer
              deletes anything by itself. It asks the server what a delete would
              cost and then either refuses or opens the question.
            */}
            <Button variant="destructive" onClick={() => void handleDelete()} disabled={deleting}>
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Delete project…
            </Button>
          </div>

          {refusal ? (
            <div className="mt-4 rounded-xl border border-border bg-muted/20 p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 text-[color:var(--amber,#b45309)]" />
                <div className="space-y-3">
                  <p className="text-sm font-medium text-foreground">{refusal.headline}</p>
                  <ul className="space-y-2">
                    {refusal.blockers.map((blocker) => (
                      <li key={blocker.table} className="text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge tone={blocker.severity === "blocking" ? "danger" : "warning"}>
                            {blocker.count} {blocker.label}
                          </StatusBadge>
                          <Link href={blocker.href} className="font-medium text-foreground hover:underline">
                            Open
                          </Link>
                        </div>
                        <p className="mt-1 text-muted-foreground">{blocker.reason}</p>
                      </li>
                    ))}
                  </ul>
                  <p className="text-sm text-muted-foreground">{refusal.alternative}</p>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      {confirmDialog}
    </article>
  );
}
