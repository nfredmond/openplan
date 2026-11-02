import { describe, expect, it } from "vitest";

import { RUN_STALE_THRESHOLD_MS } from "@/lib/models/run-liveness";
import { DEFAULT_AERIAL_PROCESSING_SILENCE_MINUTES } from "@/lib/aerial/catalog";
import {
  buildDb,
  idsOf,
  loadSeededMyWork as load,
  MODEL_A,
  NOW,
  P1,
  WS_A,
  WS_B,
  type Db,
} from "./helpers/fake-my-work-tables";

/**
 * Jobs that stopped, in My Work's "Waiting on a person" block: model runs that
 * were interrupted or stopped reporting, failed county runs, and aerial
 * processing jobs that failed or went silent. Each source reuses its module's
 * own definition (`run-liveness.ts`, `run-status.ts`, `summarizeAerialProcessingJob`);
 * these tests vary the timestamps across those definitions' boundaries.
 */

const minutesBefore = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();
const RUN_STALE_MINUTES = RUN_STALE_THRESHOLD_MS / 60_000;

function withJobs(): Db {
  const db = buildDb();
  db.model_runs.push(
    {
      id: "run-silent", workspace_id: WS_A, model_id: MODEL_A, run_title: "Silent run", status: "running",
      engine_key: "aequilibrae", attempt_managed: true, created_at: minutesBefore(600), started_at: minutesBefore(590), updated_at: minutesBefore(RUN_STALE_MINUTES + 5),
    },
    {
      id: "run-fresh", workspace_id: WS_A, model_id: MODEL_A, run_title: "Progressing run", status: "running",
      engine_key: "aequilibrae", attempt_managed: true, created_at: minutesBefore(600), started_at: minutesBefore(590), updated_at: minutesBefore(RUN_STALE_MINUTES + 5),
    },
    {
      id: "run-interrupted", workspace_id: WS_A, model_id: MODEL_A, run_title: "Interrupted run", status: "running",
      engine_key: "behavioral_demand", attempt_managed: true, created_at: minutesBefore(30), started_at: minutesBefore(25), updated_at: minutesBefore(1),
    },
    {
      // A historical worker run: never claimed by a managed attempt, fenced,
      // and stale forever. An owner may already have kept or closed it; My
      // Work cannot read that decision, so it does not list the run.
      id: "run-historical", workspace_id: WS_A, model_id: MODEL_A, run_title: "Historical run", status: "running",
      engine_key: "aequilibrae", attempt_managed: false, created_at: minutesBefore(9000), started_at: minutesBefore(8990), updated_at: minutesBefore(8000),
    },
    {
      // An in-app engine has no recovery enrollment, so liveness alone decides.
      id: "run-in-app", workspace_id: WS_A, model_id: MODEL_A, run_title: "In-app run", status: "running",
      engine_key: "sketch_abm", attempt_managed: false, created_at: minutesBefore(600), started_at: minutesBefore(590), updated_at: minutesBefore(RUN_STALE_MINUTES + 5),
    },
    {
      id: "run-decoy", workspace_id: WS_B, model_id: MODEL_A, run_title: "Other workspace run", status: "running",
      engine_key: "aequilibrae", attempt_managed: true, created_at: minutesBefore(600), started_at: minutesBefore(590), updated_at: minutesBefore(500),
    },
  );
  db.model_run_stages = [
    // The silent run's only stage stopped streaming with the run.
    { id: "s1", run_id: "run-silent", status: "running", started_at: minutesBefore(590), completed_at: null, updated_at: minutesBefore(RUN_STALE_MINUTES + 5), error_message: null },
    // The progressing run's stage still streams, so the run is alive.
    { id: "s2", run_id: "run-fresh", status: "running", started_at: minutesBefore(590), completed_at: null, updated_at: minutesBefore(2), error_message: null },
    // A running stage with an error is an interruption, however recent.
    { id: "s3", run_id: "run-interrupted", status: "running", started_at: minutesBefore(25), completed_at: null, updated_at: minutesBefore(1), error_message: "Worker shut down during assignment" },
  ];
  db.county_runs = [
    { id: "county-failed", workspace_id: WS_A, run_name: "Nevada County screening", geography_label: "Nevada County", enqueue_status: "failed", worker_dispatch_error: "Worker refused the manifest", updated_at: minutesBefore(60) },
    { id: "county-no-cause", workspace_id: WS_A, run_name: "Placer County screening", geography_label: null, enqueue_status: "failed", worker_dispatch_error: null, updated_at: minutesBefore(90) },
    { id: "county-done", workspace_id: WS_A, run_name: "Done run", geography_label: null, enqueue_status: "completed", worker_dispatch_error: null, updated_at: minutesBefore(60) },
    { id: "county-decoy", workspace_id: WS_B, run_name: "Decoy run", geography_label: null, enqueue_status: "failed", worker_dispatch_error: null, updated_at: minutesBefore(60) },
  ];
  db.aerial_missions = [
    { id: "mission-failed", workspace_id: WS_A, title: "Main Street corridor flight" },
    { id: "mission-retried", workspace_id: WS_A, title: "Retried flight" },
    { id: "mission-silent", workspace_id: WS_A, title: "Silent flight" },
    { id: "mission-reporting", workspace_id: WS_A, title: "Reporting flight" },
    { id: "mission-decoy", workspace_id: WS_B, title: "Decoy flight" },
  ];
  const silence = DEFAULT_AERIAL_PROCESSING_SILENCE_MINUTES;
  db.aerial_processing_jobs = [
    { id: "job-failed", workspace_id: WS_A, project_id: P1, mission_id: "mission-failed", status: "failed", message: "Too few overlapping images", dispatch_error: null, last_callback_at: minutesBefore(30), created_at: minutesBefore(120) },
    // An older failure replaced by a later success: not listed.
    { id: "job-retried-old", workspace_id: WS_A, project_id: null, mission_id: "mission-retried", status: "failed", message: "Old failure", dispatch_error: null, last_callback_at: minutesBefore(300), created_at: minutesBefore(400) },
    { id: "job-retried-new", workspace_id: WS_A, project_id: null, mission_id: "mission-retried", status: "succeeded", message: null, dispatch_error: null, last_callback_at: minutesBefore(100), created_at: minutesBefore(200) },
    { id: "job-silent", workspace_id: WS_A, project_id: null, mission_id: "mission-silent", status: "running", message: null, dispatch_error: null, last_callback_at: minutesBefore(silence + 5), created_at: minutesBefore(silence + 60) },
    { id: "job-reporting", workspace_id: WS_A, project_id: null, mission_id: "mission-reporting", status: "running", message: null, dispatch_error: null, last_callback_at: minutesBefore(silence - 5), created_at: minutesBefore(silence + 60) },
    { id: "job-decoy", workspace_id: WS_B, project_id: null, mission_id: "mission-decoy", status: "failed", message: "Decoy", dispatch_error: null, last_callback_at: minutesBefore(30), created_at: minutesBefore(120) },
  ];
  return db;
}

