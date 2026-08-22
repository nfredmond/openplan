"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FilePlus2, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  GuidedFlow,
  GuidedFlowRow,
  useGuidedFlow,
  type GuidedFlowStep,
} from "@/components/ui/guided-flow";
import { RTP_CYCLE_STATUS_OPTIONS } from "@/lib/rtp/catalog";
import { StudyAreaPicker } from "@/components/models/study-area-picker";

type CreateResponse = {
  rtpCycleId: string;
  error?: string;
};

const selectClassName = "module-select";

type RtpCycleValues = {
  title: string;
  status: (typeof RTP_CYCLE_STATUS_OPTIONS)[number]["value"];
  geographyLabel: string;
  anchorLatitude: string;
  anchorLongitude: string;
  horizonStartYear: string;
  horizonEndYear: string;
  adoptionTargetDate: string;
  publicReviewOpenAt: string;
  publicReviewCloseAt: string;
  summary: string;
};

const INITIAL_VALUES: RtpCycleValues = {
  title: "",
  status: "draft",
  geographyLabel: "",
  anchorLatitude: "",
  anchorLongitude: "",
  horizonStartYear: "",
  horizonEndYear: "",
  adoptionTargetDate: "",
  publicReviewOpenAt: "",
  publicReviewCloseAt: "",
  summary: "",
};

/**
 * Eleven fields and a map used to sit open on the RTP operations board. Three
 * steps behind a button now — and the plan area gets a step of its own, so the
 * picker has the whole sheet rather than a third of a crowded form.
 *
 * THE FRONT DOOR IS UNCHANGED AND STILL THE ONLY ONE. `StudyAreaPicker`
 * resolves any US county / city / CDP / metro; a resolved place fills the label
 * and the pin, and both stay editable because "Countywide, including
 * unincorporated areas" is a legitimate label no gazetteer returns. A
 * hand-drawn area has no name and fills nothing. This is the
 * "do not build a second geography selector" non-negotiable, and
 * `rtp-cycle-creator-uses-the-front-door.test.ts` still holds it.
 *
 * THE PIN'S PAIR RULE MOVED TO THE STEP THAT OWNS BOTH HALVES. The map backdrop
 * needs a latitude AND a longitude to draw anything, so a lone latitude renders
 * nothing at all. It was checked before submit "because the pair rule is easier
 * to understand next to the two fields than in a toast after a round trip" —
 * which is exactly what a step check is: the message appears beside the two
 * fields, on the step holding them, before the flow will advance.
 *
 * IT STILL DOES NOT NAVIGATE. A cycle is created from the board a planner is
 * working on, so the flow closes and the board refreshes underneath.
 */
