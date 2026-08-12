"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { MEASURE_RECIPIENT_KINDS } from "@/lib/measures/fund";
import { MeasureField, MeasureSubmitFeedback, useMeasureSubmit } from "./measure-form-shell";

/**
 * The cities, districts and operators that claim against the fund.
 *
 * THERE IS NO DELETE BUTTON, and there is no DELETE policy on the table either.
 * A body that has been paid public money must keep appearing on the record that
 * paid it. Retiring one requires a reason, because retiring a recipient changes
 * what every OTHER jurisdiction receives from an apportioned category — a
 * silent change to a public split is the thing an oversight committee is there
 * to catch.
 */

export type MeasureRecipientRow = {
  id: string;
  name: string;
  recipientKind: string;
  externalReference: string | null;
  isActive: boolean;
  inactiveNote: string | null;
};

function kindLabel(value: string): string {
  return MEASURE_RECIPIENT_KINDS.find((entry) => entry.value === value)?.label ?? value;
}

export function RecipientComposer({
  measureId,
  recipients,
  canWrite,
}: {
  measureId: string;
  recipients: MeasureRecipientRow[];
  canWrite: boolean;
}) {
  const { state, submit } = useMeasureSubmit();
  const [name, setName] = useState("");
  const [recipientKind, setRecipientKind] = useState("other");
  const [externalReference, setExternalReference] = useState("");
  const [retiring, setRetiring] = useState<string | null>(null);
  const [inactiveNote, setInactiveNote] = useState("");

  async function addRecipient() {
    const created = await submit({
      url: `/api/measures/${measureId}/recipients`,
      method: "POST",
      successMessage: "Recipient added.",
      body: { name, recipientKind, externalReference: externalReference || undefined },
    });
    if (created) {
      setName("");
      setExternalReference("");
    }
  }

  async function setActive(recipientId: string, isActive: boolean) {
    const saved = await submit({
      url: `/api/measures/${measureId}/recipients`,
      method: "PATCH",
      successMessage: isActive ? "Recipient reactivated." : "Recipient retired.",
      body: {
        recipientId,
        isActive,
        inactiveNote: isActive ? null : inactiveNote,
      },
    });
    if (saved) {
      setRetiring(null);
      setInactiveNote("");
    }
  }

  return (
    <section className="rounded-[0.75rem] border border-border/70 bg-background/80 p-5">
      <h2 className="text-base font-semibold">Who claims against this measure</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        What a recipient may claim for comes from the ordinance&rsquo;s own categories, never from what kind of
        body it is.
      </p>

      <ul className="mt-4 divide-y divide-border/40">
        {recipients.map((recipient) => (
          <li key={recipient.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-medium">{recipient.name}</span>
                {recipient.isActive ? null : <StatusBadge tone="neutral">Retired</StatusBadge>}
              </div>
              <div className="text-xs text-muted-foreground">
                {kindLabel(recipient.recipientKind)}
                {recipient.externalReference ? ` · ${recipient.externalReference}` : ""}
              </div>
              {recipient.inactiveNote ? (
                <p className="mt-1 text-xs text-muted-foreground">Retired because: {recipient.inactiveNote}</p>
              ) : null}
            </div>

            {canWrite ? (
              <div className="flex flex-wrap items-end gap-2">
                {recipient.isActive ? (
                  retiring === recipient.id ? (
                    <>
                      <Input
                        aria-label={`Why ${recipient.name} is being retired`}
                        className="w-64"
                        placeholder="Why is this recipient being retired?"
                        value={inactiveNote}
                        onChange={(event) => setInactiveNote(event.target.value)}
                      />
                      <Button
                        type="button"
                        size="sm"
                        disabled={state.busy || !inactiveNote.trim()}
                        onClick={() => setActive(recipient.id, false)}
                      >
                        Retire
                      </Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => setRetiring(null)}>
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <Button type="button" size="sm" variant="outline" onClick={() => setRetiring(recipient.id)}>
                      Retire
                    </Button>
                  )
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={state.busy}
                    onClick={() => setActive(recipient.id, true)}
                  >
                    Reactivate
                  </Button>
                )}
              </div>
            ) : null}
          </li>
        ))}
        {recipients.length === 0 ? (
          <li className="py-4 text-sm text-muted-foreground">No recipients yet.</li>
        ) : null}
      </ul>

      {canWrite ? (
        <div className="mt-4 grid gap-3 rounded-[0.5rem] border border-border/70 p-4 md:grid-cols-4">
          <div className="md:col-span-2">
            <MeasureField label="Name" htmlFor="recipient-name">
              <Input id="recipient-name" value={name} onChange={(event) => setName(event.target.value)} />
            </MeasureField>
          </div>
          <MeasureField label="Kind" htmlFor="recipient-kind">
            <select
              id="recipient-kind"
              className="flex h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
              value={recipientKind}
              onChange={(event) => setRecipientKind(event.target.value)}
            >
              {MEASURE_RECIPIENT_KINDS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </MeasureField>
          <MeasureField label="Your reference" htmlFor="recipient-reference">
            <Input
              id="recipient-reference"
              value={externalReference}
              onChange={(event) => setExternalReference(event.target.value)}
            />
          </MeasureField>
          <div className="md:col-span-4 flex flex-wrap items-center gap-3">
            <Button type="button" onClick={addRecipient} disabled={state.busy || !name.trim()}>
              Add recipient
            </Button>
            <MeasureSubmitFeedback state={state} />
          </div>
        </div>
      ) : null}
    </section>
  );
}
