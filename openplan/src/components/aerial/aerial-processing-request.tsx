"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, PlaneTakeoff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PROCESSING_PRESET_IDS, type ProcessingPresetId } from "@/lib/aerial/processing-contract";

/**
 * The control that dispatches imagery for processing.
 *
 * WHY IT IS PART OF MAKING JOBS VISIBLE. `POST /api/aerial/missions/[id]/process`
 * has existed and worked since 20260721000001, and no surface in the product
 * called it. Every job an operator could have looked at was a job only a curl
 * command could have created — so a page that showed jobs and offered no way to
 * make one would still leave the capability out of reach.
 *
 * WHAT THE FORM OFFERS DEPENDS ON THE WORKER'S CONTRACT, and the form asks the
 * server rather than guessing: `GET` on the same route answers which contract
 * the configured worker speaks and how many photos are stored on this mission.
 * A v1 worker (the external platform) takes exactly one shape — a pasted ZIP
 * link, passed through as-is. A v1.1 worker takes the photos stored on the
 * mission itself, dispatched by the server as signed links minted at request
 * time; the pasted link remains as the fallback when nothing is stored. If the
 * capability read fails, the form says so and keeps the pasted-link path, which
 * both contracts accept.
 *
 * PRESETS COME FROM THE CONTRACT, not from a list retyped here: the same
 * `PROCESSING_PRESET_IDS` the route validates against and the worker publishes.
 * A preset added to the contract appears in this menu with no edit.
 *
 * THE URL IS NOT VALIDATED HERE. The route's rule (https anywhere, plain http
 * for localhost only, mirroring the worker's own) is the rule that decides, and
 * a second copy of it in the browser would drift from it. The field states the
 * rule; the server enforces it, and its own refusal text (the zod issue
 * messages, not the generic error string) is what the reader is shown.
 */

const PRESET_DESCRIPTIONS: Record<ProcessingPresetId, string> = {
  "fast-preview": "Fastest turnaround, lowest resolution — for checking coverage.",
  balanced: "Default. Usable orthomosaic and surface model.",
  "high-quality": "Longest runtime, highest detail.",
};

function describePresetOption(preset: string): string {
  const description = PRESET_DESCRIPTIONS[preset as ProcessingPresetId];
  return description ? `${preset} — ${description}` : preset;
}

type StoredImageryCapability =
  | { status: "counted"; count: number }
  | { status: "unavailable"; reason: string };

type DispatchCapability = {
  workerContract: "v1" | "v1.1" | null;
  storedImagery: StoredImageryCapability;
};

/**
 * The route answers with several distinct shapes. Each is turned into a
 * sentence that says what actually happened, because "Failed to process" would
 * hide the one difference that matters: whether the imagery was ever dispatched.
 */
async function describeFailure(response: Response): Promise<string> {
  const payload = (await response.json().catch(() => null)) as
    | {
        error?: string;
        detail?: string;
        requestId?: string;
        reason?: string;
        nextStep?: string;
        issues?: Array<{ message?: unknown }>;
      }
    | null;

  // The route validates the imagery URL with zod and returns the reason in
  // `issues`. Collapsing that to "Invalid processing request payload" would hide
  // the single most likely refusal — an http:// link the worker will not accept
  // — behind a sentence that names nothing. The rule is not restated here; the
  // server's own wording is shown.
  if (response.status === 400 && Array.isArray(payload?.issues)) {
    const reasons = payload.issues
      .map((issue) => (typeof issue?.message === "string" ? issue.message.trim() : ""))
      .filter((message) => message.length > 0);
    if (reasons.length > 0) {
      return `Nothing was dispatched — the request was refused before it reached the worker: ${reasons.join("; ")}.`;
    }
  }

  if (response.status === 409 && payload?.error === "processing_already_active") {
    return `This mission already has an open processing job${
      payload.requestId ? ` (request ${payload.requestId})` : ""
    }. It is listed below — wait for it to finish, or have it canceled on the worker, before requesting another.`;
  }

  if (response.status === 422 && payload?.error === "no_imagery_available") {
    return payload.detail ?? "This mission has no imagery to dispatch.";
  }

  if (response.status === 501) {
    return (
      payload?.reason ??
      "This deployment has no processing worker configured, so nothing can be dispatched."
    );
  }

  if (response.status === 502) {
    return `The worker did not accept the request, so no processing was started: ${
      payload?.detail ?? "no detail was returned"
    }. The attempt is recorded below as a failed dispatch.`;
  }

  if (response.status === 403) {
    return payload?.error ?? "You do not have permission to request processing in this workspace.";
  }

  return payload?.detail ?? payload?.error ?? `The request failed (HTTP ${response.status}).`;
}

