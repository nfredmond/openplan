"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function ProjectFundingProfileEditor({
  projectId,
  initialFundingNeedAmount,
  initialLocalMatchNeedAmount,
  initialNotes,
}: {
  projectId: string;
  initialFundingNeedAmount?: number | null;
  initialLocalMatchNeedAmount?: number | null;
  initialNotes?: string | null;
}) {
  const router = useRouter();
  const [fundingNeedAmount, setFundingNeedAmount] = useState(initialFundingNeedAmount?.toString() ?? "");
  const [localMatchNeedAmount, setLocalMatchNeedAmount] = useState(initialLocalMatchNeedAmount?.toString() ?? "");
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setFundingNeedAmount(initialFundingNeedAmount?.toString() ?? "");
  }, [initialFundingNeedAmount]);

  useEffect(() => {
    setLocalMatchNeedAmount(initialLocalMatchNeedAmount?.toString() ?? "");
  }, [initialLocalMatchNeedAmount]);

  useEffect(() => {
    setNotes(initialNotes ?? "");
  }, [initialNotes]);

  async function handleSave() {
    setIsSaving(true);
    setMessage(null);
    setError(null);

    try {
      const response = await fetch(`/api/projects/${projectId}/funding-profile`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fundingNeedAmount: fundingNeedAmount ? Number(fundingNeedAmount) : null,
          localMatchNeedAmount: localMatchNeedAmount ? Number(localMatchNeedAmount) : null,
          notes: notes || null,
        }),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to save funding profile");
      }

      setMessage("Funding profile saved.");
      router.refresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save funding profile");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="rounded-[0.5rem] border border-border/70 bg-background/80 p-4">
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="project-funding-need-amount" className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Funding need</label>
          <Input id="project-funding-need-amount" value={fundingNeedAmount} onChange={(event) => setFundingNeedAmount(event.target.value)} inputMode="decimal" placeholder="2500000" />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="project-local-match-need-amount" className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Local match need</label>
          <Input id="project-local-match-need-amount" value={localMatchNeedAmount} onChange={(event) => setLocalMatchNeedAmount(event.target.value)} inputMode="decimal" placeholder="500000" />
        </div>
      </div>

      <div className="mt-3 space-y-1.5">
        <label htmlFor="project-funding-profile-notes" className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Notes</label>
        <Textarea id="project-funding-profile-notes" rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Capture the target funding need or any funding stack assumptions for this project." />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button type="button" onClick={handleSave} disabled={isSaving}>
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save funding profile
        </Button>
        {message ? <p className="text-sm text-emerald-700 dark:text-emerald-300">{message}</p> : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>
    </div>
  );
}
