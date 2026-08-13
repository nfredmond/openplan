"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { Database, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  GuidedFlow,
  GuidedFlowRow,
  useGuidedFlow,
  type GuidedFlowStep,
} from "@/components/ui/guided-flow";
import { MODEL_FAMILY_OPTIONS, MODEL_STATUS_OPTIONS } from "@/lib/models/catalog";

type ProjectOption = {
  id: string;
  name: string;
};

type ScenarioSetOption = {
  id: string;
  title: string;
};

type CreateResponse = {
  modelId: string;
  error?: string;
};

const selectClassName = "module-select";

type ModelCreatorValues = {
  title: string;
  summary: string;
  projectId: string;
  scenarioSetId: string;
  modelFamily: (typeof MODEL_FAMILY_OPTIONS)[number]["value"];
  status: (typeof MODEL_STATUS_OPTIONS)[number]["value"];
  configVersion: string;
  ownerLabel: string;
  horizonLabel: string;
  assumptionsSummary: string;
  inputSummary: string;
  outputSummary: string;
};

const INITIAL_VALUES: ModelCreatorValues = {
  title: "",
  summary: "",
  projectId: "",
  scenarioSetId: "",
  modelFamily: "travel_demand",
  status: "draft",
  configVersion: "",
  ownerLabel: "",
  horizonLabel: "",
  assumptionsSummary: "",
  inputSummary: "",
  outputSummary: "",
};

/**
 * Making a model record used to mean reading ten fields and an "advanced"
 * drawer before you could get to the list of models you came for. It is four
 * short questions behind a button now.
 *
 * WHAT DID NOT CHANGE. Every field, the same POST to `/api/models` with the
 * same body — `""` still becomes `undefined`, so a blank optional field is
 * still absent rather than empty — and the same two disclosures below.
 *
 * WHY THE DISCLOSURES MOVED WITH THE PICKERS. An option list that could not be
 * read arrives here as `[]`, exactly like a workspace that genuinely has no
 * projects, and a `<select>` renders both as the same empty dropdown under "No
 * primary project". That is a false absence on a DECISION surface: the planner
 * concludes there is nothing to link to and creates a model with no project
 * basis, which the catalog then reports as a readiness gap they cannot explain.
 * The sentence has to be beside the picker, so it lives on the picker's step.
 * The picker is never disabled for it — disclosure, not restriction.
 */