export function AerialProcessingRequestForm({ missionId }: { missionId: string }) {
  const router = useRouter();
  const [imageryZipUrl, setImageryZipUrl] = useState("");
  const [imageCount, setImageCount] = useState("");
  const [sizeBytes, setSizeBytes] = useState("");
  const [presetId, setPresetId] = useState<string>("balanced");
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // null = still asking; "unreadable" = the capability read itself failed, and
  // the form says so rather than treating it as "the worker speaks v1".
  const [capability, setCapability] = useState<DispatchCapability | "unreadable" | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`/api/aerial/missions/${missionId}/process`, {
          method: "GET",
          headers: { accept: "application/json" },
        });
        if (!response.ok) {
          if (!cancelled) setCapability("unreadable");
          return;
        }
        const payload = (await response.json().catch(() => null)) as
          | (DispatchCapability & { workerConfigured?: boolean })
          | null;
        if (!cancelled) {
          setCapability(
            payload && payload.storedImagery ? payload : "unreadable"
          );
        }
      } catch {
        if (!cancelled) setCapability("unreadable");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [missionId]);

  const stored =
    capability !== null && capability !== "unreadable" && capability.workerContract === "v1.1"
      ? capability.storedImagery
      : null;
  const usingStoredPhotos = stored?.status === "counted" && stored.count > 0;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setIsSubmitting(true);

    try {
      const parsedImageCount = imageCount.trim() ? Number(imageCount.trim()) : undefined;
      const parsedSizeBytes = sizeBytes.trim() ? Number(sizeBytes.trim()) : undefined;

      // Not a second copy of the server's rule (positive integer) — only a
      // check that the text is a number at all. `Number("about 500")` is NaN,
      // which JSON.stringify writes as `null`, so without this the reader would
      // get the server complaining about a null they never typed.
      if (parsedImageCount !== undefined && !Number.isFinite(parsedImageCount)) {
        setError(`Image count is not a number: "${imageCount.trim()}". Nothing was dispatched.`);
        return;
      }
      if (parsedSizeBytes !== undefined && !Number.isFinite(parsedSizeBytes)) {
        setError(`ZIP size is not a number: "${sizeBytes.trim()}". Nothing was dispatched.`);
        return;
      }

      const response = await fetch(`/api/aerial/missions/${missionId}/process`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          // When the server will dispatch the mission's stored photos, the
          // pasted-link fields are not sent at all: the server reads the
          // photos, mints the links, and computes the counts itself.
          ...(usingStoredPhotos
            ? {}
            : {
                imageryZipUrl: imageryZipUrl.trim(),
                ...(parsedImageCount !== undefined ? { imageCount: parsedImageCount } : {}),
                ...(parsedSizeBytes !== undefined ? { sizeBytes: parsedSizeBytes } : {}),
              }),
          presetId,
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        }),
      });

      if (!response.ok) {
        setError(await describeFailure(response));
        // A refused dispatch still writes a row (dispatch_failed), so the list
        // below has to be re-read either way.
        router.refresh();
        return;
      }

      const payload = (await response.json().catch(() => null)) as
        | { requestId?: string; jobReference?: string; imageryType?: string }
        | null;

      setImageryZipUrl("");
      setImageCount("");
      setSizeBytes("");
      setNotes("");
      setMessage(
        `The worker accepted ${
          payload?.imageryType === "photo_manifest"
            ? "this mission's stored photos"
            : "the request"
        }${payload?.jobReference ? ` as job ${payload.jobReference}` : ""}. It appears below and advances only when the worker calls back.`
      );
      router.refresh();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? `The request never left this browser: ${submitError.message}`
          : "The request never left this browser."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="space-y-3" onSubmit={handleSubmit} aria-label="Request imagery processing">
      {usingStoredPhotos ? (
        <p className="text-sm text-muted-foreground" data-testid="aerial-stored-photos-source">
          <span className="font-medium text-foreground">
            {stored.count} stored photo{stored.count === 1 ? "" : "s"} on this mission
          </span>{" "}
          will be dispatched — the server mints signed, time-limited links for them at request
          time. No ZIP link is needed.
        </p>
      ) : (
        <div className="space-y-1.5">
          <label
            className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
            htmlFor="aerial-imagery-zip-url"
          >
            Imagery ZIP URL
          </label>
          <Input
            id="aerial-imagery-zip-url"
            value={imageryZipUrl}
            onChange={(event) => setImageryZipUrl(event.target.value)}
            placeholder="https://…/mission-imagery.zip"
            required
          />
          <p className="text-[0.68rem] text-muted-foreground">
            A link the worker itself can fetch — https, or plain http only for a worker on the
            same machine. The link is passed through to the worker as-is.
            {stored?.status === "counted" && stored.count === 0
              ? " This mission has no stored photos yet — upload them in the imagery panel to dispatch them directly instead of zipping them yourself."
              : null}
            {stored?.status === "unavailable" ? ` ${stored.reason}` : null}
            {capability === "unreadable"
              ? " (Whether this mission has stored photos could not be checked just now; a pasted link still works.)"
              : null}
          </p>
        </div>
      )}

      <div className={`grid gap-3 ${usingStoredPhotos ? "sm:grid-cols-1" : "sm:grid-cols-3"}`}>
        <div className="space-y-1.5">
          <label
            className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
            htmlFor="aerial-preset"
          >
            Preset
          </label>
          <select
            id="aerial-preset"
            className="module-select"
            value={presetId}
            onChange={(event) => setPresetId(event.target.value)}
          >
            {PROCESSING_PRESET_IDS.map((preset) => (
              <option key={preset} value={preset}>
                {describePresetOption(preset)}
              </option>
            ))}
          </select>
        </div>
        {usingStoredPhotos ? null : (
          <>
            <div className="space-y-1.5">
              <label
                className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
                htmlFor="aerial-image-count"
              >
                Image count (optional)
              </label>
              <Input
                id="aerial-image-count"
                inputMode="numeric"
                value={imageCount}
                onChange={(event) => setImageCount(event.target.value)}
                placeholder="482"
              />
            </div>
            <div className="space-y-1.5">
              <label
                className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
                htmlFor="aerial-size-bytes"
              >
                ZIP size in bytes (optional)
              </label>
              <Input
                id="aerial-size-bytes"
                inputMode="numeric"
                value={sizeBytes}
                onChange={(event) => setSizeBytes(event.target.value)}
                placeholder="7300000000"
              />
            </div>
          </>
        )}
      </div>

      <div className="space-y-1.5">
        <label
          className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
          htmlFor="aerial-processing-notes"
        >
          Notes for the worker (optional)
        </label>
        <Textarea
          id="aerial-processing-notes"
          rows={2}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Flight conditions, ground control, overlap, or anything the operator should know."
        />
      </div>

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <PlaneTakeoff className="h-4 w-4" />
        )}
        Request processing
      </Button>

      {message ? (
        <p className="text-sm text-emerald-700 dark:text-emerald-300" role="status">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