export function RtpCycleCreator() {
  const router = useRouter();
  // Drives the StudyAreaPicker only. `rtp_cycles` stores no boundary — the
  // cycle keeps a label and a display pin, not a geometry.
  const [pickerCorridorText, setPickerCorridorText] = useState("");

  const steps = useMemo<GuidedFlowStep<RtpCycleValues>[]>(
    () => [
      {
        id: "identity",
        title: "Which plan cycle is this?",
        hint: "The name your agency calls it by, and where it is up to.",
        fields: [
          {
            name: "title",
            label: "a name",
            required: true,
            requiredMessage: "Give the cycle a name before you create it.",
          },
          { name: "status", label: "a status" },
        ],
        render: (flow) => (
          <>
            <GuidedFlowRow flow={flow} name="title" label="Cycle name">
              <Input {...flow.text("title")} placeholder="2050 Regional Transportation Plan" />
            </GuidedFlowRow>

            <GuidedFlowRow flow={flow} name="status" label="Where is it up to?">
              <select className={selectClassName} {...flow.text("status")}>
                {RTP_CYCLE_STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </GuidedFlowRow>
          </>
        ),
      },
      {
        id: "area",
        title: "Which area does the plan cover?",
        hint: "Search for the place and the label and map pin fill themselves. All of it is optional.",
        fields: [
          { name: "geographyLabel", label: "a plan area" },
          { name: "anchorLatitude", label: "a map pin latitude" },
          { name: "anchorLongitude", label: "a map pin longitude" },
        ],
        check: (values) => {
          const hasLatitude = values.anchorLatitude.trim().length > 0;
          const hasLongitude = values.anchorLongitude.trim().length > 0;
          // Both halves move together: the backdrop needs both to draw
          // anything, so a lone latitude silently renders nothing.
          if (hasLatitude !== hasLongitude) {
            return {
              field: hasLatitude ? "anchorLongitude" : "anchorLatitude",
              message: "Enter both a map pin latitude and longitude, or leave both blank.",
            };
          }
          if (
            hasLatitude &&
            (!Number.isFinite(Number(values.anchorLatitude)) ||
              !Number.isFinite(Number(values.anchorLongitude)))
          ) {
            return {
              field: "anchorLatitude",
              message: "The map pin latitude and longitude must be numbers.",
            };
          }
          return null;
        },
        render: (flow) => (
          <>
            <div className="space-y-1.5">
              <p className="text-[0.82rem] font-semibold">
                Find the plan area
                <span className="ml-1.5 text-[0.72rem] font-normal text-muted-foreground">
                  optional — fills the label and pin below
                </span>
              </p>
              <StudyAreaPicker
                corridorText={pickerCorridorText}
                onCorridorChange={setPickerCorridorText}
                onPlaceResolved={(place) => {
                  // A resolved place fills the label and the pin in one step.
                  // Both stay editable afterwards, and a hand-drawn area — which
                  // has no name — fills nothing.
                  if (!place) return;
                  // One patch, so a resolved place lands its label and both
                  // halves of the pin together rather than in three renders.
                  flow.setValues({
                    ...(place.label ? { geographyLabel: place.label } : {}),
                    anchorLatitude: ((place.bbox.minLat + place.bbox.maxLat) / 2).toFixed(5),
                    anchorLongitude: ((place.bbox.minLon + place.bbox.maxLon) / 2).toFixed(5),
                  });
                }}
                showRunEngineHint={false}
              />
            </div>

            <GuidedFlowRow
              flow={flow}
              name="geographyLabel"
              label="Geography label"
              hint="In your agency's own words. A resolved place fills this in, and you can edit it."
            >
              <Input
                {...flow.text("geographyLabel")}
                placeholder="Countywide, including unincorporated areas"
              />
            </GuidedFlowRow>

            <GuidedFlowRow flow={flow} name="anchorLatitude" label="Map pin latitude">
              <Input {...flow.text("anchorLatitude")} placeholder="39.26" />
            </GuidedFlowRow>

            <GuidedFlowRow flow={flow} name="anchorLongitude" label="Map pin longitude">
              <Input {...flow.text("anchorLongitude")} placeholder="-121.02" />
            </GuidedFlowRow>
          </>
        ),
      },
      {
        id: "dates",
        title: "What are the dates?",
        hint: "All optional, and easy to add from the cycle's own page later.",
        fields: [
          { name: "horizonStartYear", label: "a first year" },
          { name: "horizonEndYear", label: "a last year" },
          { name: "adoptionTargetDate", label: "an adoption target" },
          { name: "publicReviewOpenAt", label: "a review opening" },
          { name: "publicReviewCloseAt", label: "a review closing" },
          { name: "summary", label: "a summary" },
        ],
        check: (values) => {
          const start = values.horizonStartYear.trim();
          const end = values.horizonEndYear.trim();
          for (const [field, raw] of [
            ["horizonStartYear", start],
            ["horizonEndYear", end],
          ] as const) {
            if (!raw) continue;
            const year = Number(raw);
            if (!Number.isInteger(year) || year < 1900 || year > 2200) {
              return { field, message: "Give a year between 1900 and 2200, or leave it blank." };
            }
          }
          if (start && end && Number(end) < Number(start)) {
            return {
              field: "horizonEndYear",
              message: "The last year cannot come before the first year.",
            };
          }
          return null;
        },
        render: (flow) => (
          <>
            <GuidedFlowRow flow={flow} name="horizonStartYear" label="First horizon year">
              <Input {...flow.text("horizonStartYear")} type="number" placeholder="2028" />
            </GuidedFlowRow>

            <GuidedFlowRow flow={flow} name="horizonEndYear" label="Last horizon year">
              <Input {...flow.text("horizonEndYear")} type="number" placeholder="2048" />
            </GuidedFlowRow>

            <GuidedFlowRow flow={flow} name="adoptionTargetDate" label="Adoption target">
              <Input {...flow.text("adoptionTargetDate")} type="date" />
            </GuidedFlowRow>

            <GuidedFlowRow flow={flow} name="publicReviewOpenAt" label="Public review opens">
              <Input {...flow.text("publicReviewOpenAt")} type="datetime-local" />
            </GuidedFlowRow>

            <GuidedFlowRow flow={flow} name="publicReviewCloseAt" label="Public review closes">
              <Input {...flow.text("publicReviewCloseAt")} type="datetime-local" />
            </GuidedFlowRow>

            <GuidedFlowRow flow={flow} name="summary" label="Anything to note?">
              <Textarea
                {...flow.text("summary")}
                placeholder="What this plan cycle covers and what it has to deliver."
              />
            </GuidedFlowRow>
          </>
        ),
      },
    ],
    [pickerCorridorText]
  );

  const flow = useGuidedFlow<RtpCycleValues>({
    id: "create-rtp-cycle",
    title: "New plan cycle",
    submitLabel: "Create the cycle",
    initialValues: INITIAL_VALUES,
    steps,
    onSubmit: async (values) => {
      // Unchanged from the inline form, deliberately: same route, same keys,
      // same "" → undefined, same ISO conversion on the two review timestamps.
      const response = await fetch("/api/rtp-cycles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: values.title,
          status: values.status,
          geographyLabel: values.geographyLabel || undefined,
          horizonStartYear: values.horizonStartYear ? Number(values.horizonStartYear) : undefined,
          horizonEndYear: values.horizonEndYear ? Number(values.horizonEndYear) : undefined,
          adoptionTargetDate: values.adoptionTargetDate || undefined,
          publicReviewOpenAt: values.publicReviewOpenAt
            ? new Date(values.publicReviewOpenAt).toISOString()
            : undefined,
          publicReviewCloseAt: values.publicReviewCloseAt
            ? new Date(values.publicReviewCloseAt).toISOString()
            : undefined,
          summary: values.summary || undefined,
          anchorLatitude: values.anchorLatitude.trim() ? Number(values.anchorLatitude) : undefined,
          anchorLongitude: values.anchorLongitude.trim()
            ? Number(values.anchorLongitude)
            : undefined,
        }),
      });

      const payload = (await response.json()) as CreateResponse;
      if (!response.ok) {
        throw new Error(payload.error || "Failed to create RTP cycle");
      }

      setPickerCorridorText("");
      router.refresh();
    },
  });

  return (
    <article className="module-section-surface">
      <div className="module-section-header">
        <div className="module-section-heading">
          <p className="module-section-label">Create</p>
          <h2 className="module-section-title">New plan cycle</h2>
          <p className="module-section-description">
            A plan cycle is one edition of your long-range plan — the area it covers, the years it
            looks across, and the dates it has to hit.
          </p>
        </div>
        <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-sky-500/12 text-sky-700 dark:text-sky-300">
          <FilePlus2 className="h-5 w-5" />
        </span>
      </div>

      <div className="mt-5">
        <Button type="button" onClick={flow.open} data-testid="rtp-cycle-creator-open">
          <Plus className="mr-1.5 h-4 w-4" />
          New plan cycle
        </Button>
      </div>

      <GuidedFlow flow={flow} />
    </article>
  );
}
