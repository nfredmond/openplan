"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BadgeDollarSign, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  FUNDING_AWARD_MATCH_POSTURE_OPTIONS,
  FUNDING_AWARD_OPEN_SPENDING_STATUS_OPTIONS,
  FUNDING_AWARD_RISK_FLAG_OPTIONS,
} from "@/lib/programs/catalog";
import {
  GuidedFlow,
  GuidedFlowRow,
  useGuidedFlow,
  type GuidedFlowStep,
} from "@/components/ui/guided-flow";

/**
 * "Fully spent" is deliberately absent from the spending-status select here.
 *
 * It was on it, and picking it created an award that was already closed: no
 * invoice-coverage check, no close-out milestone, no RTP posture rebuild — the
 * whole close-out contract skipped at birth. A new award cannot have earned a
 * close-out in any case, because invoices link to an award by id and a record
 * that does not exist yet has coverage of exactly zero.
 *
 * What replaces it is the checkbox below. A workspace importing awards that
 * closed years ago has a real need to say so, and that need is served by an
 * explicit act with a written basis — which the API audits under its own event
 * and stamps on the row as an imported closure — rather than by a value in a
 * dropdown that looks identical to a close-out this product verified.
 */
function toIsoDateTime(value: string): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

type AwardValues = {
  title: string;
  opportunityId: string;
  awardedAmount: string;
  matchAmount: string;
  matchPosture: (typeof FUNDING_AWARD_MATCH_POSTURE_OPTIONS)[number]["value"];
  spendingStatus: (typeof FUNDING_AWARD_OPEN_SPENDING_STATUS_OPTIONS)[number]["value"];
  riskFlag: (typeof FUNDING_AWARD_RISK_FLAG_OPTIONS)[number]["value"];
  isAlreadyClosed: boolean;
  closureNote: string;
  obligationDueAt: string;
  expenditureDeadlineAt: string;
  notes: string;
};

const selectClassName = "module-select";

