"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  GuidedFlow,
  GuidedFlowRow,
  useGuidedFlow,
  type GuidedFlowStep,
} from "@/components/ui/guided-flow";

type CreateResponse = {
  projectRecordId?: string;
  workspaceId?: string;
};

const projectTypeOptions = [
  { value: "corridor_plan", label: "Corridor Plan" },
  { value: "active_transportation_plan", label: "Active Transportation Plan" },
  { value: "safety_plan", label: "Safety Plan" },
  { value: "regional_plan", label: "Regional / Program Plan" },
];

const deliveryPhaseOptions = [
  { value: "scoping", label: "Scoping" },
  { value: "analysis", label: "Analysis" },
  { value: "engagement", label: "Engagement" },
  { value: "programming", label: "Programming" },
  { value: "delivery", label: "Delivery" },
  { value: "complete", label: "Complete" },
];

const statusOptions = [
  { value: "draft", label: "Draft" },
  { value: "active", label: "Active" },
  { value: "on_hold", label: "On hold" },
  { value: "complete", label: "Complete" },
];

const selectClassName = "module-select";

type ProjectValues = {
  projectName: string;
  summary: string;
  planType: string;
  deliveryPhase: string;
  status: string;
};

const INITIAL_VALUES: ProjectValues = {
  projectName: "",
  summary: "",
  planType: "corridor_plan",
  deliveryPhase: "scoping",
  status: "active",
};

/**
 * Starting a project is two questions behind a button now, rather than five
 * fields open on the projects page.
 *
 * WHAT DID NOT CHANGE. Same POST to `/api/projects` with the same five keys,
 * all still sent RAW — a blank summary arrives as `""` here, as it always did.
 *
 * THE ERROR STILL PREFERS `details` OVER `error`. The projects route answers
 * with a specific `details` string beside a generic `error`, and showing the
 * generic one when the specific one exists tells a planner less than the server
 * was willing to say.
 *
 * IT STILL NAVIGATES ONLY WHEN THERE IS SOMEWHERE TO GO. `projectRecordId` is
 * optional in the response; without it the flow closes and the page refreshes
 * where it stands, rather than pushing to `/projects/undefined`.
 *
 * THE DISAMBIGUATION SURVIVES, and it is the reason this panel has a paragraph
 * at all: "workspace" means an OpenPlan tenant everywhere else in the product,
 * and this button does not make one. A planner who thinks it does creates a
 * project expecting an empty world and gets a record in the world they are in.
 */
export function ProjectWorkspaceCreator() {
  const router = useRouter();

  const steps = useMemo<GuidedFlowStep<ProjectValues>[]>(
    () => [
      {
        id: "identity",
        title: "What is the project?",
        hint: "A name your colleagues would recognise, and what it is in one or two sentences.",
        fields: [
          {
            name: "projectName",
            label: "a name",
            required: true,
            requiredMessage: "Give the project a name before you start it.",
          },
          { name: "summary", label: "a summary" },
        ],
        render: (flow) => (
          <>
            <GuidedFlowRow flow={flow} name="projectName" label="Project name">
              <Input {...flow.text("projectName")} placeholder="Ridge Road safety improvements" />
            </GuidedFlowRow>

            <GuidedFlowRow
              flow={flow}
              name="summary"
              label="What is it?"
              hint="Optional. One or two sentences is plenty."
            >
              <Textarea
                {...flow.text("summary")}
                placeholder="What this project is doing, where, and what it should change."
              />
            </GuidedFlowRow>
          </>
        ),
      },
      {
        id: "shape",
        title: "What kind of work is it, and where is it up to?",
        hint: "All three can change at any time.",
        fields: [
          { name: "planType", label: "a project type" },
          { name: "deliveryPhase", label: "a phase" },
          { name: "status", label: "a status" },
        ],
        render: (flow) => (
          <>
            <GuidedFlowRow flow={flow} name="planType" label="What kind of project?">
              <select className={selectClassName} {...flow.text("planType")}>
                {projectTypeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </GuidedFlowRow>

            <GuidedFlowRow flow={flow} name="deliveryPhase" label="What stage is it at?">
              <select className={selectClassName} {...flow.text("deliveryPhase")}>
                {deliveryPhaseOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </GuidedFlowRow>

            <GuidedFlowRow flow={flow} name="status" label="Is it running?">
              <select className={selectClassName} {...flow.text("status")}>
                {statusOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </GuidedFlowRow>
          </>
        ),
      },
    ],
    []
  );

  const flow = useGuidedFlow<ProjectValues>({
    id: "create-project",
    title: "Start a project",
    submitLabel: "Start the project",
    initialValues: INITIAL_VALUES,
    steps,
    onSubmit: async (values) => {
      // Unchanged from the inline form, deliberately: same route, same five
      // keys, all still raw.
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          projectName: values.projectName,
          summary: values.summary,
          planType: values.planType,
          deliveryPhase: values.deliveryPhase,
          status: values.status,
        }),
      });

      const payload = (await response.json()) as CreateResponse & {
        error?: string;
        details?: string;
      };

      if (!response.ok) {
        // `details` first: the route says something specific beside its generic
        // `error`, and showing the generic one tells a planner less than the
        // server was willing to say.
        throw new Error(payload.details || payload.error || "Failed to create project");
      }

      router.refresh();
      if (payload.projectRecordId) {
        router.push(`/projects/${payload.projectRecordId}`);
      }
    },
  });

  return (
    <article className="module-section-surface">
      <div className="module-section-header">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
            <Plus className="h-5 w-5" />
          </span>
          <div className="module-section-heading">
            <p className="module-section-label">Create</p>
            <h2 className="module-section-title">Start a project</h2>
          </div>
        </div>
      </div>

      <p className="module-section-description">
        This adds a project to the workspace you are in now, so its analysis, reports, and records all live together.
        It does not create a new workspace.
      </p>

      <div className="mt-5">
        <Button type="button" onClick={flow.open} data-testid="project-workspace-creator-open">
          <Plus className="mr-1.5 h-4 w-4" />
          Start a project
        </Button>
      </div>

      <GuidedFlow flow={flow} />
    </article>
  );
}
