"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { MeasureField, MeasureSubmitFeedback, useMeasureSubmit } from "./measure-form-shell";

/**
 * Filing a claim against the fund.
 *
 * THE CATEGORY LIST IS THE MEASURE'S OWN. It is passed in from the allocation
 * rule in force (or, for an ordinance recorded as narrative text, from the
 * categories somebody has actually allocated to). There is no category list in
 * this file and none anywhere else in the product — every ordinance slices
 * differently, so the split is data.
 *
 * WHEN THE MEASURE HAS DECLARED NOTHING, this form refuses to render a claim
 * box and says what is missing instead. A free-text category would make the
 * server's eligibility check decorative, and the first thing a decorative check
 * costs is a claim paid out of a category the ordinance does not fund.
 *
 * THIS FORM CANNOT APPROVE ANYTHING. It files a draft or submits it; every
 * state past that needs an owner or admin and lives in the decision controls.
 */

export type ClaimComposerCategory = { id: string; label: string };

export function ClaimComposer({
  measureId,
  recipients,
  periods,
  categories,
  categorySource,
  currencyCode,
  canWrite,
}: {
  measureId: string;
  recipients: Array<{ id: string; name: string; isActive: boolean }>;
  periods: Array<{ id: string; periodLabel: string; fiscalYearLabel: string }>;
  categories: ClaimComposerCategory[];
  categorySource: "ordinance_rule" | "recorded_allocations" | "none";
  currencyCode: string;
  canWrite: boolean;
}) {
  const { state, submit } = useMeasureSubmit();
  const [recipientId, setRecipientId] = useState("");
  const [periodId, setPeriodId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [amount, setAmount] = useState("");
  const [retentionPercent, setRetentionPercent] = useState("");
  const [claimReference, setClaimReference] = useState("");
  const [description, setDescription] = useState("");

  const activeRecipients = recipients.filter((recipient) => recipient.isActive);

  async function fileClaim(status: "draft" | "submitted") {
    const created = await submit({
      url: `/api/measures/${measureId}/claims`,
      method: "POST",
      successMessage: status === "draft" ? "Draft claim saved." : "Claim submitted for review.",
      body: {
        recipientId,
        periodId,
        categoryId,
        amount,
        retentionPercent: retentionPercent || undefined,
        claimReference: claimReference || undefined,
        description: description || undefined,
        status,
      },
    });
    if (created) {
      setAmount("");
      setClaimReference("");
      setDescription("");
    }
  }

  if (!canWrite) return null;

  if (categorySource === "none" || categories.length === 0) {
    return (
      <section className="rounded-[0.75rem] border border-border/70 bg-background/80 p-5">
        <h2 className="text-base font-semibold">File a claim</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          This measure has not recorded what its money may be spent on yet. Record the ordinance&rsquo;s allocation
          rule, or — if the ordinance does not fit the rule form — enter a period&rsquo;s allocations by hand. A
          claim has to be for something the measure says it pays for.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-[0.75rem] border border-border/70 bg-background/80 p-5">
      <h2 className="text-base font-semibold">File a claim</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {categorySource === "ordinance_rule"
          ? "The categories below come from the ordinance rule in force for the period you pick."
          : "This measure's ordinance is recorded as text, so the categories below are the ones staff have already allocated to."}
      </p>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <MeasureField label="Recipient" htmlFor="claim-recipient">
          <select
            id="claim-recipient"
            className="flex h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
            value={recipientId}
            onChange={(event) => setRecipientId(event.target.value)}
          >
            <option value="">Choose…</option>
            {activeRecipients.map((recipient) => (
              <option key={recipient.id} value={recipient.id}>
                {recipient.name}
              </option>
            ))}
          </select>
        </MeasureField>

        <MeasureField label="Period" htmlFor="claim-period" hint="Which period the spending belongs to.">
          <select
            id="claim-period"
            className="flex h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
            value={periodId}
            onChange={(event) => setPeriodId(event.target.value)}
          >
            <option value="">Choose…</option>
            {periods.map((period) => (
              <option key={period.id} value={period.id}>
                {period.periodLabel} ({period.fiscalYearLabel})
              </option>
            ))}
          </select>
        </MeasureField>

        <MeasureField label="Category" htmlFor="claim-category">
          <select
            id="claim-category"
            className="flex h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
          >
            <option value="">Choose…</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.label}
              </option>
            ))}
          </select>
        </MeasureField>

        <MeasureField label={`Amount (${currencyCode})`} htmlFor="claim-amount">
          <Input
            id="claim-amount"
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </MeasureField>

        <MeasureField
          label="Retention %"
          htmlFor="claim-retention"
          hint="Leave empty if this fund withholds nothing."
        >
          <Input
            id="claim-retention"
            type="number"
            min="0"
            max="100"
            step="0.001"
            value={retentionPercent}
            onChange={(event) => setRetentionPercent(event.target.value)}
          />
        </MeasureField>

        <MeasureField label="Claimant's reference" htmlFor="claim-reference">
          <Input
            id="claim-reference"
            value={claimReference}
            onChange={(event) => setClaimReference(event.target.value)}
          />
        </MeasureField>

        <div className="md:col-span-3">
          <MeasureField label="What this claim is for" htmlFor="claim-description">
            <Textarea
              id="claim-description"
              rows={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </MeasureField>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={state.busy || !recipientId || !periodId || !categoryId || !amount}
          onClick={() => fileClaim("draft")}
        >
          Save as draft
        </Button>
        <Button
          type="button"
          disabled={state.busy || !recipientId || !periodId || !categoryId || !amount}
          onClick={() => fileClaim("submitted")}
        >
          Submit the claim
        </Button>
        <MeasureSubmitFeedback state={state} />
      </div>
    </section>
  );
}
