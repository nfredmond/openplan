"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Radar, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  GuidedFlow,
  GuidedFlowRow,
  useGuidedFlow,
  type GuidedFlowStep,
} from "@/components/ui/guided-flow";
import {
  formatAerialMissionTypeLabel,
  formatAerialMissionStatusLabel,
  type AerialMissionType,
  type AerialMissionStatus,
} from "@/lib/aerial/catalog";

const MISSION_TYPES: AerialMissionType[] = ["corridor_survey", "site_inspection", "aoi_capture", "general"];
const MISSION_STATUSES: AerialMissionStatus[] = ["planned", "active", "complete", "cancelled"];

type MissionValues = {
  title: string;
  missionType: AerialMissionType;
  status: AerialMissionStatus;
  geographyLabel: string;
  collectedAt: string;
  notes: string;
};

/**
 * Logging a flight used to be a six-field form open on the project page,
 * between a planner and the evidence they came to read. It is two short
 * questions behind a button now.
 *
 * WHAT DID NOT CHANGE. The same POST to `/api/aerial/missions` with the same
 * keys, the same `"" → undefined`, and `collectedAt` still converted to an ISO
 * string or left absent. It still does NOT navigate: a mission is logged
 * against the project you are already reading, so it refreshes in place.
 *
 * THE RESET COMES FREE, AND THAT IS WORTH SAYING. The inline form cleared its
 * own fields after a save so a second mission could be logged. `flow.open()`
 * starts from `initialValues` every time, so reopening gives a blank form
 * without any clearing code — and the geography label starts from the project's
 * study area again, which is what it did before.
 *
 * THE CONFIRMATION MOVED OUT OF THE FORM. The flow closes on success, so
 * "Mission logged." would close with it. It sits on the panel instead, where
 * the person can still see it.
 */
export function AerialMissionCreator({
  projectId,
  titleLabel = "Log aerial mission",
  description,
  defaultGeographyLabel = null,
}: {
  projectId: string;
  titleLabel?: string;
  description?: string;
  /**
   * The project's study area, as a starting point for this mission's own label.
   *
   * A mission's geography is deliberately a free-text NOTE and not a picked
   * place — it is usually narrower than the project ("Segment A", "the bridge
   * approach"), and `aerial_missions` stores no geometry precisely because
   * nothing inherits one from it. Starting the box from the project's area
   * means a planner edits a name down rather than typing it from nothing, and
   * an unedited value is still true.
   */
  defaultGeographyLabel?: string | null;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);

  const steps = useMemo<GuidedFlowStep<MissionValues>[]>(
    () => [
      {
        id: "what",
        title: "What was flown?",
        hint: "A name you would recognise later, and what kind of flight it was.",
        fields: [
          {
            name: "title",
            label: "a name",
            required: true,
            requiredMessage: "Give the mission a name before you log it.",
          },
          { name: "missionType", label: "a mission type" },
          { name: "status", label: "a status" },
        ],
        render: (flow) => (
          <>
            <GuidedFlowRow flow={flow} name="title" label="Mission name">
              <Input {...flow.text("title")} placeholder="SR 49 corridor lidar capture" />
            </GuidedFlowRow>

            <GuidedFlowRow flow={flow} name="missionType" label="What kind of flight?">
              <select className="module-select" {...flow.text("missionType")}>
                {MISSION_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {formatAerialMissionTypeLabel(type)}
                  </option>
                ))}
              </select>
            </GuidedFlowRow>

            <GuidedFlowRow flow={flow} name="status" label="Where is it up to?">
              <select className="module-select" {...flow.text("status")}>
                {MISSION_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {formatAerialMissionStatusLabel(status)}
                  </option>
                ))}
              </select>
            </GuidedFlowRow>
          </>
        ),
      },
      {
        id: "where",
        title: "Where and when?",
        hint: "All optional — a mission is still worth logging without them.",
        fields: [
          { name: "geographyLabel", label: "the area flown" },
          { name: "collectedAt", label: "a collection date" },
          { name: "notes", label: "notes" },
        ],
        render: (flow) => (
          <>
            <GuidedFlowRow
              flow={flow}
              name="geographyLabel"
              label="Which area was flown?"
              hint={
                defaultGeographyLabel
                  ? "Starting from this project's study area. Narrow it to what was actually flown."
                  : "In your own words — a corridor, a segment, a bridge approach."
              }
            >
              <Input {...flow.text("geographyLabel")} placeholder="Study corridor, Segment A" />
            </GuidedFlowRow>

            <GuidedFlowRow flow={flow} name="collectedAt" label="When was it collected?">
              <Input type="datetime-local" {...flow.text("collectedAt")} />
            </GuidedFlowRow>

            <GuidedFlowRow flow={flow} name="notes" label="Anything worth noting?">
              <Textarea
                {...flow.text("notes")}
                placeholder="Flight conditions, what was covered, known gaps, or what still needs doing."
              />
            </GuidedFlowRow>
          </>
        ),
      },
    ],
    [defaultGeographyLabel]
  );

  const flow = useGuidedFlow<MissionValues>({
    id: "log-aerial-mission",
    title: titleLabel,
    submitLabel: "Log the mission",
    initialValues: {
      title: "",
      missionType: "corridor_survey",
      status: "planned",
      geographyLabel: defaultGeographyLabel ?? "",
      collectedAt: "",
      notes: "",
    },
    steps,
    onSubmit: async (values) => {
      // Unchanged from the inline form, deliberately: same route, same keys,
      // same "" → undefined, same ISO conversion for the collection date.
      const response = await fetch("/api/aerial/missions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId,
          title: values.title,
          missionType: values.missionType,
          status: values.status,
          geographyLabel: values.geographyLabel || undefined,
          collectedAt: values.collectedAt ? new Date(values.collectedAt).toISOString() : undefined,
          notes: values.notes || undefined,
        }),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to create aerial mission");
      }

      setMessage("Mission logged.");
      router.refresh();
    },
  });

  return (
    <article className="rounded-[0.5rem] border border-border/70 bg-background/80 p-4">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-[0.5rem] bg-sky-500/12 text-sky-700 dark:text-sky-300">
          <Radar className="h-4 w-4" />
        </span>
        <div>
          <p className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Aerial mission</p>
          <h3 className="text-sm font-semibold text-foreground">{titleLabel}</h3>
          {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          type="button"
          onClick={() => {
            setMessage(null);
            flow.open();
          }}
          data-testid="aerial-mission-creator-open"
        >
          <Plus className="mr-1.5 h-4 w-4" />
          Log a mission
        </Button>
        {message ? (
          <p
            className="text-sm text-emerald-700 dark:text-emerald-300"
            data-testid="aerial-mission-logged"
          >
            {message}
          </p>
        ) : null}
      </div>

      <GuidedFlow flow={flow} />
    </article>
  );
}
