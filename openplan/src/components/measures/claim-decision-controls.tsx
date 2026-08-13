"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  formatMeasureClaimStatusLabel,
  MEASURE_CLAIM_DOCUMENT_ROLES,
  MEASURE_CLAIM_STATUS_OPTIONS,
  MEASURE_CLAIM_TRANSITIONS,
  type MeasureClaimStatus,
} from "@/lib/measures/claims";
import { MeasureField, MeasureSubmitFeedback, useMeasureSubmit } from "./measure-form-shell";
import { formatMoney } from "@/lib/money/format";

/**
 * Deciding one claim — the control that moves public money.
 *
 * WHAT THIS COMPONENT REFUSES TO SHOW is as deliberate as what it shows. The
 * buttons come from `MEASURE_CLAIM_TRANSITIONS`, so a paid or denied claim
 * offers none: reversing either is a new record (a refund, a fresh claim), not
 * an edit of this one. The server refuses the same moves, and the table is
 * shared rather than restated here — two lifecycles is two answers to what a
 * claim can become next.
 *
 * DENYING DEMANDS A REASON and PAYING DEMANDS A DATE, both before the button
 * enables. The database CHECKs both, so this is the second line rather than the
 * only one; it exists so a reviewer reads a sentence instead of a constraint
 * name.
 *
 * WHO DECIDED IS NEVER A FIELD HERE. The route stamps `decided_by` from the
 * session. A decision author a form could name is not an author.
 */

export type ClaimDecisionClaim = {
  id: string;
  status: string;
  recipientName: string;
  categoryId: string;
  fiscalYearLabel: string;
  grossAmount: number;
  netAmount: number;
  retentionWithheld: number;
  submittedOn: string | null;
  paidOn: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  denialReason: string | null;
  documentCount: number;
  documents: Array<{ id: string; kbDocumentId: string; title: string; documentRole: string }>;
};

/** Documents the workspace already holds. Attaching links one; it uploads nothing. */
export type ClaimAttachableDocument = { id: string; title: string };

function tone(status: string) {
  return MEASURE_CLAIM_STATUS_OPTIONS.find((option) => option.value === status)?.tone ?? "neutral";
}

