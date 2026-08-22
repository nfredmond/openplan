"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { ClipboardPlus, Plus } from "lucide-react";

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
  PROGRAM_FUNDING_CLASSIFICATION_OPTIONS,
  PROGRAM_STATUS_OPTIONS,
  PROGRAM_TYPE_OPTIONS,
} from "@/lib/programs/catalog";

type ProjectOption = {
  id: string;
  workspace_id: string;
  name: string;
};

type CreateResponse = {
  programId: string;
  error?: string;
};

const selectClassName = "module-select";

/** Blank or unparseable becomes absent, exactly as the inline form did. */
function toIsoDateTime(value: string): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

type ProgramValues = {
  title: string;
  cycleName: string;
  programType: (typeof PROGRAM_TYPE_OPTIONS)[number]["value"];
  status: (typeof PROGRAM_STATUS_OPTIONS)[number]["value"];
  fundingClassification: (typeof PROGRAM_FUNDING_CLASSIFICATION_OPTIONS)[number]["value"];
  projectId: string;
  sponsorAgency: string;
  ownerLabel: string;
  cadenceLabel: string;
  fiscalYearStart: string;
  fiscalYearEnd: string;
  nominationDueAt: string;
  adoptionTargetAt: string;
  summary: string;
};

/**
 * Fourteen fields used to occupy a whole column of the programs page before a
 * planner could reach the programs themselves. Four short steps behind a button
 * now, and the column is the page's again.
 *
 * WHAT DID NOT CHANGE. Same POST to `/api/programs`, same keys, same
 * `"" → undefined` on the optional text, same `Number()` on the fiscal years,
 * and `toIsoDateTime` still turns a blank OR an unparseable date into absent
 * rather than into an invalid string.
 *
 * `cycleName` AND `fundingClassification` ARE STILL SENT RAW, like the scenario
 * creator's blanks — the inline form never guarded them and a layout conversion
 * is not the place to start. `cycleName` is required anyway, so in practice it
 * is never the empty string; `fundingClassification` always holds a real option.
 *
 * THE FISCAL YEARS ARE CHECKED HERE, which the inline form only asked the
 * browser to do. They were `type="number"` inputs, and native validation does
 * not run for a flow's submit — so an end year before the start year, or a year
 * outside any plausible range, reached the API.
 */
