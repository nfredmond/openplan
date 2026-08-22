"use client";

import { useMemo } from "react";
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
import { PLAN_STATUS_OPTIONS, PLAN_TYPE_OPTIONS } from "@/lib/plans/catalog";

type ProjectOption = {
  id: string;
  workspace_id: string;
  name: string;
};

type CreateResponse = {
  planId: string;
  error?: string;
};

const selectClassName = "module-select";

type PlanCreatorValues = {
  title: string;
  planType: (typeof PLAN_TYPE_OPTIONS)[number]["value"];
  status: (typeof PLAN_STATUS_OPTIONS)[number]["value"];
  projectId: string;
  geographyLabel: string;
  horizonYear: string;
  summary: string;
};

const INITIAL_VALUES: PlanCreatorValues = {
  title: "",
  planType: "corridor",
  status: "draft",
  projectId: "",
  geographyLabel: "",
  horizonYear: "",
  summary: "",
};

/**
 * Starting a plan used to mean seven fields sitting open on the plans page,
 * between a planner and the list of plans they came to read. It is three short
 * questions behind a button now.
 *
 * WHAT DID NOT CHANGE. Every field, and the same POST to `/api/plans` with the
 * same keys — including `"" → undefined`, so a blank optional field is still
 * ABSENT rather than an empty string, and `horizonYear` is still a number or
 * nothing. A conversion that quietly started sending `""` would write empty
 * strings into columns that currently hold null.
 *
 * THE HORIZON YEAR IS CHECKED HERE, WHICH THE INLINE FORM DID NOT DO. It was a
 * `type="number"` input with `min`/`max` attributes, and those only bind native
 * form validation — which a guided flow's submit does not go through. Typing
 * `20355` sent 20355 to the API. The bounds now live in the step's `check`, so
 * they are enforced by the thing that actually submits.
 */
export function PlanCreator({ projects }: { projects: ProjectOption[] }) {
  const router = useRouter();

  const steps = useMemo<GuidedFlowStep<PlanCreatorValues>[]>(
    () => [
      {
        id: "identity",
        title: "What is this plan?",
        hint: "A name your colleagues would recognise, and what kind of plan it is.",
        fields: [
          {
            name: "title",
            label: "a name",
            required: true,
            requiredMessage: "Give the plan a name before you create it.",
          },
          { name: "planType", label: "a plan type" },
          { name: "status", label: "a status" },
        ],
        render: (flow) => (
          <>
            <GuidedFlowRow flow={flow} name="title" label="Name">
              <Input {...flow.text("title")} placeholder="Downtown safety action plan" />
            </GuidedFlowRow>

            <GuidedFlowRow flow={flow} name="planType" label="What kind of plan is it?">
              <select className={selectClassName} {...flow.text("planType")}>
                {PLAN_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </GuidedFlowRow>

            <GuidedFlowRow
              flow={flow}
              name="status"
              label="Where is it up to?"
              hint="You can change this any time."
            >
              <select className={selectClassName} {...flow.text("status")}>
                {PLAN_STATUS_OPTIONS.map((option) => (
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
        id: "place",
        title: "What does it cover?",
        hint: "Both optional. Linking a project now means the project page can find this plan later.",
        fields: [
          { name: "projectId", label: "a project" },
          { name: "geographyLabel", label: "the area it covers" },
          { name: "horizonYear", label: "a horizon year" },
        ],
        check: (values) => {
          const raw = values.horizonYear.trim();
          if (!raw) return null;
          const year = Number(raw);
          // The inline form expressed these as min/max on a number input, which
          // only native form validation reads — and the flow's submit does not
          // go through it. Checked here so the bound is real.
          if (!Number.isInteger(year) || year < 1900 || year > 2200) {
            return {
              field: "horizonYear",
              message: "Give a horizon year between 1900 and 2200, or leave it blank.",
            };
          }
          return null;
        },
        render: (flow) => (
          <>
            <GuidedFlowRow flow={flow} name="projectId" label="Primary project">
              <select className={selectClassName} {...flow.text("projectId")}>
                <option value="">No linked project</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </GuidedFlowRow>

            <GuidedFlowRow
              flow={flow}
              name="geographyLabel"
              label="Which area does it cover?"
              hint="Optional. In your own words — a corridor, a downtown, a whole county."
            >
              <Input
                {...flow.text("geographyLabel")}
                placeholder="Downtown core / main street corridor"
              />
            </GuidedFlowRow>

            <GuidedFlowRow
              flow={flow}
              name="horizonYear"
              label="What year does it look ahead to?"
              hint="Optional."
            >
              <Input {...flow.text("horizonYear")} type="number" placeholder="2035" />
            </GuidedFlowRow>
          </>
        ),
      },
      {
        id: "summary",
        title: "Anything to note?",
        hint: "Optional, and easy to add later from the plan's own page.",
        fields: [{ name: "summary", label: "a summary" }],
        render: (flow) => (
          <GuidedFlowRow flow={flow} name="summary" label="Summary">
            <Textarea
              {...flow.text("summary")}
              placeholder="What this plan covers, for which area, and what decision it should lead to."
            />
          </GuidedFlowRow>
        ),
      },
    ],
    [projects]
  );

  const flow = useGuidedFlow<PlanCreatorValues>({
    id: "create-plan",
    title: "New plan",
    submitLabel: "Create the plan",
    initialValues: INITIAL_VALUES,
    steps,
    onSubmit: async (values) => {
      // Unchanged from the inline form, deliberately: same route, same keys,
      // same "" → undefined so a blank optional field stays absent.
      const response = await fetch("/api/plans", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: values.projectId || undefined,
          title: values.title,
          planType: values.planType,
          status: values.status,
          geographyLabel: values.geographyLabel || undefined,
          horizonYear: values.horizonYear ? Number(values.horizonYear) : undefined,
          summary: values.summary || undefined,
        }),
      });

      const payload = (await response.json()) as CreateResponse;
      if (!response.ok) {
        throw new Error(payload.error || "Failed to create plan");
      }

      router.refresh();
      router.push(`/plans/${payload.planId}`);
    },
  });

  return (
    <article className="module-section-surface">
      <div className="module-section-header">
        <div className="module-section-heading">
          <p className="module-section-label">Create</p>
          <h2 className="module-section-title">New plan</h2>
          <p className="module-section-description">
            A plan record is where one piece of planning work lives: what it covers, what it is
            attached to, and the scenarios, engagement and reports it gathers. Three short
            questions — the rest can wait until you are on its page.
          </p>
        </div>
        <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-amber-500/12 text-amber-700 dark:text-amber-300">
          <FilePlus2 className="h-5 w-5" />
        </span>
      </div>

      <div className="mt-5">
        <Button type="button" onClick={flow.open} data-testid="plan-creator-open">
          <Plus className="mr-1.5 h-4 w-4" />
          New plan
        </Button>
      </div>

      <GuidedFlow flow={flow} />
    </article>
  );
}
