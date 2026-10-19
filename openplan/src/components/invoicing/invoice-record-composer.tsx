"use client";
import { awardTermsSchema, exactInvoiceAmounts } from "@/lib/grants/award-handoff";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileSpreadsheet, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ActionFeedback } from "@/components/ui/action-feedback";
import {
  GuidedFlow,
  GuidedFlowRow,
  useGuidedFlow,
  type GuidedFlowStep,
} from "@/components/ui/guided-flow";
import type { ReimbursementProfileBinding } from "@/lib/invoicing/reimbursement-profile-binding";
import { formatMoney } from "@/lib/money/format";

type ProjectOption = {
  id: string;
  name: string;
};

type FundingAwardOption = {
  id: string;
  title: string;
  projectId: string | null;
};

type InvoiceRecordComposerProps = {
  workspaceId: string;
  projects: ProjectOption[];
  fundingAwards?: FundingAwardOption[];
  canWrite: boolean;
  defaultProjectId?: string | null;
  defaultFundingAwardId?: string | null;
  defaultInvoiceNumber?: string;
  defaultAmount?: string;
  titleLabel?: string;
  description?: string;
  /**
   * The workspace's resolved reimbursement profile — the registry-driven
   * posture vocabulary, default posture, and submitted-to hint. When a caller
   * cannot resolve one, the posture field is omitted entirely and the server
   * records the workspace's resolved default; no jurisdiction is ever assumed
   * client-side.
   *
   * Display-only for provenance purposes: the composer submits the chosen
   * POSTURE but never this binding's profile id. The server re-resolves the
   * profile from the workspace's own home geography and records how it was
   * truly selected (`jurisdiction_matched` / `interim_unconfigured_default`).
   * Echoing the page-resolved id back would stamp every UI write
   * `explicitly_requested` — an explicit choice nobody made. That selection is
   * reserved for API callers that genuinely pass a profile id of their own.
   */
  reimbursementProfile?: ReimbursementProfileBinding | null;
};

type InvoiceValues = {
  invoiceNumber: string;
  consultantName: string;
  billingBasis: string;
  status: string;
  projectId: string;
  fundingAwardId: string;
  submittedTo: string;
  amount: string;
  retentionPercent: string;
  supportingDocsStatus: string;
  reimbursementPosture: string;
  periodStart: string;
  periodEnd: string;
  invoiceDate: string;
  dueDate: string;
  notes: string;
};

const selectClassName = "module-select";

const BILLING_BASIS_OPTIONS = [
  { value: "time_and_materials", label: "Time and materials" },
  { value: "lump_sum", label: "Lump sum" },
  { value: "cost_plus", label: "Cost plus" },
  { value: "milestone", label: "Milestone" },
  { value: "progress_payment", label: "Progress payment" },
];

const INVOICE_STATUS_OPTIONS = [
  { value: "draft", label: "Draft" },
  { value: "internal_review", label: "Internal review" },
  { value: "submitted", label: "Submitted" },
  { value: "approved_for_payment", label: "Approved for payment" },
  { value: "paid", label: "Paid" },
  { value: "rejected", label: "Rejected" },
];

const SUPPORTING_DOCS_OPTIONS = [
  { value: "pending", label: "Pending" },
  { value: "partial", label: "Partial" },
  { value: "complete", label: "Complete" },
  { value: "accepted", label: "Accepted" },
];

type InvoiceAwardTerms = {
  award:{id:string;workspace_id:string;project_id:string|null;current_handoff_revision_id:string|null;latest_handoff_revision_id:string|null;currency_code:string|null};
  history:Array<{id:string;terms:unknown}>;
};
type TermsRead = {key:string;status:"ready";data:InvoiceAwardTerms}|{key:string;status:"error";message:string};
function record(value:unknown):value is Record<string,unknown> {return typeof value==="object" && value!==null && !Array.isArray(value);}