export function ModelCreator({
  projects,
  scenarioSets,
  projectsReadFailed = false,
  scenarioSetsReadFailed = false,
}: {
  projects: ProjectOption[];
  scenarioSets: ScenarioSetOption[];
  projectsReadFailed?: boolean;
  scenarioSetsReadFailed?: boolean;
}) {
  const router = useRouter();

  const steps = useMemo<GuidedFlowStep<ModelCreatorValues>[]>(
    () => [
      {
        id: "purpose",
        title: "What is this model for?",
        hint: "Give it a name your colleagues would recognise, and say what decision it should help with.",
        fields: [
          { name: "title", label: "a name", required: true, requiredMessage: "Give the model a name before you create it." },
          { name: "summary", label: "what it is for" },
        ],
        render: (flow) => (
          <>
            <GuidedFlowRow flow={flow} name="title" label="Name">
              <Input {...flow.text("title")} placeholder="Countywide 2045 travel demand model" />
            </GuidedFlowRow>
            <GuidedFlowRow
              flow={flow}
              name="summary"
              label="What is it for?"
              hint="Optional. One or two sentences is plenty."
            >
              <Textarea
                {...flow.text("summary")}
                placeholder="What this model is for, and what planning decision it should support."
              />
            </GuidedFlowRow>
          </>
        ),
      },
      {
        id: "anchor",
        title: "What work does it belong to?",
        hint: "Both are optional. Linking it now means the project page can find the model later.",
        fields: [
          { name: "projectId", label: "a project" },
          { name: "scenarioSetId", label: "a scenario set" },
        ],
        render: (flow) => (
          <>
            <GuidedFlowRow flow={flow} name="projectId" label="Primary project">
              <select className={selectClassName} {...flow.text("projectId")}>
                <option value="">No primary project</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
              {projectsReadFailed ? (
                <p
                  className="text-[0.72rem] text-amber-700 dark:text-amber-300"
                  data-testid="model-creator-projects-unreadable"
                >
                  This workspace&apos;s project list could not be read, so this picker may be
                  missing projects. An empty list here does not mean there are none.
                </p>
              ) : null}
            </GuidedFlowRow>

            <GuidedFlowRow flow={flow} name="scenarioSetId" label="Primary scenario set">
              <select className={selectClassName} {...flow.text("scenarioSetId")}>
                <option value="">No primary scenario set</option>
                {scenarioSets.map((scenarioSet) => (
                  <option key={scenarioSet.id} value={scenarioSet.id}>
                    {scenarioSet.title}
                  </option>
                ))}
              </select>
              {scenarioSetsReadFailed ? (
                <p
                  className="text-[0.72rem] text-amber-700 dark:text-amber-300"
                  data-testid="model-creator-scenario-sets-unreadable"
                >
                  This workspace&apos;s scenario sets could not be read, so this picker may be
                  missing sets. An empty list here does not mean there are none.
                </p>
              ) : null}
            </GuidedFlowRow>
          </>
        ),
      },
      {
        id: "kind",
        title: "What kind of model is it?",
        hint: "You can change both of these later.",
        fields: [
          { name: "modelFamily", label: "a model family" },
          { name: "status", label: "a status" },
        ],
        render: (flow) => (
          <>
            <GuidedFlowRow flow={flow} name="modelFamily" label="Model family">
              <select className={selectClassName} {...flow.text("modelFamily")}>
                {MODEL_FAMILY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </GuidedFlowRow>
            <GuidedFlowRow
              flow={flow}
              name="status"
              label="Status"
              hint="Where this model is in its life — a draft you are setting up, or something people can rely on."
            >
              <select className={selectClassName} {...flow.text("status")}>
                {MODEL_STATUS_OPTIONS.map((option) => (
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
        id: "provenance",
        title: "Anything worth writing down for later?",
        hint: "All optional. It is the sort of thing you will wish somebody had written down in two years.",
        fields: [
          { name: "configVersion", label: "a config version" },
          { name: "ownerLabel", label: "who runs it" },
          { name: "horizonLabel", label: "a horizon year" },
          { name: "assumptionsSummary", label: "assumptions" },
          { name: "inputSummary", label: "inputs" },
          { name: "outputSummary", label: "outputs" },
        ],
        render: (flow) => (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <GuidedFlowRow flow={flow} name="configVersion" label="Config version">
                <Input {...flow.text("configVersion")} placeholder="abm-v1.3 / demand-2045-r02" />
              </GuidedFlowRow>
              <GuidedFlowRow flow={flow} name="ownerLabel" label="Who runs it">
                <Input {...flow.text("ownerLabel")} placeholder="Modeling team / operator" />
              </GuidedFlowRow>
            </div>
            <GuidedFlowRow flow={flow} name="horizonLabel" label="Horizon year or analysis window">
              <Input {...flow.text("horizonLabel")} placeholder="2045 adopted RTP horizon" />
            </GuidedFlowRow>
            <GuidedFlowRow
              flow={flow}
              name="assumptionsSummary"
              label="Assumptions"
              hint="What the model takes as given — how it was calibrated, which policies are baked in, anything that would surprise a reader."
            >
              <Textarea
                {...flow.text("assumptionsSummary")}
                placeholder="Calibration basis, scenario knobs, policy assumptions, or configuration caveats."
              />
            </GuidedFlowRow>
            <div className="grid gap-4 sm:grid-cols-2">
              <GuidedFlowRow flow={flow} name="inputSummary" label="What goes in">
                <Textarea
                  {...flow.text("inputSummary")}
                  placeholder="Networks, land use, demand inputs, policy knobs, or linked dataset basis."
                />
              </GuidedFlowRow>
              <GuidedFlowRow flow={flow} name="outputSummary" label="What should come out">
                <Textarea
                  {...flow.text("outputSummary")}
                  placeholder="What outputs should exist, where they are cited, and what is still pending."
                />
              </GuidedFlowRow>
            </div>
          </>
        ),
      },
    ],
    [projects, projectsReadFailed, scenarioSets, scenarioSetsReadFailed]
  );

  const flow = useGuidedFlow<ModelCreatorValues>({
    id: "create-model",
    title: "New model record",
    submitLabel: "Create the model record",
    initialValues: INITIAL_VALUES,
    steps,
    onSubmit: async (values) => {
      // Unchanged from the inline form, deliberately: same route, same keys,
      // same "" → undefined so a blank optional field stays absent.
      const response = await fetch("/api/models", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: values.title,
          projectId: values.projectId || undefined,
          scenarioSetId: values.scenarioSetId || undefined,
          modelFamily: values.modelFamily,
          status: values.status,
          configVersion: values.configVersion || undefined,
          ownerLabel: values.ownerLabel || undefined,
          horizonLabel: values.horizonLabel || undefined,
          summary: values.summary || undefined,
          assumptionsSummary: values.assumptionsSummary || undefined,
          inputSummary: values.inputSummary || undefined,
          outputSummary: values.outputSummary || undefined,
        }),
      });

      const payload = (await response.json()) as CreateResponse;
      if (!response.ok) {
        throw new Error(payload.error || "Failed to create model");
      }

      router.refresh();
      router.push(`/models/${payload.modelId}`);
    },
  });

  return (
    <article className="module-section-surface">
      <div className="module-section-header">
        <div className="module-section-heading">
          <p className="module-section-label">Create</p>
          <h2 className="module-section-title">New managed model record</h2>
          <p className="module-section-description">
            A model record is the folder everything about one model lives in: what it is for, what
            it is attached to, and the runs it produces. Four short questions and you are done — you
            can fill in the rest on its page afterwards.
          </p>
        </div>
        <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-sky-500/12 text-sky-700 dark:text-sky-300">
          <Database className="h-5 w-5" />
        </span>
      </div>

      <div className="mt-5">
        <Button type="button" onClick={flow.open} data-testid="model-creator-open">
          <Plus className="mr-1.5 h-4 w-4" />
          New model record
        </Button>
      </div>

      <GuidedFlow flow={flow} />
    </article>
  );
}