export function ProjectFundingAwardCreator({
  projectId,
  opportunityOptions,
  defaultOpportunityId,
  defaultProgramId,
  defaultTitle,
  titleLabel = "Record a funding award",
  description,
}: {
  projectId: string;
  opportunityOptions: Array<{ id: string; title: string }>;
  defaultOpportunityId?: string | null;
  defaultProgramId?: string | null;
  defaultTitle?: string;
  titleLabel?: string;
  description?: string;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);

  const steps = useMemo<GuidedFlowStep<AwardValues>[]>(
    () => [
      {
        id: "award",
        title: "What was awarded?",
        hint: "The award as your funder describes it, and what it is worth.",
        fields: [
          {
            name: "title",
            label: "a name",
            required: true,
            requiredMessage: "Give the award a name before you record it.",
          },
          { name: "opportunityId", label: "an opportunity" },
          { name: "awardedAmount", label: "an awarded amount" },
          { name: "matchAmount", label: "a match amount" },
          { name: "matchPosture", label: "a match posture" },
        ],
        check: (values) => {
          for (const [field, raw, label] of [
            ["awardedAmount", values.awardedAmount, "awarded amount"],
            ["matchAmount", values.matchAmount, "match amount"],
          ] as const) {
            if (!raw.trim()) continue;
            const parsed = Number(raw);
            // Blank means zero, deliberately — but a value that is NOT a number
            // would also become zero, silently recording a $0 award.
            if (!Number.isFinite(parsed) || parsed < 0) {
              return {
                field,
                message: `Give the ${label} as a plain number, with no commas or currency sign.`,
              };
            }
          }
          return null;
        },
        render: (flow) => (
          <>
            <GuidedFlowRow flow={flow} name="title" label="Award name">
              <Input {...flow.text("title")} placeholder="Cycle 8 ATP award" />
            </GuidedFlowRow>

            <GuidedFlowRow
              flow={flow}
              name="opportunityId"
              label="Which opportunity did it come from?"
              hint="Optional."
            >
              <select className={selectClassName} {...flow.text("opportunityId")}>
                <option value="">No linked opportunity</option>
                {opportunityOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.title}
                  </option>
                ))}
              </select>
            </GuidedFlowRow>

            <GuidedFlowRow
              flow={flow}
              name="awardedAmount"
              label="Awarded amount"
              hint="A plain number. Blank counts as zero."
            >
              <Input {...flow.text("awardedAmount")} placeholder="1750000" />
            </GuidedFlowRow>

            <GuidedFlowRow
              flow={flow}
              name="matchAmount"
              label="Local match"
              hint="A plain number. Blank counts as zero."
            >
              <Input {...flow.text("matchAmount")} placeholder="250000" />
            </GuidedFlowRow>

            <GuidedFlowRow flow={flow} name="matchPosture" label="How is the match being met?">
              <select className={selectClassName} {...flow.text("matchPosture")}>
                {FUNDING_AWARD_MATCH_POSTURE_OPTIONS.map((option) => (
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
        id: "spending",
        title: "Where does the money stand?",
        hint: "A new award has not been spent yet — unless you are recording one that closed before OpenPlan saw it.",
        fields: [
          { name: "spendingStatus", label: "a spending status" },
          { name: "isAlreadyClosed", label: "whether it closed already" },
          { name: "riskFlag", label: "a risk flag" },
        ],
        render: (flow) => (
          <>
            <GuidedFlowRow flow={flow} name="spendingStatus" label="Spending status">
              <select
                className={selectClassName}
                disabled={flow.values.isAlreadyClosed}
                {...flow.text("spendingStatus")}
              >
                {FUNDING_AWARD_OPEN_SPENDING_STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {flow.values.isAlreadyClosed ? (
                <p className="text-xs text-muted-foreground">
                  {/* Not "below" any more: the basis moved to its own step. */}
                  Not used — you are recording this award as already closed.
                </p>
              ) : null}
            </GuidedFlowRow>

            <GuidedFlowRow flow={flow} name="isAlreadyClosed" label="Already closed?">
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  {...flow.fieldProps("isAlreadyClosed")}
                  checked={flow.values.isAlreadyClosed}
                  onChange={(event) => flow.setValue("isAlreadyClosed", event.target.checked)}
                />
                <span>This award closed before it was recorded here</span>
              </label>
            </GuidedFlowRow>

            <GuidedFlowRow flow={flow} name="riskFlag" label="Risk flag">
              <select className={selectClassName} {...flow.text("riskFlag")}>
                {FUNDING_AWARD_RISK_FLAG_OPTIONS.map((option) => (
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
        // ONLY WHEN THE AWARD IS BEING IMPORTED AS CLOSED. A step rather than a
        // hidden row: the flow requires every field a step DECLARES to render a
        // control, so a conditionally-rendered declared field throws on mount.
        id: "closure",
        title: "What closed it?",
        hint: "Recording an award as already closed skips the close-out contract, so the basis is written down.",
        when: (values) => values.isAlreadyClosed,
        fields: [
          {
            name: "closureNote",
            label: "a basis for the closure",
            required: true,
            requiredMessage:
              "Recording an award as already closed needs a written basis — what closed it, and on whose record.",
          },
        ],
        render: (flow) => (
          <GuidedFlowRow flow={flow} name="closureNote" label="Basis for the closure (required)">
            <Textarea
              {...flow.text("closureNote")}
              placeholder="Closed on the funder's 2024 statement; final reimbursement paid 2024-11-08."
            />
          </GuidedFlowRow>
        ),
      },
      {
        id: "dates",
        title: "Deadlines and notes",
        hint: "All optional.",
        fields: [
          { name: "obligationDueAt", label: "an obligation date" },
          { name: "expenditureDeadlineAt", label: "an expenditure deadline" },
          { name: "notes", label: "notes" },
        ],
        render: (flow) => (
          <>
            <GuidedFlowRow flow={flow} name="obligationDueAt" label="Obligation due">
              <Input {...flow.text("obligationDueAt")} type="datetime-local" />
            </GuidedFlowRow>

            {/*
              The hint is kept verbatim from the inline form: this is the ONLY
              place a lapse date can be entered, and that sentence is what tells
              a planner it is a different date from the obligation one, and that
              filling it turns a reminder on.
            */}
            <GuidedFlowRow
              flow={flow}
              name="expenditureDeadlineAt"
              label="Expenditure deadline"
              hint="The date the funds must be spent by, if your agreement sets one — separate from the obligation date above. Recording it turns on a daily reminder that names what is still unclaimed on this award. Leave it blank if your agreement does not set one."
            >
              <Input {...flow.text("expenditureDeadlineAt")} type="datetime-local" />
            </GuidedFlowRow>

            <GuidedFlowRow flow={flow} name="notes" label="Anything to note?">
              <Textarea
                {...flow.text("notes")}
                placeholder="Award terms, obligation risks, reimbursement posture, or scope notes."
              />
            </GuidedFlowRow>
          </>
        ),
      },
    ],
    [opportunityOptions]
  );

  const flow = useGuidedFlow<AwardValues>({
    id: "record-funding-award",
    title: titleLabel,
    submitLabel: "Save the award",
    initialValues: {
      title: defaultTitle ?? "",
      opportunityId: defaultOpportunityId ?? "",
      awardedAmount: "",
      matchAmount: "",
      matchPosture: "partial",
      spendingStatus: "not_started",
      riskFlag: "none",
      isAlreadyClosed: false,
      closureNote: "",
      obligationDueAt: "",
      expenditureDeadlineAt: "",
      notes: "",
    },
    steps,
    onSubmit: async (values) => {
      const trimmedClosureNote = values.closureNote.trim();
      const response = await fetch("/api/funding-awards", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId,
          opportunityId: values.opportunityId || undefined,
          programId: defaultProgramId || undefined,
          title: values.title,
          awardedAmount: values.awardedAmount ? Number(values.awardedAmount) : 0,
          matchAmount: values.matchAmount ? Number(values.matchAmount) : 0,
          matchPosture: values.matchPosture,
          obligationDueAt: toIsoDateTime(values.obligationDueAt),
          expenditureDeadlineAt: toIsoDateTime(values.expenditureDeadlineAt),
          // The two are mutually exclusive at the API — sending both is a 400,
          // because they are two statements about the same field.
          spendingStatus: values.isAlreadyClosed ? undefined : values.spendingStatus,
          recordClosedOnImport: values.isAlreadyClosed
            ? { note: trimmedClosureNote }
            : undefined,
          riskFlag: values.riskFlag,
          notes: values.notes || undefined,
        }),
      });

      const payload = (await response.json()) as { error?: string; details?: string };
      if (!response.ok) {
        // The API's `details` carries the specific reason and, on the refusals
        // that have one, the way through. Dropping it would leave a planner with
        // a headline and no next step.
        throw new Error(
          [payload.error, payload.details].filter(Boolean).join(" ") ||
            "Failed to create funding award"
        );
      }

      setMessage(
        values.isAlreadyClosed
          ? "Funding award saved and recorded as closed on your statement. No invoice coverage was checked, and it will read as an imported closure wherever it is shown."
          : "Funding award saved."
      );
      router.refresh();
    },
  });

  return (
    // The project detail page's funding tab claims the `funding-award-` anchor
    // prefix. The inline form carried ids like `funding-award-expenditure-
    // deadline-help` on its own fields; a flow generates its own ids, so the
    // panel takes the anchor — which is the right scroll target anyway, since
    // the fields live behind a button now.
    <article
      id="funding-award-creator"
      className="rounded-[0.5rem] border border-border/70 bg-background/80 p-4"
    >
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-[0.5rem] bg-emerald-500/12 text-emerald-700 dark:text-emerald-300">
          <BadgeDollarSign className="h-4 w-4" />
        </span>
        <div>
          <p className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Funding award
          </p>
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
          data-testid="funding-award-creator-open"
        >
          <Plus className="mr-1.5 h-4 w-4" />
          {titleLabel}
        </Button>
        {message ? (
          <p
            className="text-sm text-emerald-700 dark:text-emerald-300"
            data-testid="funding-award-saved"
          >
            {message}
          </p>
        ) : null}
      </div>

      <GuidedFlow flow={flow} />
    </article>
  );
}