/** An incomplete or foreign response cannot become an unmanaged award. */
function readInvoiceAwardTerms(value:unknown, workspaceId:string, selection:Pick<InvoiceValues,"projectId"|"fundingAwardId">):InvoiceAwardTerms {
  if(!record(value) || !record(value.award) || !Array.isArray(value.history))throw new Error("Award terms response is unavailable.");
  const award=value.award;
  if(award.id!==selection.fundingAwardId || award.workspace_id!==workspaceId || !(award.project_id===null || typeof award.project_id==="string") || (award.project_id!==null && award.project_id!==selection.projectId))throw new Error("Award terms do not match the selected workspace and project.");
  for(const key of ["current_handoff_revision_id","latest_handoff_revision_id","currency_code"])if(!(award[key]===null || typeof award[key]==="string"))throw new Error("Award terms identity is incomplete.");
  if(!value.history.every((row)=>record(row) && typeof row.id==="string" && "terms" in row))throw new Error("Award history is incomplete.");
  if(award.latest_handoff_revision_id!==null && !value.history.some((row)=>row.id===award.latest_handoff_revision_id))throw new Error("Latest retained terms are unavailable.");
  if(award.latest_handoff_revision_id===null && (award.current_handoff_revision_id!==null || value.history.length>0))throw new Error("Award terms pointers are inconsistent.");
  if(award.current_handoff_revision_id!==null){
    const current=value.history.find((row)=>row.id===award.current_handoff_revision_id);
    const terms=awardTermsSchema.safeParse(current?.terms);
    if(!terms.success || !terms.data.effective || terms.data.currency.code!==award.currency_code)throw new Error("Current award version or currency is unavailable.");
  }
  return value as InvoiceAwardTerms;
}

/** Changed defaults and scope start a new form with no inherited review. */
export function InvoiceRecordComposer(props:InvoiceRecordComposerProps) {
  const scope=JSON.stringify([props.workspaceId,props.canWrite,props.defaultProjectId??"",props.defaultFundingAwardId??"",props.defaultInvoiceNumber??"",props.defaultAmount??"",props.reimbursementProfile?.defaultPostureId??"",props.projects.map((project)=>project.id),props.fundingAwards?.map((award)=>[award.id,award.projectId])??[]]);
  return <InvoiceRecordComposerSession key={scope} {...props}/>;
}

/**
 * Logging a consulting invoice record, as a flow.
 *
 * WHY THIS ONE CONVERTED WHERE THE CLIENT-INVOICE COMPOSER DID NOT. That one is
 * flanked by the invoices already sent to a client and by the unbilled-hours
 * ledger it draws its lines from — a modal hides both. This one renders its own
 * money panel: the retention and net-request figures are computed by this
 * component from the two fields beside them, so they travel INTO the flow with
 * those fields rather than being covered by it. A "Register summary" sits below
 * it on the page, but that is a summary, not the list this writes into, and no
 * prop here is derived from existing invoices.
 *
 * THE NET REQUEST IS STILL LIVE, on the step that owns the amount and the
 * retention percentage. Watching the net move while typing is the point of that
 * panel, and splitting the two fields across steps would have broken it.
 *
 * THE AWARD STILL CLEARS ITSELF when it does not belong to the chosen project.
 * That was a `useEffect` reconciling two pieces of state; it is done where the
 * project changes now, which is the only place it can go wrong.
 *
 * WHAT DID NOT CHANGE. Same POST to `/api/invoicing/invoices`, same keys, same
 * `"" → undefined` on the optional links and dates, `consultantName`,
 * `submittedTo` and `notes` still sent RAW as the inline form sent them, and
 * still NO `reimbursementProfileId` — the server re-resolves the profile and
 * records the true provenance. The error still prefers `details`.
 */
