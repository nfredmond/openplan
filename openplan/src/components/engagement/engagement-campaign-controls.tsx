"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MapPin, Settings2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { StateBlock } from "@/components/ui/state-block";
import { StatusBadge } from "@/components/ui/status-badge";
import { ENGAGEMENT_CAMPAIGN_STATUSES, ENGAGEMENT_TYPES, titleizeEngagementValue } from "@/lib/engagement/catalog";
import { StudyAreaPicker } from "@/components/models/study-area-picker";
import { parseCorridorText } from "@/lib/models/study-area";
import type { PlaceBoundaryResponse } from "@/lib/api/place-geographies";
// Type-only: the resolver is server-side, and an `import type` is erased before
// this component reaches the browser.
import type { PortalMapFraming } from "@/lib/engagement/public-portal-data";

type ProjectOption = {
  id: string;
  name: string;
};

type Campaign = {
  id: string;
  title: string;
  summary: string | null;
  status: string;
  engagement_type: string;
  project_id: string | null;
};

export function EngagementCampaignControls({
  campaign,
  projects,
}: {
  campaign: Campaign;
  projects: ProjectOption[];
}) {
  const router = useRouter();
  const [title, setTitle] = useState(campaign.title);
  const [summary, setSummary] = useState(campaign.summary ?? "");
  const [status, setStatus] = useState(campaign.status);
  const [engagementType, setEngagementType] = useState(campaign.engagement_type);
  const [projectId, setProjectId] = useState(campaign.project_id ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The public map's framing, read back from the API rather than passed in: it
  // is derived from four records (this campaign, its project, the workspace, and
  // the approved pins) and only the server can resolve it. `null` while loading;
  // `framingError` when the read FAILED, which must never render as "no area
  // set" — that is the confident-wrong-answer this codebase refuses.
  const [framing, setFraming] = useState<PortalMapFraming | null>(null);
  const [framingError, setFramingError] = useState<string | null>(null);
  const [editingArea, setEditingArea] = useState(false);
  const [areaText, setAreaText] = useState("");
  const [pickedPlace, setPickedPlace] = useState<PlaceBoundaryResponse | null>(null);
  const [savingArea, setSavingArea] = useState(false);
  const [areaError, setAreaError] = useState<string | null>(null);

  const loadFraming = useCallback(async () => {
    setFramingError(null);
    try {
      const response = await fetch(`/api/engagement/campaigns/${campaign.id}`);
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setFramingError(body.error ?? "Could not read where the public map opens.");
        return;
      }
      const body = (await response.json()) as { mapFraming?: PortalMapFraming };
      if (!body.mapFraming) {
        setFramingError("The campaign loaded, but it did not say where the public map opens.");
        return;
      }
      setFraming(body.mapFraming);
    } catch {
      setFramingError("Could not reach the server to read where the public map opens.");
    }
  }, [campaign.id]);

  useEffect(() => {
    void loadFraming();
  }, [loadFraming]);

  async function saveArea(place: unknown) {
    setAreaError(null);
    setSavingArea(true);
    try {
      const response = await fetch(`/api/engagement/campaigns/${campaign.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ place }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
        setAreaError(body.message ?? body.error ?? "Could not save this area.");
        return;
      }

      setEditingArea(false);
      setAreaText("");
      setPickedPlace(null);
      await loadFraming();
      router.refresh();
    } catch {
      setAreaError("Could not reach the server to save this area.");
    } finally {
      setSavingArea(false);
    }
  }

  async function handleSaveArea() {
    // A searched place is saved by REFERENCE so the server re-resolves the
    // boundary; a drawn one has no reference to send.
    if (pickedPlace) {
      await saveArea({ mode: "place", kind: pickedPlace.kind, geoid: pickedPlace.geoid });
      return;
    }

    const drawn = parseCorridorText(areaText);
    if (!drawn) {
      setAreaError("Search for a place or draw an area before saving.");
      return;
    }
    await saveArea({ mode: "drawn", geometry: drawn });
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/engagement/campaigns/${campaign.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title,
          summary: summary || null,
          status,
          engagementType,
          projectId: projectId || null,
        }),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to update engagement campaign");
      }

      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to update engagement campaign");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <article className="module-section-surface">
      <div className="module-section-header">
        <div className="module-section-heading">
          <p className="module-section-label">Controls</p>
          <h2 className="module-section-title">Campaign metadata</h2>
          <p className="module-section-description">
            Keep the campaign title, linkage, and status explicit so intake review stays auditable.
          </p>
        </div>
        <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-sky-500/12 text-sky-700 dark:text-sky-300">
          <Settings2 className="h-5 w-5" />
        </span>
      </div>

      <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-1.5">
          <label htmlFor="campaign-control-title" className="text-[0.82rem] font-semibold">
            Title
          </label>
          <Input id="campaign-control-title" value={title} onChange={(event) => setTitle(event.target.value)} required />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="campaign-control-status" className="text-[0.82rem] font-semibold">
              Status
            </label>
            <select
              id="campaign-control-status"
              className="flex h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none focus-visible:border-[color:var(--focus-ring-light)] focus-visible:ring-3 focus-visible:ring-[color:var(--focus-ring-light)]/35"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              {ENGAGEMENT_CAMPAIGN_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {titleizeEngagementValue(value)}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="campaign-control-type" className="text-[0.82rem] font-semibold">
              Engagement type
            </label>
            <select
              id="campaign-control-type"
              className="flex h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none focus-visible:border-[color:var(--focus-ring-light)] focus-visible:ring-3 focus-visible:ring-[color:var(--focus-ring-light)]/35"
              value={engagementType}
              onChange={(event) => setEngagementType(event.target.value)}
            >
              {ENGAGEMENT_TYPES.map((value) => (
                <option key={value} value={value}>
                  {titleizeEngagementValue(value)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="campaign-control-project" className="text-[0.82rem] font-semibold">
            Linked project
          </label>
          <select
            id="campaign-control-project"
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

        <div className="space-y-1.5">
          <label htmlFor="campaign-control-summary" className="text-[0.82rem] font-semibold">
            Summary
          </label>
          <Textarea
            id="campaign-control-summary"
            rows={4}
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
          />
        </div>

        {error ? (
          <p className="rounded-[0.5rem] border border-red-300/80 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
            {error}
          </p>
        ) : null}

        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Save campaign
        </Button>
      </form>

      <div className="mt-6 border-t border-border pt-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-foreground">Public map framing</p>
            <p className="text-sm text-muted-foreground">
              Where the resident-facing map opens. A campaign area set here wins over the linked
              project&apos;s study area, this workspace&apos;s home geography, and the pins already on
              the map — in that order.
            </p>
          </div>
          {!editingArea ? (
            <Button variant="outline" onClick={() => setEditingArea(true)}>
              <MapPin className="h-4 w-4" />
              {framing?.origin === "campaign_place" ? "Change area" : "Set campaign area"}
            </Button>
          ) : null}
        </div>

        {/*
          Three distinct states, deliberately: what frames the map, "we could not
          find out", and "still reading". A failed read must never arrive as "no
          area set" — that is a claim about the world, made out of a broken query.
        */}
        <div className="mt-3">
          {framingError ? (
            <StateBlock
              title="Could not read where the public map opens"
              description={framingError}
              tone="danger"
              compact
            />
          ) : framing ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone={framing.origin === "none" ? "warning" : "success"}>
                  {framing.origin === "campaign_place"
                    ? "Campaign area"
                    : framing.origin === "project_place"
                      ? "Project study area"
                      : framing.origin === "workspace_home"
                        ? "Workspace home geography"
                        : framing.origin === "approved_pins"
                          ? "Approved submissions"
                          : "Nothing set"}
                </StatusBadge>
                <span className="text-sm text-muted-foreground">{framing.summary}</span>
              </div>
              {framing.unreadableNote ? (
                <p className="text-sm text-muted-foreground">{framing.unreadableNote}</p>
              ) : null}
              {framing.origin === "none" ? (
                <p className="text-sm text-muted-foreground">
                  Until an area is set, the first resident to open this campaign sees the whole
                  country and has to find their own neighbourhood before they can say anything.
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Reading where the public map opens…</p>
          )}
        </div>

        {editingArea ? (
          <div className="mt-3 space-y-3">
            <StudyAreaPicker
              corridorText={areaText}
              onCorridorChange={setAreaText}
              onPlaceResolved={setPickedPlace}
              // Setting a campaign's area launches no model run, so the
              // engine-routing hint would be advice about something that is not
              // going to happen.
              showRunEngineHint={false}
              externalLabel={framing?.originLabel ?? null}
            />
            <p className="text-sm text-muted-foreground">
              Searching gives the campaign a place identity; drawing sets the shape only. Either way
              only the bounding box reaches the public page — enough to frame the map, and no more.
            </p>
            {areaError ? (
              <StateBlock title="That did not save" description={areaError} tone="danger" compact />
            ) : null}
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={() => void handleSaveArea()} disabled={savingArea}>
                {savingArea ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Save campaign area
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setAreaText("");
                  setPickedPlace(null);
                  setAreaError(null);
                  setEditingArea(false);
                }}
                disabled={savingArea}
              >
                <X className="h-4 w-4" />
                Cancel
              </Button>
              {framing?.origin === "campaign_place" ? (
                <Button variant="outline" onClick={() => void saveArea(null)} disabled={savingArea}>
                  Clear campaign area
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </article>
  );
}
