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

/**
 * The location check as the API reports it (20260730000002).
 *
 * `enabled` is deliberately NULLABLE: null means the read failed, and it must
 * never be rendered as "off". Telling an operator that their consultation
 * accepts pins from anywhere, on the strength of a query that broke, is a claim
 * about the world nobody established.
 */
type SubmissionGeofence = {
  enabled: boolean | null;
  canEnable: boolean;
  areaState: "set" | "unset" | "unreadable";
  areaLabel: string | null;
};

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

  // The submission location check, read from the same GET as the framing above —
  // one request, so the control and the area it depends on can never describe
  // two different moments.
  const [geofence, setGeofence] = useState<SubmissionGeofence | null>(null);
  const [savingGeofence, setSavingGeofence] = useState(false);
  const [geofenceError, setGeofenceError] = useState<string | null>(null);

  const loadFraming = useCallback(async () => {
    setFramingError(null);
    try {
      const response = await fetch(`/api/engagement/campaigns/${campaign.id}`);
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setFramingError(body.error ?? "Could not read where the public map opens.");
        return;
      }
      const body = (await response.json()) as {
        mapFraming?: PortalMapFraming;
        submissionGeofence?: SubmissionGeofence;
      };
      setGeofence(body.submissionGeofence ?? null);
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

  async function saveGeofence(nextEnabled: boolean) {
    setGeofenceError(null);
    setSavingGeofence(true);
    try {
      const response = await fetch(`/api/engagement/campaigns/${campaign.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ submissionGeofenceEnabled: nextEnabled }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
        // The server's own sentence, not a generic one: it is the sentence that
        // says WHY — usually that there is no area to check a pin against.
        setGeofenceError(body.message ?? body.error ?? "Could not change the location check.");
        return;
      }

      await loadFraming();
      router.refresh();
    } catch {
      setGeofenceError("Could not reach the server to change the location check.");
    } finally {
      setSavingGeofence(false);
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

      {/*
        THE LOCATION CHECK (20260730000002).

        Opt-in, and never offered where it cannot run: a campaign with no area of
        its own has nothing to test a dropped pin against, so the control is
        disabled and says which of the three states it is in — no area, an
        unreadable one, or a read that failed. Enabling a check that cannot run
        would leave an operator believing participation is being filtered when it
        is not, which is worse than not offering it at all.

        The area it uses is this CAMPAIGN's own, never the linked project's or
        the workspace's. The map above may well be framed by one of those; being
        refused against a boundary nobody chose for this consultation is a
        different thing entirely from opening the camera on it.
      */}
      <div className="mt-6 border-t border-border pt-4">
        <p className="text-sm font-medium text-foreground">Where residents may drop a pin</p>
        <p className="mt-1 text-sm text-muted-foreground">
          A public comment can carry a location. This decides whether a location outside the
          campaign&apos;s own area is accepted into the record.
        </p>

        {geofence === null ? (
          <p className="mt-3 text-sm text-muted-foreground">Reading the location check…</p>
        ) : geofence.enabled === null ? (
          <div className="mt-3">
            <StateBlock
              title="Could not read whether the location check is on"
              description="The campaign loaded but this setting did not. It is not known whether pins outside the campaign area are being refused, so nothing is claimed here either way. Reload the page; if it persists, whoever runs this deployment needs to look at it."
              tone="danger"
              compact
            />
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            <label className="flex items-start gap-2.5 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4"
                checked={geofence.enabled}
                disabled={savingGeofence || (!geofence.enabled && !geofence.canEnable)}
                onChange={(event) => void saveGeofence(event.target.checked)}
              />
              <span className="font-medium">
                Only accept comments pinned inside{" "}
                {geofence.areaLabel ? geofence.areaLabel : "this campaign's area"}
              </span>
            </label>

            {!geofence.canEnable ? (
              <p className="text-sm text-muted-foreground">
                {geofence.areaState === "unreadable"
                  ? "This campaign's area could not be read, so it is not known whether a location check could run here."
                  : "This campaign has no area of its own, so there is nothing to check a dropped pin against. Set the campaign area above first — the linked project's study area and the workspace home geography frame the map, but the check never runs against either."}
              </p>
            ) : null}

            <p className="text-sm text-muted-foreground">
              Comments sent without a pin are always accepted, whether this is on or off — a comment
              with no location is not outside the area, it has no location at all. A resident whose
              pin falls outside is told the comment is outside the area this consultation covers and
              asked to move it or send it without a location; they are never shown the boundary.
            </p>

            {savingGeofence ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving…
              </p>
            ) : null}

            {geofenceError ? (
              <StateBlock
                title="That did not save"
                description={geofenceError}
                tone="danger"
                compact
              />
            ) : null}
          </div>
        )}
      </div>
    </article>
  );
}