const fromSource = (items: Awaited<ReturnType<typeof load>>["result"]["items"], sourceId: string) =>
  items.filter((item) => item.sourceId === sourceId);

describe("my work — stopped model runs", () => {
  it("lists interrupted runs and runs past the stale threshold, not progressing ones", async () => {
    const { result, selects } = await load({ db: withJobs() });
    const stopped = fromSource(result.items, "stalled_model_runs");

    expect(idsOf(stopped).sort()).toEqual(["run-in-app", "run-interrupted", "run-silent"]);
    const interrupted = stopped.find((item) => item.id === "run-interrupted")!;
    expect(interrupted).toMatchObject({ block: "needs_review", badge: { label: "Run interrupted" }, href: `/models/${MODEL_A}` });
    // The cause is the stage's own message, never a guess.
    expect(interrupted.detail).toContain("Worker shut down during assignment");
    const silent = stopped.find((item) => item.id === "run-silent")!;
    expect(silent.badge.label).toBe("Run stopped reporting");
    expect(silent.detail).toContain(`over ${RUN_STALE_MINUTES} minutes`);

    // The stage embed carries the fields the shared rules read.
    const projection = selects.model_runs;
    for (const column of ["status", "engine_key", "attempt_managed", "updated_at", "stages:model_run_stages(status, started_at, completed_at, updated_at, error_message)"]) {
      expect(projection).toContain(column);
    }
    expect(result.perSource.stalled_model_runs).toEqual({ count: 3, pending: false, failed: false });
  });

  it("moves a run across the threshold by its freshest stage heartbeat", async () => {
    const db = withJobs();
    const stage = (db.model_run_stages as Array<Record<string, unknown>>).find((row) => row.id === "s1")!;
    stage.updated_at = minutesBefore(RUN_STALE_MINUTES - 5);
    const { result } = await load({ db });
    expect(idsOf(fromSource(result.items, "stalled_model_runs")).sort()).toEqual(["run-in-app", "run-interrupted"]);
  });

  it("leaves out a worker run no managed attempt claimed, which may be a resolved historical record", async () => {
    const db = withJobs();
    const historical = (db.model_runs as Array<Record<string, unknown>>).find((row) => row.id === "run-historical")!;
    expect(idsOf(fromSource((await load({ db })).result.items, "stalled_model_runs"))).not.toContain("run-historical");
    // VARY THE BINDING: the same stale row, once a managed attempt claimed it, is listed.
    historical.attempt_managed = true;
    expect(idsOf(fromSource((await load({ db })).result.items, "stalled_model_runs"))).toContain("run-historical");
  });
});

