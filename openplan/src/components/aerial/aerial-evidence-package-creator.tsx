"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Package, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  formatAerialPackageStatusLabel,
  formatAerialVerificationReadinessLabel,
  type AerialPackageStatus,
  type AerialVerificationReadiness,
} from "@/lib/aerial/catalog";

type PackageType = "measurable_output" | "qa_bundle" | "share_package";

const PACKAGE_TYPES: Array<{ value: PackageType; label: string }> = [
  { value: "measurable_output", label: "Measurable output" },
  { value: "qa_bundle", label: "QA bundle" },
  { value: "share_package", label: "Share package" },
];

const PACKAGE_STATUSES: AerialPackageStatus[] = ["processing", "qa_pending", "ready", "shared"];
const VERIFICATION_READINESS_OPTIONS: AerialVerificationReadiness[] = [
  "pending",
  "partial",
  "ready",
  "not_applicable",
];

export function AerialEvidencePackageCreator({
  missionOptions,
  defaultMissionId,
}: {
  missionOptions: Array<{ id: string; title: string }>;
  defaultMissionId?: string;
}) {
  const router = useRouter();
  const [missionId, setMissionId] = useState(defaultMissionId ?? missionOptions[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [packageType, setPackageType] = useState<PackageType>("measurable_output");
  const [status, setStatus] = useState<AerialPackageStatus>("processing");
  const [verificationReadiness, setVerificationReadiness] = useState<AerialVerificationReadiness>("pending");
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/aerial/evidence-packages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          missionId,
          title,
          packageType,
          status,
          verificationReadiness,
          notes: notes || undefined,
        }),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to create evidence package");
      }

      setTitle("");
      setPackageType("measurable_output");
      setStatus("processing");
      setVerificationReadiness("pending");
      setNotes("");
      setMessage("Evidence package logged.");
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to create evidence package");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (missionOptions.length === 0) return null;

  return (
    <article className="rounded-[0.5rem] border border-border/70 bg-background/80 p-4">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-[0.5rem] bg-sky-500/12 text-sky-700 dark:text-sky-300">
          <Package className="h-4 w-4" />
        </span>
        <div>
          <p className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Evidence package</p>
          <h3 className="text-sm font-semibold text-foreground">Log evidence package</h3>
        </div>
      </div>

      <form className="mt-4 space-y-3" onSubmit={handleSubmit}>
        <div className="space-y-1.5">
          <label className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Mission</label>
          <select
            className="module-select"
            value={missionId}
            onChange={(e) => setMissionId(e.target.value)}
            required
          >
            {missionOptions.map((m) => (
              <option key={m.id} value={m.id}>{m.title}</option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Package title</label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="SR 49 lidar point cloud — Segment A"
            required
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <label className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Package type</label>
            <select
              className="module-select"
              value={packageType}
              onChange={(e) => setPackageType(e.target.value as PackageType)}
            >
              {PACKAGE_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Status</label>
            <select
              className="module-select"
              value={status}
              onChange={(e) => setStatus(e.target.value as AerialPackageStatus)}
            >
              {PACKAGE_STATUSES.map((s) => (
                <option key={s} value={s}>{formatAerialPackageStatusLabel(s)}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Verification readiness</label>
            <select
              className="module-select"
              value={verificationReadiness}
              onChange={(e) => setVerificationReadiness(e.target.value as AerialVerificationReadiness)}
            >
              {VERIFICATION_READINESS_OPTIONS.map((r) => (
                <option key={r} value={r}>{formatAerialVerificationReadinessLabel(r)}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Notes</label>
          <Textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Coverage area, processing tool, known gaps, or QA notes."
          />
        </div>

        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Package className="h-4 w-4" />}
          Log package
        </Button>
        {message ? <p className="text-sm text-emerald-700 dark:text-emerald-300">{message}</p> : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </form>
    </article>
  );
}
