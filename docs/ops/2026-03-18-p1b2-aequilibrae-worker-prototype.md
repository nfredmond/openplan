# P1B.2 AequilibraE Worker Prototype - Technical Spec

**Date:** 2026-03-18
**Author:** Iris Chen (Expert Developer Programmer)
**Status:** IMPLEMENTING

## Objective
Run OpenPlan-managed AequilibraE jobs outside the Next.js web app path. This fulfills P1B.2 from the modeling stack build backlog. The prototype demonstrates a decoupled execution environment that can pick up staged model runs, execute them, upload artifacts, and update the orchestration state.

## Architecture & Runtime Choice

For this prototype and initial production runs, we will use a **Standalone Python Worker**.

*   **Why Python?** AequilibraE is a Python library. We need a native Python environment (e.g., Python 3.10+, QGIS optional depending on features, but standard AequilibraE mostly needs numpy/pandas/spatialite).
*   **Trigger Mechanism:** Instead of a complex message broker (like RabbitMQ) right away, the prototype will use a simple **HTTP webhook / API driven** approach or **Database Polling**. For simplicity of integration with Vercel/Next.js, we will provide a Next.js API route `/api/model-runs/[id]/start-worker` that a worker can either be triggered by, or the worker can simply poll the Supabase `model_run_stages` table for `status = 'queued'`.
*   **Decision for Prototype:** We will implement a simple **polling Python worker script** (`workers/aequilibrae_worker.py`) that uses the Supabase Python client.

## Workflow

1.  **Launch:** A user triggers a run in the UI. The Next.js API sets the `model_runs` status to `running` and the first `model_run_stages` to `queued`.
2.  **Claim:** The Python worker polls for `queued` stages. It updates the stage to `running` to claim it.
3.  **Execute:** The worker runs a mock AequilibraE script (to be replaced with real modeling logic later). It logs progress.
4.  **Artifacts:** The worker uploads a mock results file to Supabase Storage and records it in `model_run_artifacts`.
5.  **Complete:** The worker sets the stage `status` to `succeeded` and completes the run if it's the final stage.

## Implementation Steps

1.  **Storage Setup:** Ensure a Supabase storage bucket (`model-artifacts`) exists (can be added via SQL migration).
2.  **Worker Scaffolding:** Create `workers/aequilibrae_worker/` directory with a `requirements.txt` and `main.py`.
3.  **Next.js API:** Create a launch API `/api/models/runs/[id]/launch` that transitions a run from `draft` to `queued`/`running` and prepares the stages.
4.  **Mock AequilibraE Script:** A simple Python function that sleeps for 5 seconds, writes a `matrix.omx` mock file, and registers it.

## Acceptance Criteria
- [ ] Worker/runtime choice documented (this file).
- [ ] Job can be launched from orchestrator (API).
- [ ] Status transitions work (queued -> running -> succeeded).
- [ ] Output artifacts register correctly.
