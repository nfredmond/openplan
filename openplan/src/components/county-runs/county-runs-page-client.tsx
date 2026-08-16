"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useMemo, useState } from "react";
import { RefreshCcw } from "lucide-react";
import { useCountyRunMutations, useCountyRuns } from "@/lib/hooks/use-county-onramp";
import {
  getCountyRunEnqueueHelpText,
  getCountyRunEnqueueStatusLabel,
  getCountyRunEnqueueStatusTone,
} from "@/lib/models/county-onramp";
import { buildCountyRunUiCard } from "@/lib/ui/county-onramp";
import { buildCountyRunDetailHref } from "@/lib/ui/county-runs-navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { StudyAreaPicker } from "@/components/models/study-area-picker";
import { PLACE_KIND_LABELS, type PlaceBoundaryResponse } from "@/lib/api/place-geographies";
import { StateBlock } from "@/components/ui/state-block";
import { StatusBadge } from "@/components/ui/status-badge";

export type CountyRunsInitialStudyArea = {
  corridorText: string;
  place: PlaceBoundaryResponse | null;
  label: string | null;
};

export function CountyRunsPageClient({
  workspaceId,
  initialStudyArea,
  countyOnrampWorkerConfigured = null,
}: {
  workspaceId: string;
  initialStudyArea?: CountyRunsInitialStudyArea;
  /**
   * Whether this deployment has a county onramp worker configured to receive
   * jobs — read server-side by the page from
   * `isCountyOnrampWorkerConfigured()`, which mirrors the dispatcher's own rule.
   *
   * `null` means the page did not say, and is the honest default: the control
   * falls back to inferring from `prepared` records, exactly as before. It must
   * never be read as "no worker", because that would refuse-by-disclosure on
   * every deployment whose page has simply not been wired up yet.
   */
  countyOnrampWorkerConfigured?: boolean | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { items, loading, error, refresh } = useCountyRuns({
    workspaceId,
    limit: 25,
    refreshMs: 15000,
  });
  const { create, loading: creating, error: createError } = useCountyRunMutations();

  // The workspace's stated home geography, prefilled once. This page used to
  // open with three empty boxes — County FIPS, Geography label, County prefix —
  // and ask a planner to be the lookup table for their own county.
  const [corridorText, setCorridorText] = useState(initialStudyArea?.corridorText ?? "");
  const [resolvedPlace, setResolvedPlace] = useState<PlaceBoundaryResponse | null>(
    initialStudyArea?.place ?? null
  );
  const [runName, setRunName] = useState("");
  // OFF by default, and that is the product's position rather than a UI
  // preference: the uncalibrated screening model is what OpenPlan ships, and a
  // model fitted to counts is a different, disclosed claim that someone chooses
  // to make. Comparing against those counts happens either way.
  const [calibrateToCounts, setCalibrateToCounts] = useState(false);

  const currentViewHref = useMemo(() => {
    const query = searchParams.toString();
    return query ? `${pathname}?${query}` : pathname;
  }, [pathname, searchParams]);

  /**
   * County onboarding runs on a COUNTY. A resolved county's GEOID is its
   * 5-digit FIPS; anything else — a city, a CDP, a metro, a drawn area — has no
   * county to derive without guessing which one contains it.
   *
   * Non-negotiable #1: disclose the limit, never silently apply it.
   */
  const countySelection = useMemo(() => {
    if (!resolvedPlace) {
      return {
        ready: false as const,
        reason: corridorText.trim()
          ? "A drawn area has no county identity. Search for the county by name so onboarding knows which one to run."
          : null,
      };
    }
    if (resolvedPlace.kind !== "county") {
      return {
        ready: false as const,
        reason: `County onboarding runs on a county. ${
          resolvedPlace.label ?? "That place"
        } is a ${PLACE_KIND_LABELS[resolvedPlace.kind] ?? resolvedPlace.kind} — pick the county that contains it.`,
      };
    }
    return {
      ready: true as const,
      geoid: resolvedPlace.geoid,
      label: resolvedPlace.label ?? resolvedPlace.geoid,
      reason: null,
    };
  }, [resolvedPlace, corridorText]);

  /**
   * Whether county onboarding on this deployment produces a RUN or only a
   * handoff — declaration first, evidence second.
   *
   * `prepared` is recorded by exactly one branch of `dispatchCountyOnrampJob`:
   * the one taken when no county onramp worker URL is configured, where no HTTP
   * request is made at all. So a single prepared record proves that a county
   * run here waited for a person, not for a worker. Saying so before the launch
   * button is the same refuse-before-enqueue rule the model run modes follow —
   * launching is still allowed, because a prepared handoff is genuinely usable
   * by an operator, but it may not be presented as background execution.
   *
   * That evidence alone was RETROSPECTIVE, though: it exists only after a run
   * has already been prepared, so the first county launch on a fresh deployment
   * got no disclosure at all. Unlike the modeling worker, this one is declared
   * by configuration already (`OPENPLAN_COUNTY_ONRAMP_WORKER_URL`), so the page
   * can hand down the answer and the very first launch can be honest.
   *
   * The declaration wins where it exists, in BOTH directions. A configured
   * worker makes old prepared records history — a launch now really would be
   * submitted, so warning that it "produces a handoff" would be false. And a
   * deployment with no worker configured is told before its first launch rather
   * than after it.
   */
  const preparedOnlyRunCount = useMemo(
    () => items.filter((item) => item.enqueueStatus === "prepared").length,
    [items]
  );
  const workerAbsenceIsDeclared = countyOnrampWorkerConfigured === false;
  const disclosePreparedOnly =
    workerAbsenceIsDeclared || (countyOnrampWorkerConfigured === null && preparedOnlyRunCount > 0);

  const suggestedRunName = useMemo(() => {
    if (!countySelection.ready) return "";
    const slug = countySelection.label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return `${slug || "county"}-runtime`;
  }, [countySelection]);

  const submitCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!countySelection.ready) return;

    const nextRunName = runName.trim() || suggestedRunName;
    if (!nextRunName) return;

    const created = await create({
      workspaceId,
      geographyType: "county_fips",
      geographyId: countySelection.geoid,
      geographyLabel: countySelection.label,
      runName: nextRunName,
      // countyPrefix is deliberately NOT sent. It is optional on the request
      // schema and `defaultCountyPrefix` already derives it from the label, so
      // the old input required a field the API never needed.
      runtimeOptions: { keepProject: true, calibrateToCounts },
    });

    if (created?.countyRunId) {
      await refresh();
      router.push(buildCountyRunDetailHref(created.countyRunId, currentViewHref));
    }
  };

  return (
    <section className="module-page pb-10">
      <div className="module-intro-card">
        <div className="module-intro-kicker">Model Validation</div>
        <div className="module-intro-body">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone="info">Screening-model validation</StatusBadge>
            <StatusBadge tone="neutral">25 most recent runs</StatusBadge>
          </div>
          <h1 className="module-intro-title">Model Validation</h1>
          <p className="module-intro-description">
            Bring a county into the modeling workflow, from first setup through validation. Launch a run,
            check its current stage, then open the detail page for its files, worker handoff, and caveats.
          </p>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button variant="outline" onClick={() => void refresh()} disabled={loading}>
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </Button>
          <Link href="/models" className="text-sm font-medium text-muted-foreground hover:text-foreground">
            Back to models
          </Link>
        </div>
      </div>

      <StateBlock
        className="mt-4"
        title="What this page can confirm"
        description="The stages, status labels, and setup state shown here reflect what OpenPlan has recorded. Validation quality still depends on the underlying evidence on each run's detail page."
        tone="info"
        compact
      />

      <Card className="mb-4 mt-4">
        <CardHeader>
          <CardTitle>Launch county onboarding</CardTitle>
          <CardDescription>
            Create a county run record to begin the geography-first onboarding workflow.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4" onSubmit={submitCreate}>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">County</label>
              <StudyAreaPicker
                corridorText={corridorText}
                onCorridorChange={setCorridorText}
                onPlaceResolved={setResolvedPlace}
                // No model run follows this choice, so the engine-routing hint
                // would be advice about something that is not going to happen.
                showRunEngineHint={false}
                externalLabel={initialStudyArea?.label ?? null}
              />
              {countySelection.reason ? (
                <p className="text-sm text-[color:var(--copper)]">{countySelection.reason}</p>
              ) : null}
              {countySelection.ready ? (
                <p className="text-sm text-muted-foreground">
                  Onboarding will run on {countySelection.label} (FIPS {countySelection.geoid}).
                </p>
              ) : null}
            </div>
            <div className="space-y-2 md:max-w-sm">
              <label className="text-sm font-medium text-foreground">Run name</label>
              <Input
                value={runName}
                onChange={(e) => setRunName(e.target.value)}
                placeholder={suggestedRunName || "Named after the county if left blank"}
              />
            </div>
            <div className="space-y-2 md:max-w-2xl">
              <label className="flex items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-1 size-4 shrink-0 accent-primary"
                  checked={calibrateToCounts}
                  onChange={(event) => setCalibrateToCounts(event.target.checked)}
                  data-testid="county-run-calibrate-toggle"
                />
                <span>
                  <span className="font-medium text-foreground">
                    Adjust the model to fit local traffic counts
                  </span>
                  <span className="mt-1 block text-muted-foreground">
                    Your state transport department publishes traffic counts, and OpenPlan compares
                    every run against them wherever they exist — you do not need to tick anything for
                    that. Ticking this also lets the model adjust itself toward those counts. Some
                    counts are kept back from the adjustment and used to check the result, so the
                    accuracy you are shown is measured on traffic the model was not fitted to.
                    Adjusting does not on its own make a run accurate enough to publish road-by-road
                    traffic figures.
                  </span>
                </span>
              </label>
            </div>

            {disclosePreparedOnly ? (
              <div
                data-testid="county-worker-absent-disclosure"
                className="rounded-[0.5rem] border border-amber-300/70 bg-amber-50/80 px-4 py-3 text-sm text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200"
              >
                <p className="font-semibold">
                  On this OpenPlan installation, launching produces a handoff — not a run that starts itself
                </p>
                <p className="mt-2">
                  {/* Two sentences for the same conclusion, and which one is on
                      screen matters: a declaration is attributed to the
                      deployment's configuration, an inference is attributed to
                      the records it was drawn from. Blurring them would let a
                      guess borrow the authority of a fact. */}
                  {workerAbsenceIsDeclared
                    ? "This installation has no processing worker configured to run county validation, so nothing will be sent anywhere."
                    : `${
                        preparedOnlyRunCount === 1
                          ? "A county run here was prepared rather than sent"
                          : `${preparedOnlyRunCount} county runs here were prepared rather than sent`
                      }, which OpenPlan records only when no processing worker is configured to run county validation.`}{" "}
                  Launching still creates the run record and the full worker payload, and that
                  payload is usable — but the setup does not run until whoever operates this
                  OpenPlan installation either configures the validation worker (see{" "}
                  <code>workers/county_onramp_worker/DEPLOY.md</code>) or runs the prepared handoff
                  themselves and posts the manifest back.
                </p>
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <Button type="submit" disabled={creating || !countySelection.ready}>
                Launch county run
              </Button>
              {createError ? <span className="text-sm text-destructive">{createError}</span> : null}
              {!createError ? (
                <span className="text-sm text-muted-foreground">
                  This creates the county run record. Setup progress and validation evidence appear on the run&apos;s detail page.
                </span>
              ) : null}
            </div>
          </form>
        </CardContent>
      </Card>

      {error ? (
        <StateBlock
          title="Unable to load county runs"
          description={error}
          tone="danger"
          action={
            <Button variant="outline" onClick={() => void refresh()}>
              Retry
            </Button>
          }
        />
      ) : null}

      {!error && !loading && items.length === 0 ? (
        <StateBlock
          title="No county runs yet"
          description="County modeling runs will appear here as they are created, along with status, next steps, and links to details."
          tone="neutral"
        />
      ) : null}

      {!error && items.length > 0 ? (
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Recent runs</p>
            <h2 className="mt-1 text-lg font-semibold tracking-tight text-foreground">County validation runs</h2>
          </div>
          <span className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {items.length} visible
          </span>
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        {items.map((item) => {
          const stageReasonLabel = (item as { stageReasonLabel?: string }).stageReasonLabel ?? null;
          const card = buildCountyRunUiCard({
            geographyLabel: item.geographyLabel,
            manifest: null,
            stage: item.stage,
          });
          const enqueueLabel = getCountyRunEnqueueStatusLabel(item.enqueueStatus ?? "not-enqueued");
          const enqueueTone = getCountyRunEnqueueStatusTone(item.enqueueStatus ?? "not-enqueued");
          // The shared help text calls a prepared handoff "prepared for background
          // execution", which is the one thing it is not: `prepared` is recorded
          // only by the branch of `dispatchCountyOnrampJob` where no worker URL is
          // configured and no request is made, so nothing is going to execute it in
          // the background. The disclosure above the launch button says this once;
          // leaving the old sentence on the cards below would contradict it on the
          // same screen. Every other status keeps the shared wording.
          const enqueueHelp =
            item.enqueueStatus === "prepared"
              ? "This county setup handoff is prepared, not sent — no processing worker was configured to run it, so it will not start until an operator runs it or configures a worker."
              : getCountyRunEnqueueHelpText(item.enqueueStatus ?? "not-enqueued");

          return (
            <Card key={item.id}>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <CardTitle>{item.geographyLabel}</CardTitle>
                    <CardDescription>{item.runName}</CardDescription>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone={card.tone}>{card.stageLabel}</StatusBadge>
                    {item.statusLabel ? <StatusBadge tone={card.tone}>{item.statusLabel}</StatusBadge> : null}
                    <StatusBadge tone={enqueueTone}>{enqueueLabel}</StatusBadge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                {stageReasonLabel ? (
                  <div>
                    <div className="font-medium text-foreground">Current status</div>
                    <p className="mt-1 text-muted-foreground">{stageReasonLabel}</p>
                  </div>
                ) : null}
                <div>
                  <div className="font-medium text-foreground">What this run supports</div>
                  <p className="mt-1 text-muted-foreground">{card.allowedClaim}</p>
                </div>
                <div>
                  <div className="font-medium text-foreground">Next action</div>
                  <p className="mt-1 text-muted-foreground">{card.nextAction}</p>
                </div>
                <div>
                  <div className="font-medium text-foreground">Run status</div>
                  <p className="mt-1 text-muted-foreground">{enqueueHelp}</p>
                  {item.lastEnqueuedAt ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Last handoff attempt {new Date(item.lastEnqueuedAt).toLocaleString()}
                    </p>
                  ) : null}
                </div>
                <div className="flex items-center justify-between gap-3 pt-2">
                  <span className="text-xs text-muted-foreground">Updated {new Date(item.updatedAt).toLocaleString()}</span>
                  <Button asChild variant="outline" size="sm">
                    <Link href={buildCountyRunDetailHref(item.id, currentViewHref)}>Open detail</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
