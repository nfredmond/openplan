"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  formatPlanLinkTypeLabel,
  PLAN_LINK_TYPE_OPTIONS,
  PLAN_STATUS_OPTIONS,
  PLAN_TYPE_OPTIONS,
  type PlanLinkType,
} from "@/lib/plans/catalog";

type ProjectOption = {
  id: string;
  name: string;
};

type PlanDetailControlsProps = {
  plan: {
    id: string;
    title: string;
    summary: string | null;
    status: string;
    plan_type: string;
    project_id: string | null;
    geography_label: string | null;
    horizon_year: number | null;
  };
  projects: ProjectOption[];
};

/**
 * The shape `GET /api/plans/[planId]?view=links` answers with.
 *
 * Declared here rather than imported from the route so a client component does
 * not depend on a route module. The two are held together by
 * `src/test/plan-links-editor-reaches-a-planner.test.tsx`, which drives the REAL
 * route handler into this REAL component — a shape change fails there rather
 * than silently rendering an empty picker.
 */
type PlanLinkOptionRecord = { id: string; label: string };
type PlanLinkOptionSet = { records: PlanLinkOptionRecord[]; unreadable: boolean; truncated: boolean };
type PlanLinkOptionsByType = Record<string, PlanLinkOptionSet | undefined>;
type StoredPlanLink = { id: string; link_type: string; linked_id: string; label: string | null };

type LinkEditorState =
  | { status: "loading" }
  /** The read FAILED. Never rendered as "this plan has no links". */
  | { status: "failed" }
  | { status: "ready"; options: PlanLinkOptionsByType; storedLinks: StoredPlanLink[] };

/**
 * Editor headings, keyed by the catalog's own link types. The list is iterated
 * from `PLAN_LINK_TYPE_OPTIONS`, so a link type added to the catalog still gets
 * a picker here — with the catalog's own label — instead of quietly becoming
 * uneditable.
 */
const LINK_FIELD_LABELS: Record<string, string> = {
  scenario_set: "Linked scenario sets",
  engagement_campaign: "Linked engagement campaigns",
  report: "Linked reports",
  project_record: "Related project records",
};

const LINK_SELECT_CLASS =
  "min-h-32 w-full rounded-xl border border-input bg-background px-3.5 py-3 text-sm shadow-xs outline-none focus-visible:border-[color:var(--focus-ring-light)] focus-visible:ring-3 focus-visible:ring-[color:var(--focus-ring-light)]/35";

function readSelectedIds(event: React.ChangeEvent<HTMLSelectElement>) {
  return Array.from(event.target.selectedOptions).map((option) => option.value);
}

const LINK_TYPES = PLAN_LINK_TYPE_OPTIONS.map((option) => option.value as PlanLinkType);

/**
 * The most links one save may carry — the cap `PATCH /api/plans/[planId]`
 * enforces as `links: z.array(...).max(40)`.
 *
 * The picker can offer 200 records per type across four types, so a select-all
 * builds an over-cap payload in one keystroke. That payload fails zod BEFORE the
 * route reads anything else, which refuses the WHOLE update — the planner's
 * title, status and summary edits included — and answers a bare "Invalid plan
 * update payload" naming neither a cap nor a count. So the editor stops first
 * and says what to do about it.
 *
 * Held to the route's own number from both sides by
 * `src/test/plan-links-editor-reaches-a-planner.test.tsx` ("uses the cap the
 * route actually enforces"): the real route must accept this many and refuse one
 * more, so raising either cap alone fails the build.
 */
const PLAN_LINK_SAVE_LIMIT = 40;

function linkFieldLabel(linkType: string): string {
  return LINK_FIELD_LABELS[linkType] ?? `${formatPlanLinkTypeLabel(linkType)} links`;
}