export function ClaimDecisionControls({
  measureId,
  claim,
  currencyCode,
  canDecide,
  canWrite,
  attachableDocuments,
}: {
  measureId: string;
  claim: ClaimDecisionClaim;
  currencyCode: string;
  /** True only for a role the money gate admits. Members see the record, not the buttons. */
  canDecide: boolean;
  /** True for anyone who may change workspace content: attach backup, discard a draft. */
  canWrite: boolean;
  attachableDocuments: ClaimAttachableDocument[];
}) {
  const { state, submit } = useMeasureSubmit();
  const [pending, setPending] = useState<MeasureClaimStatus | null>(null);
  const [decisionNote, setDecisionNote] = useState("");
  const [denialReason, setDenialReason] = useState("");
  const [paidOn, setPaidOn] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [attaching, setAttaching] = useState(false);
  const [kbDocumentId, setKbDocumentId] = useState("");
  const [documentRole, setDocumentRole] = useState("other");

  const allowed = MEASURE_CLAIM_TRANSITIONS[claim.status as MeasureClaimStatus] ?? [];
  // A claim's gross, retention, and net are what the recipient is paid against.
  // Cents, in the measure's declared currency — never the browser's locale.
  const money = (value: number) => formatMoney(value, { precision: "cents", currency: currencyCode });

  async function applyTransition(next: MeasureClaimStatus) {
    const saved = await submit({
      url: `/api/measures/${measureId}/claims/${claim.id}`,
      method: "PATCH",
      successMessage: `Claim set to ${formatMeasureClaimStatusLabel(next)}.`,
      body: {
        status: next,
        decisionNote: decisionNote || undefined,
        denialReason: next === "denied" ? denialReason : undefined,
        paidOn: next === "paid" ? paidOn : undefined,
        paymentReference: next === "paid" ? paymentReference || undefined : undefined,
      },
    });
    if (saved) {
      setPending(null);
      setDecisionNote("");
      setDenialReason("");
      setPaidOn("");
      setPaymentReference("");
    }
  }

  async function attachDocument() {
    const attached = await submit({
      url: `/api/measures/${measureId}/claims/${claim.id}/documents`,
      method: "POST",
      successMessage: "Backup attached.",
      body: { kbDocumentId, documentRole },
    });
    if (attached) {
      setKbDocumentId("");
      setAttaching(false);
    }
  }

  async function detachDocument(claimDocumentId: string) {
    // Removes the LINK. The file stays in the Knowledge Base where it was
    // uploaded; nothing on this page can delete a workspace's document.
    await submit({
      url: `/api/measures/${measureId}/claims/${claim.id}/documents`,
      method: "DELETE",
      successMessage: "Backup detached. The document itself is untouched.",
      body: { claimDocumentId },
    });
  }

  async function discardDraft() {
    await submit({
      url: `/api/measures/${measureId}/claims/${claim.id}`,
      method: "DELETE",
      successMessage: "Draft discarded.",
    });
  }

  return (
    <div className="rounded-[0.5rem] border border-border/70 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{claim.recipientName}</span>
            <StatusBadge tone={tone(claim.status)}>{formatMeasureClaimStatusLabel(claim.status)}</StatusBadge>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {claim.categoryId} · {claim.fiscalYearLabel}
            {claim.submittedOn ? ` · submitted ${claim.submittedOn}` : ""}
            {claim.paidOn ? ` · paid ${claim.paidOn}` : ""}
          </div>
          <div className="mt-2 text-sm tabular-nums">
            {money(claim.grossAmount)} claimed
            {claim.retentionWithheld > 0 ? (
              <span className="text-muted-foreground">
                {" "}
                · {money(claim.retentionWithheld)} retained · {money(claim.netAmount)} net
              </span>
            ) : null}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {claim.documentCount > 0
              ? `${claim.documentCount} backup document(s) attached`
              : "No backup attached"}
          </div>
          {claim.denialReason ? (
            <p className="mt-2 text-sm text-destructive">Denied because: {claim.denialReason}</p>
          ) : null}
          {claim.decisionNote ? (
            <p className="mt-1 text-sm text-muted-foreground">Note: {claim.decisionNote}</p>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          {canDecide
            ? allowed.map((next) => (
                <Button
                  key={next}
                  type="button"
                  size="sm"
                  variant={next === "denied" ? "outline" : "default"}
                  disabled={state.busy}
                  onClick={() => setPending(pending === next ? null : next)}
                >
                  {formatMeasureClaimStatusLabel(next)}
                </Button>
              ))
            : null}
          {canWrite ? (
            <Button type="button" size="sm" variant="ghost" onClick={() => setAttaching((open) => !open)}>
              {attaching ? "Cancel" : "Attach backup"}
            </Button>
          ) : null}
          {canWrite && claim.status === "draft" ? (
            <Button type="button" size="sm" variant="ghost" disabled={state.busy} onClick={discardDraft}>
              Discard draft
            </Button>
          ) : null}
        </div>
      </div>

      {claim.documents.length > 0 ? (
        <ul className="mt-3 space-y-1 border-t border-border/40 pt-3 text-sm">
          {claim.documents.map((document) => (
            <li key={document.id} className="flex flex-wrap items-center justify-between gap-2">
              <span>
                {document.title}
                <span className="ml-2 text-xs text-muted-foreground">
                  {MEASURE_CLAIM_DOCUMENT_ROLES.find((role) => role.value === document.documentRole)?.label ??
                    document.documentRole}
                </span>
              </span>
              {canWrite ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={state.busy}
                  onClick={() => detachDocument(document.id)}
                >
                  Detach
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {canWrite && attaching ? (
        <div className="mt-3 grid gap-3 border-t border-border/40 pt-3 md:grid-cols-3">
          <div className="md:col-span-2">
            <MeasureField
              label="Document"
              htmlFor={`attach-doc-${claim.id}`}
              hint="Files live in the Knowledge Base. This links one to the claim; it does not upload or copy anything."
            >
              <select
                id={`attach-doc-${claim.id}`}
                className="flex h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
                value={kbDocumentId}
                onChange={(event) => setKbDocumentId(event.target.value)}
              >
                <option value="">Choose…</option>
                {attachableDocuments.map((document) => (
                  <option key={document.id} value={document.id}>
                    {document.title}
                  </option>
                ))}
              </select>
            </MeasureField>
          </div>
          <MeasureField label="What it is" htmlFor={`attach-role-${claim.id}`}>
            <select
              id={`attach-role-${claim.id}`}
              className="flex h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
              value={documentRole}
              onChange={(event) => setDocumentRole(event.target.value)}
            >
              {MEASURE_CLAIM_DOCUMENT_ROLES.map((role) => (
                <option key={role.value} value={role.value}>
                  {role.label}
                </option>
              ))}
            </select>
          </MeasureField>
          <div className="md:col-span-3">
            <Button type="button" disabled={state.busy || !kbDocumentId} onClick={attachDocument}>
              Attach
            </Button>
          </div>
        </div>
      ) : null}

      {canDecide && pending ? (
        <div className="mt-3 grid gap-3 border-t border-border/40 pt-3 md:grid-cols-2">
          {pending === "denied" ? (
            <div className="md:col-span-2">
              <MeasureField
                label="Why is this claim denied?"
                htmlFor={`deny-reason-${claim.id}`}
                hint="The claimant is a separate public body. A refusal with no reason cannot be appealed or corrected."
              >
                <Textarea
                  id={`deny-reason-${claim.id}`}
                  rows={3}
                  value={denialReason}
                  onChange={(event) => setDenialReason(event.target.value)}
                />
              </MeasureField>
            </div>
          ) : null}

          {pending === "paid" ? (
            <>
              <MeasureField
                label="Paid on"
                htmlFor={`paid-on-${claim.id}`}
                hint="Money leaving a public fund is dated. Required."
              >
                <Input
                  id={`paid-on-${claim.id}`}
                  type="date"
                  value={paidOn}
                  onChange={(event) => setPaidOn(event.target.value)}
                />
              </MeasureField>
              <MeasureField label="Payment reference" htmlFor={`payment-ref-${claim.id}`}>
                <Input
                  id={`payment-ref-${claim.id}`}
                  value={paymentReference}
                  onChange={(event) => setPaymentReference(event.target.value)}
                />
              </MeasureField>
            </>
          ) : null}

          <div className="md:col-span-2">
            <MeasureField label="Note for the record" htmlFor={`decision-note-${claim.id}`}>
              <Textarea
                id={`decision-note-${claim.id}`}
                rows={2}
                value={decisionNote}
                onChange={(event) => setDecisionNote(event.target.value)}
              />
            </MeasureField>
          </div>

          <div className="md:col-span-2 flex flex-wrap items-center gap-3">
            <Button
              type="button"
              disabled={
                state.busy ||
                (pending === "denied" && !denialReason.trim()) ||
                (pending === "paid" && !paidOn)
              }
              onClick={() => applyTransition(pending)}
            >
              Confirm: {formatMeasureClaimStatusLabel(pending)}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setPending(null)}>
              Cancel
            </Button>
            <MeasureSubmitFeedback state={state} />
          </div>
        </div>
      ) : null}

      {!pending ? (
        <div className="mt-2">
          <MeasureSubmitFeedback state={state} />
        </div>
      ) : null}
    </div>
  );
}
