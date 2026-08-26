"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { FilePlus2, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/ui/state-block";
import { selectInitialPlanningProjectId } from "@/lib/projects/planning-context";
import {
  GuidedFlow,
  GuidedFlowRow,
  useGuidedFlow,
  type GuidedFlowStep,
} from "@/components/ui/guided-flow";

type ProjectOption = {
  id: string;
  workspace_id: string;
  name: string;
};

type CreateResponse = {
  scenarioSetId: string;
  error?: string;
};

const selectClassName = "module-select";

type ScenarioSetValues = {
  projectId: string;
  title: string;
  summary: string;
  planningQuestion: string;
};

/**
 * A scenario set used to open as a four-field form on the scenarios page. It is
 * two short questions behind a button now — starting with the one the planner
 * actually has in their head, which is what they are trying to find out.
 *
 * WHAT DID NOT CHANGE, INCLUDING SOMETHING THAT LOOKS LIKE A BUG.
 * `summary` and `planningQuestion` are still sent RAW, so a blank one arrives
 * as `""` rather than absent. The plan creator beside this one sends
 * `|| undefined`; this one never did, and "tidying" it here would be an
 * unrequested change to what lands in the database, made under cover of a
 * layout conversion. A conversion changes the shape of the asking and nothing
 * else. If the difference is wrong it is worth fixing deliberately, in a change
 * that says so.
 *
 * THE TWO DISCLOSURES SURVIVE, AND THEY GATE THE BUTTON RATHER THAN A FORM.
 * `projectsUnreadable` means the project list is empty because the read FAILED,
 * not because the workspace has none — answering that with "create a project
 * first" both states something about the workspace and sends a planner to make
 * a duplicate of a project they already have.
 */
export function ScenarioSetCreator({
  projects,
  projectsUnreadable = false,
  initialProjectId = null,
}: {
  projects: ProjectOption[];
  projectsUnreadable?: boolean;
  initialProjectId?: string | null;
}) {
  const router = useRouter();
  const validInitialProjectId = selectInitialPlanningProjectId(projects, initialProjectId, "first");

  const steps = useMemo<GuidedFlowStep<ScenarioSetValues>[]>(
    () => [
      {
        id: "question",
        title: "What are you trying to find out?",
        hint: "The question this set of scenarios should answer. You can change it later.",
        fields: [
          {
            name: "title",
            label: "a name",
            required: true,
            requiredMessage: "Give the scenario set a name before you create it.",
          },
          { name: "planningQuestion", label: "the question" },
        ],
        render: (flow) => (
          <>
            <GuidedFlowRow flow={flow} name="title" label="Name">
              <Input {...flow.text("title")} placeholder="2026 safety package alternatives" />
            </GuidedFlowRow>

            <GuidedFlowRow
              flow={flow}
              name="planningQuestion"
              label="What decision should it help with?"
              hint="Optional. In plain words — what would you like to be able to say at the end?"
            >
              <Textarea
                {...flow.text("planningQuestion")}
                placeholder="Which trade-off, decision, or policy question should this set answer?"
              />
            </GuidedFlowRow>
          </>
        ),
      },
      {
        id: "anchor",
        title: "Which project is it for?",
        hint: "A scenario set stays attached to one project.",
        fields: [
          {
            name: "projectId",
            label: "a project",
            required: true,
            requiredMessage: "Choose the project this scenario set belongs to.",
          },
          { name: "summary", label: "a summary" },
        ],
        render: (flow) => (
          <>
            <GuidedFlowRow flow={flow} name="projectId" label="Project">
              <select className={selectClassName} {...flow.text("projectId")}>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </GuidedFlowRow>

            <GuidedFlowRow
              flow={flow}
              name="summary"
              label="Anything to note?"
              hint="Optional."
            >
              <Textarea
                {...flow.text("summary")}
                placeholder="What is this scenario set comparing?"
              />
            </GuidedFlowRow>
          </>
        ),
      },
    ],
    [projects]
  );

  const flow = useGuidedFlow<ScenarioSetValues>({
    id: "create-scenario-set",
    title: "New scenario set",
    submitLabel: "Create the scenario set",
    initialValues: {
      projectId: validInitialProjectId,
      title: "",
      summary: "",
      planningQuestion: "",
    },
    steps,
    onSubmit: async (values) => {
      // Unchanged from the inline form, deliberately: same route, same keys,
      // and `summary`/`planningQuestion` still sent raw — see the note above.
      const response = await fetch("/api/scenarios", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: values.projectId,
          title: values.title,
          summary: values.summary,
          planningQuestion: values.planningQuestion,
        }),
      });

      const payload = (await response.json()) as CreateResponse;
      if (!response.ok) {
        throw new Error(payload.error || "Failed to create scenario set");
      }

      router.refresh();
      router.push(`/scenarios/${payload.scenarioSetId}`);
    },
  });

  return (
    <article className="module-section-surface">
      <div className="module-section-header">
        <div className="module-section-heading">
          <p className="module-section-label">Create</p>
          <h2 className="module-section-title">New scenario set</h2>
          <p className="module-section-description">
            A scenario set is a question and the options you are weighing against it — a baseline
            and the alternatives beside it, kept together so the comparison is reproducible.
          </p>
        </div>
        <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-amber-500/12 text-amber-700 dark:text-amber-300">
          <FilePlus2 className="h-5 w-5" />
        </span>
      </div>

      {projectsUnreadable ? (
        <div className="mt-5">
          <EmptyState
            title="Projects could not be read"
            description="This workspace's project list could not be loaded, so no project can be offered here. That is a failed read, not a workspace without projects — do not create a duplicate project on the strength of it."
            compact
          />
        </div>
      ) : projects.length === 0 ? (
        <div className="mt-5">
          <EmptyState
            title="No projects available"
            description="Create a project before opening a scenario set. Scenario sets stay anchored to a real project container."
            compact
          />
        </div>
      ) : (
        <>
          <div className="mt-5">
            <Button type="button" onClick={flow.open} data-testid="scenario-set-creator-open">
              <Plus className="mr-1.5 h-4 w-4" />
              New scenario set
            </Button>
          </div>
          <GuidedFlow flow={flow} />
        </>
      )}
    </article>
  );
}