export function PlanDetailControls({ plan, projects }: PlanDetailControlsProps) {
  const router = useRouter();
  const [title, setTitle] = useState(plan.title);
  const [summary, setSummary] = useState(plan.summary ?? "");
  const [status, setStatus] = useState(plan.status);
  const [planType, setPlanType] = useState(plan.plan_type);
  const [projectId, setProjectId] = useState(plan.project_id ?? "");
  const [geographyLabel, setGeographyLabel] = useState(plan.geography_label ?? "");
  const [horizonYear, setHorizonYear] = useState(plan.horizon_year ? String(plan.horizon_year) : "");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkEditor, setLinkEditor] = useState<LinkEditorState>({ status: "loading" });
  const [selectedLinkIds, setSelectedLinkIds] = useState<Record<string, string[]>>({});

  useEffect(() => {
    const controller = new AbortController();

    async function loadLinkEditor() {
      try {
        const response = await fetch(`/api/plans/${plan.id}?view=links`, { signal: controller.signal });
        if (!response.ok) throw new Error("link editor load failed");

        const payload = (await response.json()) as {
          planLinks?: StoredPlanLink[];
          linkOptions?: PlanLinkOptionsByType;
        };

        if (!payload.linkOptions || !Array.isArray(payload.planLinks)) {
          throw new Error("link editor payload incomplete");
        }

        const storedLinks = payload.planLinks;
        const options = payload.linkOptions;

        // Pre-select only links whose target is actually in the list this
        // picker can show. Everything else is handled explicitly below —
        // never dropped by accident.
        const selections: Record<string, string[]> = {};
        for (const linkType of LINK_TYPES) {
          const offered = new Set((options[linkType]?.records ?? []).map((record) => record.id));
          selections[linkType] = storedLinks
            .filter((link) => link.link_type === linkType && offered.has(link.linked_id))
            .map((link) => link.linked_id);
        }

        if (controller.signal.aborted) return;
        setSelectedLinkIds(selections);
        setLinkEditor({ status: "ready", options, storedLinks });
      } catch (loadError) {
        if (controller.signal.aborted || (loadError as Error)?.name === "AbortError") return;
        setLinkEditor({ status: "failed" });
      }
    }

    void loadLinkEditor();

    return () => controller.abort();
  }, [plan.id]);

  /**
   * A stored link the picker cannot show, split by WHY — the two need opposite
   * handling and a planner is owed the difference.
   *
   * `preserved`: its type's list failed to read, or the list was truncated, so
   * the record may well exist. It is resubmitted unchanged.
   * `dangling`: the list is complete and the target is not in it, so the record
   * is gone from this workspace. Saving removes the link, and the editor says so
   * BEFORE the planner saves.
   */
  const unshownLinks = useMemo(() => {
    if (linkEditor.status !== "ready") return { preserved: [] as StoredPlanLink[], dangling: [] as StoredPlanLink[] };

    const preserved: StoredPlanLink[] = [];
    const dangling: StoredPlanLink[] = [];

    for (const link of linkEditor.storedLinks) {
      const optionSet = linkEditor.options[link.link_type];
      const offered = new Set((optionSet?.records ?? []).map((record) => record.id));
      if (offered.has(link.linked_id)) continue;

      if (!optionSet || optionSet.unreadable || optionSet.truncated) {
        preserved.push(link);
        continue;
      }

      dangling.push(link);
    }

    return { preserved, dangling };
  }, [linkEditor]);

  const buildLinkPayload = useCallback(() => {
    if (linkEditor.status !== "ready") return null;

    const selected = LINK_TYPES.flatMap((linkType) =>
      (selectedLinkIds[linkType] ?? []).map((linkedId) => ({ linkType, linkedId }))
    );

    return [
      ...selected,
      ...unshownLinks.preserved.map((link) => ({ linkType: link.link_type, linkedId: link.linked_id })),
    ];
  }, [linkEditor.status, selectedLinkIds, unshownLinks]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSaving(true);

    try {
      // `links` REPLACES the plan's whole link set. Omitting the key leaves the
      // stored links untouched, which is the only safe thing to send when the
      // editor could not read them — otherwise saving a title would delete
      // every link on the plan.
      const links = buildLinkPayload();

      // Refuse locally rather than let the route refuse the whole update. The
      // count includes links preserved from a truncated or unreadable list, so
      // this says what saving WOULD attach, not what was hand-selected.
      if (links && links.length > PLAN_LINK_SAVE_LIMIT) {
        setError(
          `A plan can carry up to ${PLAN_LINK_SAVE_LIMIT} linked records, and saving would attach ${links.length}. ` +
            `Deselect ${links.length - PLAN_LINK_SAVE_LIMIT} to save. Nothing was changed.`
        );
        return;
      }

      const response = await fetch(`/api/plans/${plan.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title,
          summary: summary.trim() ? summary.trim() : null,
          status,
          planType,
          projectId: projectId || null,
          geographyLabel: geographyLabel.trim() ? geographyLabel.trim() : null,
          horizonYear: horizonYear ? Number(horizonYear) : null,
          ...(links ? { links } : {}),
        }),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to update plan");
      }

      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to update plan");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <article className="module-section-surface">
      <div className="module-section-header">
        <div className="module-section-heading">
          <p className="module-section-label">Controls</p>
          <h2 className="module-section-title">Plan record workflow</h2>
          <p className="module-section-description">
            Update the formal record and what it is linked to, in place. This stays metadata-first and intentionally
            avoids chapter editing.
          </p>
        </div>
        <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-sky-500/12 text-sky-700 dark:text-sky-300">
          <Settings2 className="h-5 w-5" />
        </span>
      </div>

      <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-1.5">
          <label htmlFor="plan-control-title" className="text-[0.82rem] font-semibold">
            Title
          </label>
          <Input id="plan-control-title" value={title} onChange={(event) => setTitle(event.target.value)} required />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="plan-control-status" className="text-[0.82rem] font-semibold">
              Status
            </label>
            <select
              id="plan-control-status"
              className="flex h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none focus-visible:border-[color:var(--focus-ring-light)] focus-visible:ring-3 focus-visible:ring-[color:var(--focus-ring-light)]/35"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              {PLAN_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="plan-control-type" className="text-[0.82rem] font-semibold">
              Plan type
            </label>
            <select
              id="plan-control-type"
              className="flex h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none focus-visible:border-[color:var(--focus-ring-light)] focus-visible:ring-3 focus-visible:ring-[color:var(--focus-ring-light)]/35"
              value={planType}
              onChange={(event) => setPlanType(event.target.value)}
            >
              {PLAN_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="plan-control-project" className="text-[0.82rem] font-semibold">
            Primary project
          </label>
          <select
            id="plan-control-project"
            className="flex h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none focus-visible:border-[color:var(--focus-ring-light)] focus-visible:ring-3 focus-visible:ring-[color:var(--focus-ring-light)]/35"
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
          >
            <option value="">No linked project</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="plan-control-geography" className="text-[0.82rem] font-semibold">
              Geography label
            </label>
            <Input
              id="plan-control-geography"
              value={geographyLabel}
              onChange={(event) => setGeographyLabel(event.target.value)}
              placeholder="Downtown core / corridor segment"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="plan-control-horizon" className="text-[0.82rem] font-semibold">
              Horizon year
            </label>
            <Input
              id="plan-control-horizon"
              type="number"
              min={1900}
              max={2200}
              value={horizonYear}
              onChange={(event) => setHorizonYear(event.target.value)}
              placeholder="2035"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="plan-control-summary" className="text-[0.82rem] font-semibold">
            Summary
          </label>
          <Textarea
            id="plan-control-summary"
            rows={4}
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            placeholder="Describe what planning record is being assembled and what decisions it should support."
          />
        </div>

        <div className="space-y-3 rounded-[0.5rem] border border-border/70 bg-background/40 p-4">
          <div className="space-y-1">
            <p className="text-[0.82rem] font-semibold">Linked records</p>
            <p className="text-xs text-muted-foreground">
              Attach scenario sets, engagement campaigns, reports and other project records directly to this plan. These
              are separate from anything the plan already inherits through its primary project.
            </p>
          </div>

          {linkEditor.status === "loading" ? (
            <p className="text-sm text-muted-foreground" role="status">
              Loading the records this plan can link to…
            </p>
          ) : linkEditor.status === "failed" ? (
            <p className="rounded-[0.5rem] border border-red-300/80 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
              This plan&apos;s links could not be read on this page load, so they cannot be edited here right now. This is
              not a statement that this plan has no links. Saving the fields above will leave the plan&apos;s stored links
              exactly as they are.
            </p>
          ) : (
            <>
              <div className="grid gap-4 lg:grid-cols-2">
                {LINK_TYPES.map((linkType) => {
                  const optionSet = linkEditor.options[linkType];
                  const fieldId = `plan-control-links-${linkType}`;

                  if (!optionSet || optionSet.unreadable) {
                    return (
                      <div key={linkType} className="space-y-1.5">
                        <p className="text-[0.82rem] font-semibold">{linkFieldLabel(linkType)}</p>
                        <p className="rounded-[0.5rem] border border-red-300/80 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
                          This list could not be read, so these links cannot be edited on this page load — it does not
                          mean there are none. Any {formatPlanLinkTypeLabel(linkType).toLowerCase()} links already stored
                          on this plan are kept as they are.
                        </p>
                      </div>
                    );
                  }

                  return (
                    <div key={linkType} className="space-y-1.5">
                      <label htmlFor={fieldId} className="text-[0.82rem] font-semibold">
                        {linkFieldLabel(linkType)}
                      </label>
                      <select
                        id={fieldId}
                        multiple
                        className={LINK_SELECT_CLASS}
                        value={selectedLinkIds[linkType] ?? []}
                        onChange={(event) =>
                          setSelectedLinkIds((current) => ({ ...current, [linkType]: readSelectedIds(event) }))
                        }
                      >
                        {optionSet.records.map((record) => (
                          <option key={record.id} value={record.id}>
                            {record.label}
                          </option>
                        ))}
                      </select>
                      {optionSet.records.length === 0 ? (
                        <p className="text-xs text-muted-foreground">
                          This workspace has no {formatPlanLinkTypeLabel(linkType).toLowerCase()} records to link yet.
                        </p>
                      ) : null}
                      {optionSet.truncated ? (
                        <p className="text-xs text-muted-foreground">
                          Showing the {optionSet.records.length} most recently updated. Links to records outside this
                          list stay attached to the plan.
                        </p>
                      ) : null}
                    </div>
                  );
                })}
              </div>

              <p className="text-xs text-muted-foreground">
                Multi-select uses platform-native controls. Hold Command/Ctrl to keep multiple linked records selected,
                and deselect one to detach it when you save. Up to {PLAN_LINK_SAVE_LIMIT} linked records can be saved on
                one plan.
              </p>

              {unshownLinks.dangling.length > 0 ? (
                <p className="rounded-[0.5rem] border border-amber-300/80 bg-amber-50 px-4 py-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                  {unshownLinks.dangling.length} stored link
                  {unshownLinks.dangling.length === 1 ? "" : "s"} point to records that are no longer in this workspace,
                  so they cannot be shown above. Saving this form will remove them from the plan.
                </p>
              ) : null}
            </>
          )}
        </div>

        {error ? (
          <p className="rounded-[0.5rem] border border-red-300/80 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
            {error}
          </p>
        ) : null}

        <Button type="submit" disabled={isSaving}>
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save plan record
        </Button>
      </form>
    </article>
  );
}
