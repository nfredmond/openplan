"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type FundingAwardOption = {
  id: string;
  title: string;
  projectId: string | null;
};

type InvoiceFundingAwardLinkerProps = {
  invoiceId: string;
  workspaceId: string;
  projectId: string | null;
  currentFundingAwardId?: string | null;
  fundingAwards: FundingAwardOption[];
  canWrite: boolean;
};

export function InvoiceFundingAwardLinker({
  invoiceId,
  workspaceId,
  projectId,
  currentFundingAwardId = null,
  fundingAwards,
  canWrite,
}: InvoiceFundingAwardLinkerProps) {
  const router = useRouter();
  const [selectedFundingAwardId, setSelectedFundingAwardId] = useState(currentFundingAwardId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const visibleFundingAwards = useMemo(
    () => fundingAwards.filter((award) => !projectId || !award.projectId || award.projectId === projectId),
    [fundingAwards, projectId]
  );

  useEffect(() => {
    setSelectedFundingAwardId(currentFundingAwardId ?? "");
  }, [currentFundingAwardId]);

  useEffect(() => {
    if (selectedFundingAwardId && !visibleFundingAwards.some((award) => award.id === selectedFundingAwardId)) {
      setSelectedFundingAwardId("");
    }
  }, [selectedFundingAwardId, visibleFundingAwards]);

  const hasChanges = (selectedFundingAwardId || null) !== (currentFundingAwardId || null);

  async function handleSave() {
    if (!canWrite || !hasChanges) return;

    setError(null);
    setIsSaving(true);

    try {
      const response = await fetch(`/api/billing/invoices/${invoiceId}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          workspaceId,
          fundingAwardId: selectedFundingAwardId || null,
        }),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to update invoice funding award link");
      }

      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to update invoice funding award link");
    } finally {
      setIsSaving(false);
    }
  }

  if (!canWrite) {
    return null;
  }

  return (
    <div className="mt-3 rounded-2xl border border-border/60 bg-muted/15 px-3 py-3">
      <div className="flex flex-wrap items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-xl border border-border/60 bg-background/80 text-muted-foreground">
          <Link2 className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Funding award link</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Attach this invoice to the correct award without leaving the billing register.
            </p>
          </div>

          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <select
              aria-label="Funding award link"
              className="module-select md:max-w-sm"
              value={selectedFundingAwardId}
              onChange={(event) => setSelectedFundingAwardId(event.target.value)}
            >
              <option value="">No linked funding award</option>
              {visibleFundingAwards.map((award) => (
                <option key={award.id} value={award.id}>
                  {award.title}
                </option>
              ))}
            </select>

            <Button type="button" variant="outline" size="sm" onClick={() => void handleSave()} disabled={!hasChanges || isSaving}>
              {isSaving ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving link…
                </span>
              ) : (
                "Save funding link"
              )}
            </Button>
          </div>

          {visibleFundingAwards.length === 0 ? (
            <p className="text-xs text-muted-foreground">No funding awards are available for this invoice’s project yet.</p>
          ) : null}

          {error ? <p className="text-xs text-red-600 dark:text-red-300">{error}</p> : null}
        </div>
      </div>
    </div>
  );
}
