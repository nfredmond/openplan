"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export const ENGAGEMENT_KIND_OPTIONS = [
  { value: "contract", label: "Contract" },
  { value: "task_order", label: "Task order" },
  { value: "on_call", label: "On-call" },
  { value: "other", label: "Other" },
] as const;

const BILLING_BASIS_OPTIONS = [
  { value: "", label: "Not specified" },
  { value: "time_and_materials", label: "Time and materials" },
  { value: "lump_sum", label: "Lump sum" },
  { value: "cost_plus", label: "Cost plus" },
  { value: "milestone", label: "Milestone" },
  { value: "progress_payment", label: "Progress payment" },
] as const;

const ENGAGEMENT_STATUS_OPTIONS = [
  { value: "pending", label: "Pending" },
  { value: "active", label: "Active" },
  { value: "closed", label: "Closed" },
] as const;

export type EngagementComposerRecord = {
  id: string;
  clientId: string;
  projectId: string | null;
  title: string;
  referenceCode: string | null;
  engagementKind: string;
  billingBasis: string | null;
  notToExceedAmount: number | string | null;
  startDate: string | null;
  endDate: string | null;
  status: string;
  notes: string | null;
};

type EngagementComposerProps = {
  workspaceId: string;
  canWrite: boolean;
  clients: Array<{ id: string; name: string }>;
  projects: Array<{ id: string; name: string }>;
  /** When set, the composer edits this engagement in place; otherwise it creates. */
  engagement?: EngagementComposerRecord | null;
  defaultClientId?: string | null;
};

/**
 * Inline create/edit for engagements — the contract, task order, or on-call
 * vehicle a client invoice bills under, including its not-to-exceed ceiling.
 */
export function EngagementComposer({
  workspaceId,
  canWrite,
  clients,
  projects,
  engagement = null,
  defaultClientId = null,
}: EngagementComposerProps) {
  const router = useRouter();
  const isEdit = Boolean(engagement);
  const [open, setOpen] = useState(false);
  const [clientId, setClientId] = useState(engagement?.clientId ?? defaultClientId ?? "");
  const [projectId, setProjectId] = useState(engagement?.projectId ?? "");
  const [title, setTitle] = useState(engagement?.title ?? "");
  const [referenceCode, setReferenceCode] = useState(engagement?.referenceCode ?? "");
  const [engagementKind, setEngagementKind] = useState(engagement?.engagementKind ?? "contract");
  const [billingBasis, setBillingBasis] = useState(engagement?.billingBasis ?? "");
  const [notToExceedAmount, setNotToExceedAmount] = useState(
    engagement?.notToExceedAmount != null ? String(engagement.notToExceedAmount) : ""
  );
  const [startDate, setStartDate] = useState(engagement?.startDate ?? "");
  const [endDate, setEndDate] = useState(engagement?.endDate ?? "");
  const [status, setStatus] = useState(engagement?.status ?? "active");
  const [notes, setNotes] = useState(engagement?.notes ?? "");
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
        clientId,
        projectId: projectId || undefined,
        title,
        referenceCode: referenceCode || undefined,
        engagementKind,
        billingBasis: billingBasis || undefined,
        notToExceedAmount: notToExceedAmount === "" ? undefined : Number(notToExceedAmount),
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        status,
        notes: notes || undefined,
      };
      const response = await fetch(
        isEdit ? `/api/invoicing/engagements/${engagement!.id}` : "/api/invoicing/engagements",
        {
          method: isEdit ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      const payload = (await response.json()) as { error?: string; details?: string };
      if (!response.ok) {
        throw new Error(payload.details || payload.error || "Failed to save engagement");
      }

      if (!isEdit) {
        setTitle("");
        setReferenceCode("");
        setNotToExceedAmount("");
        setStartDate("");
        setEndDate("");
        setNotes("");
      }
      setOpen(false);
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to save engagement");
    } finally {
      setIsSaving(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="openplan-inline-label" onClick={() => setOpen(true)}>
        {isEdit ? "Edit engagement" : "Add engagement"}
      </button>
    );
  }

  const idSuffix = engagement?.id ?? "new";

  return (
    <form className="mt-2 space-y-3 border border-border/60 bg-background/70 px-4 py-4" onSubmit={handleSubmit}>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor={`engagement-title-${idSuffix}`} className="text-sm font-medium">
            Engagement title
          </label>
          <Input
            id={`engagement-title-${idSuffix}`}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Corridor study on-call, task order 3, …"
            required
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`engagement-client-${idSuffix}`} className="text-sm font-medium">
            Client
          </label>
          <select
            id={`engagement-client-${idSuffix}`}
            className="module-select"
            value={clientId}
            onChange={(event) => setClientId(event.target.value)}
            required
          >
            <option value="">Choose a client</option>
            {clients.map((clientOption) => (
              <option key={clientOption.id} value={clientOption.id}>
                {clientOption.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="space-y-1.5">
          <label htmlFor={`engagement-kind-${idSuffix}`} className="text-sm font-medium">
            Kind
          </label>
          <select
            id={`engagement-kind-${idSuffix}`}
            className="module-select"
            value={engagementKind}
            onChange={(event) => setEngagementKind(event.target.value)}
          >
            {ENGAGEMENT_KIND_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`engagement-basis-${idSuffix}`} className="text-sm font-medium">
            Billing basis
          </label>
          <select
            id={`engagement-basis-${idSuffix}`}
            className="module-select"
            value={billingBasis}
            onChange={(event) => setBillingBasis(event.target.value)}
          >
            {BILLING_BASIS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`engagement-nte-${idSuffix}`} className="text-sm font-medium">
            Not-to-exceed
          </label>
          <Input
            id={`engagement-nte-${idSuffix}`}
            type="number"
            min="0"
            step="0.01"
            value={notToExceedAmount}
            onChange={(event) => setNotToExceedAmount(event.target.value)}
            placeholder="No ceiling"
          />
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <div className="space-y-1.5">
          <label htmlFor={`engagement-project-${idSuffix}`} className="text-sm font-medium">
            Project link
          </label>
          <select
            id={`engagement-project-${idSuffix}`}
            className="module-select"
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
          >
            <option value="">No linked project</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`engagement-reference-${idSuffix}`} className="text-sm font-medium">
            Reference code
          </label>
          <Input
            id={`engagement-reference-${idSuffix}`}
            value={referenceCode}
            onChange={(event) => setReferenceCode(event.target.value)}
            placeholder="Contract or PO number"
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`engagement-start-${idSuffix}`} className="text-sm font-medium">
            Start date
          </label>
          <Input id={`engagement-start-${idSuffix}`} type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`engagement-end-${idSuffix}`} className="text-sm font-medium">
            End date
          </label>
          <Input id={`engagement-end-${idSuffix}`} type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor={`engagement-status-${idSuffix}`} className="text-sm font-medium">
            Status
          </label>
          <select
            id={`engagement-status-${idSuffix}`}
            className="module-select"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            {ENGAGEMENT_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`engagement-notes-${idSuffix}`} className="text-sm font-medium">
            Notes
          </label>
          <Textarea
            id={`engagement-notes-${idSuffix}`}
            rows={2}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </div>
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
            "Save engagement"
          ) : (
            "Create engagement"
          )}
        </Button>
        <button type="button" className="openplan-inline-label openplan-inline-label-muted" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