function InvoiceRecordComposerSession({
  workspaceId,
  projects,
  fundingAwards = [],
  canWrite,
  defaultProjectId,
  defaultFundingAwardId,
  defaultInvoiceNumber,
  defaultAmount,
  titleLabel = "Log a consulting invoice record",
  description = "Capture consulting invoice records with retention, backup posture, and workspace or project linkage.",
  reimbursementProfile = null,
}: InvoiceRecordComposerProps) {
  const router = useRouter();
  const [termsRead,setTermsRead] = useState<TermsRead|null>(null);
  const [reviewedTermsKey,setReviewedTermsKey] = useState<string|null>(null);
  const [selectionEpoch,setSelectionEpoch] = useState(0);
  const active=useRef(false); const epoch=useRef(0);
  useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
  const invalidateSelection=useCallback(()=>{epoch.current+=1;setSelectionEpoch(epoch.current);setReviewedTermsKey(null);},[]);
  const selectionKey=useCallback((values:Pick<InvoiceValues,"projectId"|"fundingAwardId">)=>JSON.stringify([workspaceId,selectionEpoch,values.projectId,values.fundingAwardId]),[workspaceId,selectionEpoch]);
  const termsFor=useCallback((values:InvoiceValues)=>termsRead?.key===selectionKey(values) && termsRead.status==="ready" ? termsRead.data : null,[termsRead,selectionKey]);
  const reviewKeyFor=useCallback((values:InvoiceValues,data:InvoiceAwardTerms)=>JSON.stringify([selectionKey(values),data.award.current_handoff_revision_id,data.award.currency_code]),[selectionKey]);
  const moneyFor=useCallback((value:number|string|null,values:InvoiceValues)=>{
    if(!values.fundingAwardId)return formatMoney(value,{precision:"cents"});
    const current=termsFor(values);
    if(!current)return "Currency unassessed";
    if(!current.award.latest_handoff_revision_id)return formatMoney(value,{precision:"cents"});
    return current.award.currency_code ? formatMoney(value,{precision:"cents",currency:current.award.currency_code,currencyDisplay:"code"}) : "Currency unassessed";
  },[termsFor]);
  const [message, setMessage] = useState<string | null>(null);

  const steps = useMemo<GuidedFlowStep<InvoiceValues>[]>(
    () => [
      {
        id: "invoice",
        title: "Which invoice is this?",
        hint: "The number on the invoice itself, and who issued it.",
        fields: [
          {
            name: "invoiceNumber",
            label: "an invoice number",
            required: true,
            requiredMessage: "Give the invoice number before you log it.",
          },
          { name: "consultantName", label: "a consultant" },
          { name: "billingBasis", label: "a billing basis" },
          { name: "status", label: "a status" },
        ],
        render: (flow) => (
          <>
            <GuidedFlowRow flow={flow} name="invoiceNumber" label="Invoice number">
              <Input {...flow.text("invoiceNumber")} placeholder="OP-2026-001" />
            </GuidedFlowRow>

            <GuidedFlowRow flow={flow} name="consultantName" label="Who issued it?">
              <Input {...flow.text("consultantName")} placeholder="Consulting firm" />
            </GuidedFlowRow>

            <GuidedFlowRow flow={flow} name="billingBasis" label="How is it billed?">
              <select className={selectClassName} {...flow.text("billingBasis")}>
                {BILLING_BASIS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </GuidedFlowRow>

            <GuidedFlowRow flow={flow} name="status" label="Where is it up to?">
              <select className={selectClassName} {...flow.text("status")}>
                {INVOICE_STATUS_OPTIONS.map((option) => (
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
        id: "links",
        title: "What is it against?",
        hint: "All optional. An invoice can sit at workspace level with no project at all.",
        fields: [
          { name: "projectId", label: "a project" },
          { name: "fundingAwardId", label: "a funding award" },
        ],
        render: (flow) => {
          const visibleFundingAwards = fundingAwards.filter(
            (award) =>
              !flow.values.projectId ||
              !award.projectId ||
              award.projectId === flow.values.projectId
          );
          return (
            <>
              <GuidedFlowRow flow={flow} name="projectId" label="Project">
                <select
                  className={selectClassName}
                  {...flow.text("projectId")}
                  onChange={(event) => {
                    // AN AWARD FROM ANOTHER PROJECT CLEARS ITSELF. This was a
                    // `useEffect` reconciling two pieces of state after the
                    // fact; doing it where the project changes is the only
                    // place the pair can go wrong, and it cannot flash an
                    // invalid pairing on the way.
                    invalidateSelection();
                    const nextProjectId = event.target.value;
                    const stillValid = fundingAwards.some(
                      (award) =>
                        award.id === flow.values.fundingAwardId &&
                        (!nextProjectId || !award.projectId || award.projectId === nextProjectId)
                    );
                    flow.setValues({
                      projectId: nextProjectId,
                      ...(stillValid ? {} : { fundingAwardId: "" }),
                    });
                  }}
                >
                  <option value="">Workspace-level / no specific project</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </GuidedFlowRow>

              <GuidedFlowRow flow={flow} name="fundingAwardId" label="Funding award">
                <select className={selectClassName} {...flow.text("fundingAwardId")} onChange={(event)=>{invalidateSelection();flow.setValues({fundingAwardId:event.target.value});}}>
                  <option value="">No linked funding award</option>
                  {visibleFundingAwards.map((award) => (
                    <option key={award.id} value={award.id}>
                      {award.title}
                    </option>
                  ))}
                </select>
              </GuidedFlowRow>
            </>
          );
        },
      },
      {
        id: "money",
        title: "How much is being claimed?",
        hint: "The net request is worked out from these two as you type.",
        fields: [
          {
            name: "amount",
            label: "an amount",
            required: true,
            requiredMessage: "Give the gross amount before you log it.",
          },
          { name: "retentionPercent", label: "a retention percentage" },
          { name: "submittedTo", label: "who it was submitted to" },
          { name: "supportingDocsStatus", label: "a supporting-documents status" },
          ...(reimbursementProfile
            ? [{ name: "reimbursementPosture" as const, label: "a reimbursement posture" }]
            : []),
        ],
        check: (values) => {
          for (const [field, raw, label] of [
            ["amount", values.amount, "gross amount"],
            ["retentionPercent", values.retentionPercent, "retention percentage"],
          ] as const) {
            if (!raw.trim()) continue;
            const parsed = Number.parseFloat(raw);
            if (!Number.isFinite(parsed) || parsed < 0) {
              return {
                field,
                message: `Give the ${label} as a plain number, with no commas or currency sign.`,
              };
            }
          }
          return null;
        },
        render: (flow) => {
          const amountValue = flow.values.amount;
          const retentionPercentValue = flow.values.retentionPercent || "0";
          let retentionAmountPreview: number|string|null=null, netAmountPreview:number|string|null=null;
          try { const amounts=exactInvoiceAmounts(amountValue,retentionPercentValue);retentionAmountPreview=amounts.retentionAmount;netAmountPreview=amounts.netAmount; } catch { /* Invalid input remains unassessed until corrected. */ }

          return (
            <>
              <GuidedFlowRow flow={flow} name="amount" label="Gross amount">
                <Input {...flow.text("amount")} type="text" inputMode="decimal" placeholder="Actual invoice amount" />
              </GuidedFlowRow>

              <GuidedFlowRow flow={flow} name="retentionPercent" label="Retention %">
                <Input {...flow.text("retentionPercent")} type="number" min="0" step="0.01" />
              </GuidedFlowRow>

              {/* THE LIVE MONEY PANEL, KEPT WHOLE — including the gross row and
                  the `aria-live`, which is why a screen reader hears the net
                  change while somebody types. It sits on the step that owns the
                  two fields it is computed from, because watching the net move
                  while typing is the point of it. */}
              <aside
                className="border border-border/60 bg-background/70 px-4 py-4"
                aria-live="polite"
              >
                <p className="text-label font-semibold text-muted-foreground">
                  Net request preview
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Updates live from the gross amount and retention fields so the billing request
                  math stays visible before save.
                </p>
                <dl className="mt-4 space-y-3 text-sm text-muted-foreground">
                  <div className="flex items-center justify-between gap-3 border-b border-border/50 pb-3">
                    <dt>Gross amount</dt>
                    <dd className="font-semibold text-foreground">
                      {moneyFor(amountValue,flow.values)}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3 border-b border-border/50 pb-3">
                    <dt>Retention ({retentionPercentValue}%)</dt>
                    <dd className="font-semibold text-foreground">
                      {moneyFor(retentionAmountPreview,flow.values)}
                    </dd>
                  </div>
                  <div className="space-y-1 pt-1">
                    <dt className="text-label font-semibold text-muted-foreground">
                      Net request
                    </dt>
                    <dd
                      className="text-2xl font-semibold tracking-tight text-foreground"
                      data-testid="invoice-net-request"
                    >
                      {moneyFor(netAmountPreview,flow.values)}
                    </dd>
                  </div>
                </dl>
                <p className="mt-5 border-l-2 border-[color:var(--pine)] bg-[color:var(--pine)]/6 px-3 py-3 text-sm text-foreground">
                  Save only when the workspace, project link, and reimbursement posture are correct.
                  This form tracks the record, not the agency-certified packet itself.
                </p>
              </aside>

              <GuidedFlowRow flow={flow} name="submittedTo" label="Submitted to">
                {/* The placeholder names THIS funder's own office when the
                    resolved profile supplies one, rather than a generic word.
                    Hardcoding it loses the one piece of guidance saying where
                    the claim actually goes — and would put one jurisdiction's
                    wording in front of every other one. The hint comes from the
                    profile registry, which is the only place that may know. */}
                <Input
                  {...flow.text("submittedTo")}
                  placeholder={reimbursementProfile?.submittedToHint ?? "Funder or program office"}
                />
              </GuidedFlowRow>

              <GuidedFlowRow
                flow={flow}
                name="supportingDocsStatus"
                label="Backup documents"
                hint="What the agency will need alongside the claim."
              >
                <select className={selectClassName} {...flow.text("supportingDocsStatus")}>
                  {SUPPORTING_DOCS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </GuidedFlowRow>

              {reimbursementProfile ? (
                <>
                  <GuidedFlowRow
                    flow={flow}
                    name="reimbursementPosture"
                    label={`Reimbursement stage — ${reimbursementProfile.profileName}`}
                    hint={reimbursementProfile.framingNote ?? undefined}
                  >
                    <select className={selectClassName} {...flow.text("reimbursementPosture")}>
                      {reimbursementProfile.postureOptions.map((option) => (
                        <option key={option.postureId} value={option.postureId}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </GuidedFlowRow>

                  {reimbursementProfile.documentationChecklist?.length ? (
                    <div className="rounded-[0.5rem] border border-border/60 bg-background/60 px-3 py-3">
                      <p className="text-label font-semibold text-muted-foreground">
                        Before submitting a reimbursement packet
                      </p>
                      <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-muted-foreground">
                        {reimbursementProfile.documentationChecklist.map((item) => (
                          <li key={item.label}>
                            <span className="font-medium text-foreground">{item.label}.</span>{" "}
                            {item.guidance}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </>
              ) : null}
            </>
          );
        },
      },
      {
        id: "dates",
        title: "What period does it cover?",
        hint: "All optional.",
        fields: [
          { name: "periodStart", label: "a period start" },
          { name: "periodEnd", label: "a period end" },
          { name: "invoiceDate", label: "an invoice date" },
          { name: "dueDate", label: "a due date" },
          { name: "notes", label: "notes" },
        ],
        check: (values) => {
          if (values.periodStart && values.periodEnd && values.periodEnd < values.periodStart) {
            return {
              field: "periodEnd",
              message: "The period cannot end before it starts.",
            };
          }
          return null;
        },
        render: (flow) => (
          <>
            <GuidedFlowRow flow={flow} name="periodStart" label="Period start">
              <Input {...flow.text("periodStart")} type="date" />
            </GuidedFlowRow>

            <GuidedFlowRow flow={flow} name="periodEnd" label="Period end">
              <Input {...flow.text("periodEnd")} type="date" />
            </GuidedFlowRow>

            <GuidedFlowRow flow={flow} name="invoiceDate" label="Invoice date">
              <Input {...flow.text("invoiceDate")} type="date" />
            </GuidedFlowRow>

            <GuidedFlowRow flow={flow} name="dueDate" label="Due date">
              <Input {...flow.text("dueDate")} type="date" />
            </GuidedFlowRow>

            <GuidedFlowRow flow={flow} name="notes" label="Anything to note?">
              <Textarea
                {...flow.text("notes")}
                placeholder="Scope covered, retention terms, or what the agency still needs."
              />
            </GuidedFlowRow>
          </>
        ),
      },
    ],
    [fundingAwards, projects, reimbursementProfile, invalidateSelection, moneyFor]
  );

  const flow = useGuidedFlow<InvoiceValues>({
    id: "log-invoice-record",
    title: titleLabel,
    submitLabel: "Save the invoice record",
    initialValues: {
      invoiceNumber: defaultInvoiceNumber ?? "",
      consultantName: "",
      billingBasis: "time_and_materials",
      status: "draft",
      projectId: defaultProjectId ?? "",
      fundingAwardId: defaultFundingAwardId ?? "",
      submittedTo: "",
      amount: defaultAmount ?? "",
      retentionPercent: "0",
      supportingDocsStatus: "pending",
      reimbursementPosture: reimbursementProfile?.defaultPostureId ?? "",
      periodStart: "",
      periodEnd: "",
      invoiceDate: "",
      dueDate: "",
      notes: "",
    },
    steps,
    onSubmit: async (values) => {
      const amountValue = values.amount;
      const retentionPercentValue = values.retentionPercent || "0";
      exactInvoiceAmounts(amountValue,retentionPercentValue);
      if(!canWrite || !active.current)throw new Error("Invoice entry is unavailable.");
      const requestEpoch=selectionEpoch;
      let bound=values.fundingAwardId ? termsFor(values) : null;
      if(values.fundingAwardId){
        if(!bound)throw new Error("Load and review award terms before saving.");
        if(bound.award.latest_handoff_revision_id && (!bound.award.current_handoff_revision_id || reviewedTermsKey!==reviewKeyFor(values,bound)))throw new Error("Review current effective award conditions before saving reimbursement.");
        const response=await fetch(`/api/funding-awards/${values.fundingAwardId}/handoff`,{cache:"no-store"}); const data=await response.json();
        if(!active.current || epoch.current!==requestEpoch)throw new Error("Invoice selection changed. No invoice was saved.");
        let fresh:InvoiceAwardTerms;
        try {
          if(!response.ok)throw new Error(data.error??"Award terms unavailable");
          fresh=readInvoiceAwardTerms(data,workspaceId,values);
        } catch(error){setTermsRead({key:selectionKey(values),status:"error",message:String(error)});setReviewedTermsKey(null);throw error;}
        if(fresh.award.current_handoff_revision_id!==bound.award.current_handoff_revision_id || fresh.award.currency_code!==bound.award.currency_code || Boolean(fresh.award.latest_handoff_revision_id)!==Boolean(bound.award.latest_handoff_revision_id)){
          setTermsRead({key:selectionKey(values),status:"ready",data:fresh});setReviewedTermsKey(null);throw new Error("Award terms changed. Review the current version before saving.");
        }
        bound=fresh;
      }
      if(!active.current || epoch.current!==requestEpoch)throw new Error("Invoice selection changed. No invoice was saved.");

      const response = await fetch("/api/invoicing/invoices", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          projectId: values.projectId || undefined,
          fundingAwardId: values.fundingAwardId || undefined,
          invoiceNumber: values.invoiceNumber,
          consultantName: values.consultantName,
          billingBasis: values.billingBasis,
          status: values.status,
          periodStart: values.periodStart || undefined,
          periodEnd: values.periodEnd || undefined,
          invoiceDate: values.invoiceDate || undefined,
          dueDate: values.dueDate || undefined,
          awardHandoffRevisionId:bound?.award.current_handoff_revision_id ?? undefined,
          currencyCode:bound?.award.currency_code ?? undefined,
          amount: amountValue,
          retentionPercent: retentionPercentValue,
          supportingDocsStatus: values.supportingDocsStatus,
          submittedTo: values.submittedTo,
          // Deliberately no reimbursementProfileId: see the prop doc — the
          // server re-resolves the profile and records the true provenance.
          reimbursementPosture: reimbursementProfile
            ? values.reimbursementPosture || undefined
            : undefined,
          notes: values.notes,
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { error?: string; details?: string }
        | null;
      if (!response.ok) {
        throw new Error(
          payload?.details || payload?.error || "Failed to save invoice record"
        );
      }

      if(!active.current)return;
      setMessage("Invoice record saved.");
      router.refresh();
    },
  });

  const selectedAwardId=flow.values.fundingAwardId; const selectedProjectId=flow.values.projectId;
  const requestKey=selectionKey(flow.values); const flowOpen=flow.isOpen;
  useEffect(()=>{
    if(!canWrite || !flowOpen || !selectedAwardId)return;
    const controller=new AbortController(); const requestEpoch=selectionEpoch;
    void fetch(`/api/funding-awards/${selectedAwardId}/handoff`,{cache:"no-store",signal:controller.signal}).then(async(response)=>{
      const data=await response.json();
      if(controller.signal.aborted || !active.current || epoch.current!==requestEpoch)return;
      if(!response.ok)throw new Error(data.error??"Award terms unavailable");
      const current=readInvoiceAwardTerms(data,workspaceId,{fundingAwardId:selectedAwardId,projectId:selectedProjectId});
      setTermsRead({key:requestKey,status:"ready",data:current});
    }).catch((error)=>{if(!controller.signal.aborted && active.current && epoch.current===requestEpoch)setTermsRead({key:requestKey,status:"error",message:String(error)});});
    return ()=>controller.abort();
  },[canWrite,flowOpen,selectedAwardId,selectedProjectId,selectionEpoch,workspaceId,requestKey]);
  const awardTerms=flowOpen ? termsFor(flow.values) : null;
  const termsError=flowOpen && termsRead?.key===requestKey && termsRead.status==="error" ? termsRead.message : "";
  const currentReviewKey=awardTerms ? reviewKeyFor(flow.values,awardTerms) : null;
  const termsReviewed=currentReviewKey!==null && reviewedTermsKey===currentReviewKey;
  if (!canWrite) {
    return (
      <article className="border border-border/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.74),rgba(246,248,244,0.96))] px-5 py-5 shadow-[0_18px_40px_rgba(15,23,42,0.04)] dark:bg-[linear-gradient(180deg,rgba(15,23,32,0.86),rgba(11,18,26,0.96))]">
        <div className="flex items-start gap-3 border-b border-border/60 pb-4">
          <span className="mt-0.5 flex h-10 w-10 items-center justify-center border border-border/70 bg-background/70 text-muted-foreground">
            <FileSpreadsheet className="h-5 w-5" />
          </span>
          <div>
            <p className="text-label font-semibold text-muted-foreground">Invoice entry</p>
            <h2 className="text-lg font-semibold tracking-tight text-foreground">Read-only for member role</h2>
          </div>
        </div>
        <p className="mt-4 text-sm text-muted-foreground">
          Members can review the invoice register, but owner/admin role is required before OpenPlan will write new consulting invoice records.
        </p>
      </article>
    );
  }

  return (
    <article className="border border-border/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.74),rgba(246,248,244,0.96))] px-5 py-5 shadow-[0_18px_40px_rgba(15,23,42,0.04)] dark:bg-[linear-gradient(180deg,rgba(15,23,32,0.86),rgba(11,18,26,0.96))]">
      <div className="flex items-start gap-3 border-b border-border/60 pb-4">
        <span className="mt-0.5 flex h-10 w-10 items-center justify-center border border-emerald-300/40 bg-emerald-500/10 text-emerald-700 dark:border-emerald-700/30 dark:text-emerald-300">
          <FileSpreadsheet className="h-5 w-5" />
        </span>
        <div>
          <p className="text-label font-semibold text-muted-foreground">Invoice entry</p>
          <h2 className="text-lg font-semibold tracking-tight text-foreground">{titleLabel}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
      </div>

      {termsError ? <p role="alert">{termsError}</p>:null}
      {awardTerms?.award.latest_handoff_revision_id ? <details open><summary>Current award terms for reimbursement</summary><pre className="whitespace-pre-wrap break-words text-xs">{JSON.stringify(awardTerms.history.find((r)=>r.id===awardTerms.award.current_handoff_revision_id)?.terms ?? "No effective terms",null,2)}</pre><label><input type="checkbox" checked={termsReviewed} onChange={(e)=>setReviewedTermsKey(e.target.checked?currentReviewKey:null)} /> I reviewed this exact current terms version. The profile below is guidance, not established award applicability.</label></details>:null}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          type="button"
          onClick={() => {
            setMessage(null);
            invalidateSelection();
            flow.open();
          }}
          data-testid="invoice-record-composer-open"
        >
          <Plus className="mr-1.5 h-4 w-4" />
          {titleLabel}
        </Button>
        <ActionFeedback state={{ busy: false, error: null, details: null, message }} />
      </div>

      <GuidedFlow flow={flow} />
    </article>
  );
}
