"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus2, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  GuidedFlow,
  GuidedFlowRow,
  useGuidedFlow,
  type GuidedFlowStep,
} from "@/components/ui/guided-flow";
import { FUNDING_OPPORTUNITY_STATUS_OPTIONS } from "@/lib/programs/catalog";

type ProgramOption = {
  id: string;
  title: string;
};

type ProjectOption = {
  id: string;
  name: string;
};

const selectClassName = "module-select";

function toIsoDateTime(value: string): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function toOptionalNumber(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

type OpportunityValues = {
  opportunityTitle: string;
  pursuitKind: "grant" | "proposal";
  solicitationNumber: string;
  status: (typeof FUNDING_OPPORTUNITY_STATUS_OPTIONS)[number]["value"];
  programId: string;
  projectId: string;
  agencyName: string;
  ownerLabel: string;
  cadenceLabel: string;
  expectedAwardAmount: string;
  opensAt: string;
  closesAt: string;
  decisionDueAt: string;
  summary: string;
};

/**
 * Thirteen fields, on three different surfaces — the programs index, a program
 * cycle, and the grants board — each of them opening with the form already
 * expanded. Three steps behind a button now.
 *
 * WHAT DID NOT CHANGE. Same POST to `/api/funding-opportunities`, same keys,
 * same `"" → undefined`, and the solicitation number still only travels for a
 * PROPOSAL and still arrives trimmed: a grant has no solicitation number, and
 * sending one would put a value in a column the pursuit kind says nothing
 * belongs in.
 *
 * THE TWO SYNC EFFECTS ARE GONE, AND NOTHING WAS LOST. They existed to push
 * `defaultProgramId`/`defaultProjectId` into state when the props changed —
 * navigating between programs, for instance. `flow.open()` starts from
 * `initialValues`, which is built from the CURRENT props on every render, so
 * opening the flow already picks up today's defaults. An effect that copies a
 * prop into state is exactly what a flow that seeds at open time does not need.
 *
 * AN AMOUNT THAT IS NOT A NUMBER NOW SAYS SO. `toOptionalNumber` returns
 * `undefined` for anything unparseable or negative, which is correct for the
 * payload and was silent on the screen: a planner typing "1,000,000" got a
 * saved opportunity with NO expected award and nothing telling them why. The
 * step checks it before submitting; the payload helper is unchanged.
 */
export function FundingOpportunityCreator({
  programs,
  projects,
  defaultProgramId,
  defaultProjectId,
  title = "New funding opportunity",
  description = "Capture active and upcoming grant or formula opportunities without waiting for a full grant OS rewrite.",
}: {
  programs: ProgramOption[];
  projects: ProjectOption[];
  defaultProgramId?: string | null;
  defaultProjectId?: string | null;
  title?: string;
  description?: string;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);

  const steps = useMemo<GuidedFlowStep<OpportunityValues>[]>(
    () => [
      {
        id: "what",
        title: "What is the opportunity?",
        hint: "What it is called, whether you are chasing a grant or answering a solicitation.",
        fields: [
          {
            name: "opportunityTitle",
            label: "a name",
            required: true,
            requiredMessage: "Give the opportunity a name before you log it.",
          },
          { name: "pursuitKind", label: "a pursuit kind" },
          { name: "status", label: "a status" },
        ],
        render: (flow) => (
          <>
            <GuidedFlowRow flow={flow} name="opportunityTitle" label="Opportunity name">
              <Input
                {...flow.text("opportunityTitle")}
                placeholder="Safe Streets and Roads for All — planning grant"
              />
            </GuidedFlowRow>

            <GuidedFlowRow flow={flow} name="pursuitKind" label="What kind of pursuit?">
              <select className={selectClassName} {...flow.text("pursuitKind")}>
                <option value="grant">A grant we are going for</option>
                <option value="proposal">A proposal answering a solicitation</option>
              </select>
            </GuidedFlowRow>

            <GuidedFlowRow flow={flow} name="status" label="Where is it up to?">
              <select className={selectClassName} {...flow.text("status")}>
                {FUNDING_OPPORTUNITY_STATUS_OPTIONS.map((option) => (
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
        // ONLY A PROPOSAL HAS A SOLICITATION NUMBER, so this step appears only
        // for one. It is a step rather than a conditional row because the flow
        // checks that every field a step DECLARES renders a control — a guard
        // that caught this exact mistake when the row was hidden inside the
        // first step while still being declared by it.
        id: "solicitation",
        title: "Which solicitation is it answering?",
        hint: "Optional — from the solicitation document itself.",
        when: (values) => values.pursuitKind === "proposal",
        fields: [{ name: "solicitationNumber", label: "a solicitation number" }],
        render: (flow) => (
          <GuidedFlowRow flow={flow} name="solicitationNumber" label="Solicitation number">
            <Input {...flow.text("solicitationNumber")} placeholder="RFP-2026-014" />
          </GuidedFlowRow>
        ),
      },
      {
        id: "whose",
        title: "Who is it for, and who runs it?",
        hint: "All optional. Linking it now means the program and project pages can find it later.",
        fields: [
          { name: "programId", label: "a program" },
          { name: "projectId", label: "a project" },
          { name: "agencyName", label: "an agency" },
          { name: "ownerLabel", label: "an owner" },
        ],
        render: (flow) => (
          <>
            <GuidedFlowRow flow={flow} name="programId" label="Program">
              <select className={selectClassName} {...flow.text("programId")}>
                <option value="">No linked program</option>
                {programs.map((program) => (
                  <option key={program.id} value={program.id}>
                    {program.title}
                  </option>
                ))}
              </select>
            </GuidedFlowRow>

            <GuidedFlowRow flow={flow} name="projectId" label="Project">
              <select className={selectClassName} {...flow.text("projectId")}>
                <option value="">No linked project</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </GuidedFlowRow>

            <GuidedFlowRow flow={flow} name="agencyName" label="Which agency is offering it?">
              <Input {...flow.text("agencyName")} placeholder="US Department of Transportation" />
            </GuidedFlowRow>

            <GuidedFlowRow flow={flow} name="ownerLabel" label="Who owns it here?">
              <Input {...flow.text("ownerLabel")} placeholder="Grants lead" />
            </GuidedFlowRow>
          </>
        ),
      },
      {
        id: "money",
        title: "Money and dates",
        hint: "All optional, and easy to fill in from the opportunity's own page later.",
        fields: [
          { name: "expectedAwardAmount", label: "an expected award" },
          { name: "cadenceLabel", label: "a cadence" },
          { name: "opensAt", label: "an opening date" },
          { name: "closesAt", label: "a closing date" },
          { name: "decisionDueAt", label: "a decision date" },
          { name: "summary", label: "a summary" },
        ],
        check: (values) => {
          const raw = values.expectedAwardAmount.trim();
          if (!raw) return null;
          // The payload helper drops anything unparseable or negative, which is
          // right for the body and was SILENT on screen: "1,000,000" saved an
          // opportunity with no expected award and said nothing.
          const parsed = Number.parseFloat(raw);
          if (!Number.isFinite(parsed) || parsed < 0) {
            return {
              field: "expectedAwardAmount",
              message: "Give the expected award as a plain number, with no commas or currency sign.",
            };
          }
          return null;
        },
        render: (flow) => (
          <>
            <GuidedFlowRow
              flow={flow}
              name="expectedAwardAmount"
              label="Expected award"
              hint="A plain number — no commas, no currency sign."
            >
              <Input {...flow.text("expectedAwardAmount")} placeholder="250000" />
            </GuidedFlowRow>

            <GuidedFlowRow flow={flow} name="cadenceLabel" label="How often does it come round?">
              <Input {...flow.text("cadenceLabel")} placeholder="Annual notice of funding" />
            </GuidedFlowRow>

            <GuidedFlowRow flow={flow} name="opensAt" label="Opens">
              <Input {...flow.text("opensAt")} type="datetime-local" />
            </GuidedFlowRow>

            <GuidedFlowRow flow={flow} name="closesAt" label="Closes">
              <Input {...flow.text("closesAt")} type="datetime-local" />
            </GuidedFlowRow>

            <GuidedFlowRow flow={flow} name="decisionDueAt" label="Decision expected">
              <Input {...flow.text("decisionDueAt")} type="datetime-local" />
            </GuidedFlowRow>

            <GuidedFlowRow flow={flow} name="summary" label="Anything to note?">
              <Textarea
                {...flow.text("summary")}
                placeholder="What this opportunity would fund, and what makes it a fit."
              />
            </GuidedFlowRow>
          </>
        ),
      },
    ],
    [programs, projects]
  );

  const flow = useGuidedFlow<OpportunityValues>({
    id: "create-funding-opportunity",
    title,
    submitLabel: "Log the opportunity",
    // Built from the CURRENT props, so opening the flow picks up today's
    // defaults without an effect copying props into state.
    initialValues: {
      opportunityTitle: "",
      pursuitKind: "grant",
      solicitationNumber: "",
      status: "upcoming",
      programId: defaultProgramId ?? "",
      projectId: defaultProjectId ?? "",
      agencyName: "",
      ownerLabel: "",
      cadenceLabel: "",
      expectedAwardAmount: "",
      opensAt: "",
      closesAt: "",
      decisionDueAt: "",
      summary: "",
    },
    steps,
    onSubmit: async (values) => {
      // Unchanged from the inline form, deliberately: same route, same keys,
      // and the solicitation number still travels only for a proposal, trimmed.
      const response = await fetch("/api/funding-opportunities", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          programId: values.programId || undefined,
          projectId: values.projectId || undefined,
          title: values.opportunityTitle,
          pursuitKind: values.pursuitKind,
          solicitationNumber:
            values.pursuitKind === "proposal" && values.solicitationNumber.trim()
              ? values.solicitationNumber.trim()
              : undefined,
          status: values.status,
          agencyName: values.agencyName || undefined,
          ownerLabel: values.ownerLabel || undefined,
          cadenceLabel: values.cadenceLabel || undefined,
          expectedAwardAmount: toOptionalNumber(values.expectedAwardAmount),
          opensAt: toIsoDateTime(values.opensAt),
          closesAt: toIsoDateTime(values.closesAt),
          decisionDueAt: toIsoDateTime(values.decisionDueAt),
          summary: values.summary || undefined,
        }),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to create funding opportunity");
      }

      setMessage("Funding opportunity saved.");
      router.refresh();
    },
  });

  return (
    <article className="module-section-surface">
      <div className="module-section-header">
        <div className="module-section-heading">
          <p className="module-section-label">Create</p>
          <h2 className="module-section-title">{title}</h2>
          <p className="module-section-description">{description}</p>
        </div>
        <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-emerald-500/12 text-emerald-700 dark:text-emerald-300">
          <CalendarPlus2 className="h-5 w-5" />
        </span>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button
          type="button"
          onClick={() => {
            setMessage(null);
            flow.open();
          }}
          data-testid="funding-opportunity-creator-open"
        >
          <Plus className="mr-1.5 h-4 w-4" />
          {title}
        </Button>
        {message ? (
          <p
            className="text-sm text-emerald-700 dark:text-emerald-300"
            data-testid="funding-opportunity-saved"
          >
            {message}
          </p>
        ) : null}
      </div>

      <GuidedFlow flow={flow} />
    </article>
  );
}
