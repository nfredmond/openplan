"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export const CLIENT_KIND_OPTIONS = [
  { value: "public_agency", label: "Public agency" },
  { value: "tribal_government", label: "Tribal government" },
  { value: "prime_contractor", label: "Prime contractor" },
  { value: "nonprofit", label: "Nonprofit" },
  { value: "private", label: "Private" },
  { value: "other", label: "Other" },
] as const;

export type ClientComposerRecord = {
  id: string;
  name: string;
  clientKind: string;
  billingAddress: string | null;
  contactName: string | null;
  contactEmail: string | null;
  notes: string | null;
};

type ClientComposerProps = {
  workspaceId: string;
  canWrite: boolean;
  /** When set, the composer edits this client in place; otherwise it creates. */
  client?: ClientComposerRecord | null;
};

/**
 * Inline create/edit for invoicing clients — who this workspace bills.
 * Create mode renders collapsed behind an "Add client" toggle; edit mode
 * renders collapsed behind an "Edit" toggle on the client's own card.
 */
export function ClientComposer({ workspaceId, canWrite, client = null }: ClientComposerProps) {
  const router = useRouter();
  const isEdit = Boolean(client);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(client?.name ?? "");
  const [clientKind, setClientKind] = useState(client?.clientKind ?? "public_agency");
  const [contactName, setContactName] = useState(client?.contactName ?? "");
  const [contactEmail, setContactEmail] = useState(client?.contactEmail ?? "");
  const [billingAddress, setBillingAddress] = useState(client?.billingAddress ?? "");
  const [notes, setNotes] = useState(client?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  if (!canWrite) {
    return null;
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSaving(true);

    try {
      const body = {
        workspaceId,
        name,
        clientKind,
        contactName: contactName || undefined,
        contactEmail: contactEmail || undefined,
        billingAddress: billingAddress || undefined,
        notes: notes || undefined,
      };
      const response = await fetch(
        isEdit ? `/api/invoicing/clients/${client!.id}` : "/api/invoicing/clients",
        {
          method: isEdit ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      const payload = (await response.json()) as { error?: string; details?: string };
      if (!response.ok) {
        throw new Error(payload.details || payload.error || "Failed to save client");
      }

      if (!isEdit) {
        setName("");
        setClientKind("public_agency");
        setContactName("");
        setContactEmail("");
        setBillingAddress("");
        setNotes("");
      }
      setOpen(false);
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to save client");
    } finally {
      setIsSaving(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="openplan-inline-label" onClick={() => setOpen(true)}>
        {isEdit ? "Edit client" : "Add client"}
      </button>
    );
  }

  return (
    <form className="mt-2 space-y-3 border border-border/60 bg-background/70 px-4 py-4" onSubmit={handleSubmit}>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor={`client-name-${client?.id ?? "new"}`} className="text-sm font-medium">
            Client name
          </label>
          <Input
            id={`client-name-${client?.id ?? "new"}`}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="City, county, agency, prime, or firm"
            required
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`client-kind-${client?.id ?? "new"}`} className="text-sm font-medium">
            Client kind
          </label>
          <select
            id={`client-kind-${client?.id ?? "new"}`}
            className="module-select"
            value={clientKind}
            onChange={(event) => setClientKind(event.target.value)}
          >
            {CLIENT_KIND_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor={`client-contact-name-${client?.id ?? "new"}`} className="text-sm font-medium">
            Contact name
          </label>
          <Input
            id={`client-contact-name-${client?.id ?? "new"}`}
            value={contactName}
            onChange={(event) => setContactName(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`client-contact-email-${client?.id ?? "new"}`} className="text-sm font-medium">
            Contact email
          </label>
          <Input
            id={`client-contact-email-${client?.id ?? "new"}`}
            type="email"
            value={contactEmail}
            onChange={(event) => setContactEmail(event.target.value)}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <label htmlFor={`client-billing-address-${client?.id ?? "new"}`} className="text-sm font-medium">
          Billing address
        </label>
        <Textarea
          id={`client-billing-address-${client?.id ?? "new"}`}
          rows={2}
          value={billingAddress}
          onChange={(event) => setBillingAddress(event.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor={`client-notes-${client?.id ?? "new"}`} className="text-sm font-medium">
          Notes
        </label>
        <Textarea
          id={`client-notes-${client?.id ?? "new"}`}
          rows={2}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </div>

      {error ? (
        <p className="border-l-2 border-red-400 bg-red-50/80 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/20 dark:text-red-200">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={isSaving}>
          {isSaving ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Saving…
            </span>
          ) : isEdit ? (
            "Save client"
          ) : (
            "Create client"
          )}
        </Button>
        <button type="button" className="openplan-inline-label openplan-inline-label-muted" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