describe("my work — failed county runs", () => {
  it("lists this workspace's failed county runs with the recorded cause or none", async () => {
    const { result, selects } = await load({ db: withJobs() });
    const failed = fromSource(result.items, "failed_county_runs");

    expect(idsOf(failed)).toEqual(["county-failed", "county-no-cause"]);
    expect(failed[0]).toMatchObject({ href: "/county-runs/county-failed", badge: { label: "County run failed", tone: "danger" } });
    expect(failed[0].detail).toContain("Worker refused the manifest");
    expect(failed[1].detail).toContain("No cause recorded");
    expect(selects.county_runs.split(",").map((column) => column.trim())).toEqual(
      expect.arrayContaining(["id", "run_name", "enqueue_status", "worker_dispatch_error", "updated_at"]),
    );
  });
});

describe("my work — aerial processing", () => {
  it("lists the latest job per mission only when it failed or went silent", async () => {
    const { result, selects, limits } = await load({ db: withJobs() });
    const jobs = fromSource(result.items, "aerial_processing");

    expect(idsOf(jobs).sort()).toEqual(["job-failed", "job-silent"]);
    const failed = jobs.find((item) => item.id === "job-failed")!;
    expect(failed).toMatchObject({
      title: "Main Street corridor flight",
      href: "/aerial/missions/mission-failed",
      badge: { label: "Processing failed", tone: "danger" },
      detail: "Too few overlapping images",
    });
    expect(jobs.find((item) => item.id === "job-silent")?.badge.label).toBe("Processing stopped reporting");
    // History is read so a later success can replace an earlier failure.
    expect(limits.aerial_processing_jobs).toBeGreaterThanOrEqual(200);
    for (const column of ["mission_id", "status", "last_callback_at", "created_at", "aerial_missions(id, title)"]) {
      expect(selects.aerial_processing_jobs).toContain(column);
    }
  });
});

describe("my work — a stopped-job source that cannot be read", () => {
  it.each([
    ["model_runs", "stalled_model_runs", "running model runs"],
    ["county_runs", "failed_county_runs", "county runs"],
    ["aerial_processing_jobs", "aerial_processing", "aerial processing jobs"],
  ] as const)("discloses %s as failed instead of showing nothing", async (table, sourceId, label) => {
    const { result } = await load({ db: withJobs(), failures: { [table]: `permission denied for table ${table}` } });
    expect(result.perSource[sourceId]).toEqual({ count: 0, pending: false, failed: true });
    expect(result.reads.describe()).toContain(label);
    // The other job sources still read.
    expect(fromSource(result.items, "failed_county_runs").length + fromSource(result.items, "aerial_processing").length).toBeGreaterThan(0);
  });
});