export function ProgramCreator({ projects }: { projects: ProjectOption[] }) {
  const router = useRouter();

  const steps = useMemo<GuidedFlowStep<ProgramValues>[]>(
    () => [
      {
        id: "identity",
        title: "What is this program?",
        hint: "The package name and the funding cycle it belongs to.",
        fields: [
          {
            name: "title",
            label: "a name",
            required: true,
            requiredMessage: "Give the program a name before you create it.",
          },
          {
            name: "cycleName",
            label: "a cycle",
            required: true,
            requiredMessage: "Say which funding cycle this program belongs to.",
          },
          { name: "fundingClassification", label: "a funding classification" },
        ],
        render: (flow) => (
          <>
            <GuidedFlowRow flow={flow} name="title" label="Name">
              <Input
                {...flow.text("title")}
                placeholder="2027 RTIP downtown active transportation package"
              />
            </GuidedFlowRow>

            <GuidedFlowRow
              flow={flow}
              name="cycleName"
              label="Which funding cycle?"
              hint="The cycle this package is being put forward in."
            >
              <Input {...flow.text("cycleName")} placeholder="2027 RTIP" />
            </GuidedFlowRow>

            <GuidedFlowRow flow={flow} name="fundingClassification" label="How is it funded?">
              <select className={selectClassName} {...flow.text("fundingClassification")}>
                {PROGRAM_FUNDING_CLASSIFICATION_OPTIONS.map((option) => (
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
        id: "kind",
        title: "What kind of program, and where is it up to?",
        hint: "Both can change later.",
        fields: [
          { name: "programType", label: "a program type" },
          { name: "status", label: "a status" },
          { name: "projectId", label: "a project" },
        ],
        render: (flow) => (
          <>
            <GuidedFlowRow flow={flow} name="programType" label="Program type">
              <select className={selectClassName} {...flow.text("programType")}>
                {PROGRAM_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </GuidedFlowRow>

            <GuidedFlowRow flow={flow} name="status" label="Where is it up to?">
              <select className={selectClassName} {...flow.text("status")}>
                {PROGRAM_STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </GuidedFlowRow>

            <GuidedFlowRow
              flow={flow}
              name="projectId"
              label="Primary project"
              hint="Optional. Linking it now means the project page can find this program later."
            >
              <select className={selectClassName} {...flow.text("projectId")}>
                <option value="">No linked project</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </GuidedFlowRow>
          </>
        ),
      },
      {
        id: "who",
        title: "Who runs it?",
        hint: "All optional.",
        fields: [
          { name: "sponsorAgency", label: "a sponsor" },
          { name: "ownerLabel", label: "an owner" },
          { name: "cadenceLabel", label: "a cadence" },
        ],
        render: (flow) => (
          <>
            <GuidedFlowRow flow={flow} name="sponsorAgency" label="Which agency sponsors it?">
              <Input {...flow.text("sponsorAgency")} placeholder="Agency sponsoring this program" />
            </GuidedFlowRow>

            <GuidedFlowRow flow={flow} name="ownerLabel" label="Who owns it here?">
              <Input {...flow.text("ownerLabel")} placeholder="Regional funding lead" />
            </GuidedFlowRow>

            <GuidedFlowRow flow={flow} name="cadenceLabel" label="How often does it run?">
              <Input {...flow.text("cadenceLabel")} placeholder="Biennial statewide cycle" />
            </GuidedFlowRow>
          </>
        ),
      },
      {
        id: "dates",
        title: "What are the dates?",
        hint: "All optional, and easy to add later.",
        fields: [
          { name: "fiscalYearStart", label: "a first year" },
          { name: "fiscalYearEnd", label: "a last year" },
          { name: "nominationDueAt", label: "a nomination deadline" },
          { name: "adoptionTargetAt", label: "an adoption target" },
          { name: "summary", label: "a summary" },
        ],
        check: (values) => {
          const start = values.fiscalYearStart.trim();
          const end = values.fiscalYearEnd.trim();
          // The inline form asked the BROWSER to bound these, via min/max on a
          // number input. A flow's submit does not run native validation, so
          // the bound has to live where the submit can see it.
          for (const [field, raw] of [
            ["fiscalYearStart", start],
            ["fiscalYearEnd", end],
          ] as const) {
            if (!raw) continue;
            const year = Number(raw);
            if (!Number.isInteger(year) || year < 1900 || year > 2200) {
              return { field, message: "Give a year between 1900 and 2200, or leave it blank." };
            }
          }
          if (start && end && Number(end) < Number(start)) {
            return {
              field: "fiscalYearEnd",
              message: "The last year cannot come before the first year.",
            };
          }
          return null;
        },
        render: (flow) => (
          <>
            <GuidedFlowRow flow={flow} name="fiscalYearStart" label="First fiscal year">
              <Input {...flow.text("fiscalYearStart")} type="number" placeholder="2027" />
            </GuidedFlowRow>

            <GuidedFlowRow flow={flow} name="fiscalYearEnd" label="Last fiscal year">
              <Input {...flow.text("fiscalYearEnd")} type="number" placeholder="2030" />
            </GuidedFlowRow>

            <GuidedFlowRow flow={flow} name="nominationDueAt" label="Nominations due">
              <Input {...flow.text("nominationDueAt")} type="datetime-local" />
            </GuidedFlowRow>

            <GuidedFlowRow flow={flow} name="adoptionTargetAt" label="Adoption target">
              <Input {...flow.text("adoptionTargetAt")} type="datetime-local" />
            </GuidedFlowRow>

            <GuidedFlowRow flow={flow} name="summary" label="Anything to note?">
              <Textarea
                {...flow.text("summary")}
                placeholder="What this package is for, how ready it is, and what should back it up."
              />
            </GuidedFlowRow>
          </>
        ),
      },
    ],
    [projects]
  );

  const flow = useGuidedFlow<ProgramValues>({
    id: "create-program",
    title: "New program",
    submitLabel: "Create the program",
    initialValues: {
      title: "",
      cycleName: "",
      programType: "rtip",
      status: "draft",
      fundingClassification: PROGRAM_FUNDING_CLASSIFICATION_OPTIONS[0].value,
      projectId: "",
      sponsorAgency: "",
      ownerLabel: "",
      cadenceLabel: "",
      fiscalYearStart: "",
      fiscalYearEnd: "",
      nominationDueAt: "",
      adoptionTargetAt: "",
      summary: "",
    },
    steps,
    onSubmit: async (values) => {
      // Unchanged from the inline form, deliberately: same route, same keys,
      // and `cycleName`/`fundingClassification` still sent raw.
      const response = await fetch("/api/programs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: values.projectId || undefined,
          title: values.title,
          programType: values.programType,
          status: values.status,
          cycleName: values.cycleName,
          fundingClassification: values.fundingClassification,
          sponsorAgency: values.sponsorAgency || undefined,
          ownerLabel: values.ownerLabel || undefined,
          cadenceLabel: values.cadenceLabel || undefined,
          fiscalYearStart: values.fiscalYearStart ? Number(values.fiscalYearStart) : undefined,
          fiscalYearEnd: values.fiscalYearEnd ? Number(values.fiscalYearEnd) : undefined,
          nominationDueAt: toIsoDateTime(values.nominationDueAt),
          adoptionTargetAt: toIsoDateTime(values.adoptionTargetAt),
          summary: values.summary || undefined,
        }),
      });

      const payload = (await response.json()) as CreateResponse;
      if (!response.ok) {
        throw new Error(payload.error || "Failed to create program");
      }

      router.refresh();
      router.push(`/programs/${payload.programId}`);
    },
  });

  return (
    <article className="module-section-surface">
      <div className="module-section-header">
        <div className="module-section-heading">
          <p className="module-section-label">Create</p>
          <h2 className="module-section-title">New program</h2>
          <p className="module-section-description">
            A program is a package of projects put forward together in one funding cycle — what is
            in it, who sponsors it, and when it has to be nominated and adopted.
          </p>
        </div>
        <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-emerald-500/12 text-emerald-700 dark:text-emerald-300">
          <ClipboardPlus className="h-5 w-5" />
        </span>
      </div>

      <div className="mt-5">
        <Button type="button" onClick={flow.open} data-testid="program-creator-open">
          <Plus className="mr-1.5 h-4 w-4" />
          New program
        </Button>
      </div>

      <GuidedFlow flow={flow} />
    </article>
  );
}
