# Usage-reset checkpoint, September 14

Resume in `/home/nathaniel/.local/state/openplan/translation-command-workflow-2026-09-13`,
branch `work/engagement-decision-traceability`; the application package is
`openplan/`. Another session owns the original `/home/nathaniel/code/openplan`
checkout. Recheck ownership and working changes before editing. This note
supersedes older usage-reset handoffs in the decision-traceability review.

The user requested continuity across the weekly usage reset. The standing goal
remains the full V1 contract and roadmap. Direct main pushes, repository
Playwright, no draft PRs and no human release gate are authorized. Keep work
local and free. Preserve the pending reminder constraint and all unrelated work.

## Saved implementation and CI

Main and the work branch were both `75d79afa708537cd36028f590335a3efd70a6cd5`
before this documentation checkpoint. This includes private decision links,
immutable correction history, interrupted-save recovery, cancellation receipts,
damaged-copy recovery and the stale-warning fix. The latest published release
remains v0.59.0. This increment is merged but not separately released; M9b and
v1.0 remain incomplete.

GitHub results were rechecked explicitly against `nfredmond/openplan` during
this checkpoint. All completed successfully:

- [CI, including QA and shuffled tests](https://github.com/nfredmond/openplan/actions/runs/34843745176)
- [RLS isolation](https://github.com/nfredmond/openplan/actions/runs/34843745145)
- [Upgrade path](https://github.com/nfredmond/openplan/actions/runs/34843745051)

These runs apply to `75d79afa`, not the subsequent documentation checkpoint.
Use explicit repository and run IDs when checking CI. One earlier generic run
list returned unrelated old health runs.

Private recovery evidence and operator instructions are retained in
`../2026-09-14-m9b-decision-traceability/PROGRESS.md`, its
`decision-recovery-final-checks.json` and `decision-recovery-browser-results.json`,
and `../../ops/ENGAGEMENT_DECISION_LINKS.md`.
Final local QA recorded 15,310 passing and 512 skipped tests; shuffled seed
914062 had the same counts. Live RLS recorded 541 probes across 59 files and
workers 52 passes. Six desktop/390px recovery journeys used application build
`6604a87e`; later `75d79afa` changed documentation only. Read the retained
limitations and earlier coverage gaps rather than treating those results as
full-product acceptance.

## Current defect and candidate

A rolled-back synthetic database probe confirmed that `queue_engagement_report`
included an approved item marked `private_note: true` in a snapshot labelled
public, while stripping its privacy metadata. See
`PUBLIC_REPORT_PRIVACY_FINDING.json` and `probe-existing-public-report.sql`.
The initial authenticated read of `snapshot_text` was correctly denied by
column-level grants; the corrected owner inspection established the defect.
This probe did not generate or download PDF/XLSX files.

`public-report-privacy-candidate.sql` is a transaction-local candidate, NOT an
installed migration. It adds a pure eligibility helper and filters public report
items and parents using explicit private/internal flags and visibility. Internal
snapshots retain original records. The existing response source-selection rule
then excludes explanations whose source items are absent.

`prove-public-report-privacy.py` ran the candidate with the synthetic fixture
inside BEGIN/ROLLBACK for each case. `public-report-privacy-results.json` records
baseline and harmless-control survival and nine targeted failures detected for
their intended semantic assertions. The runner checks the migration ledger,
installed queue definition and helper absence after every rollback. Installed
definitions remained unchanged. No proof process remained when this checkpoint
was written. Candidate and fixture hashes are in the results file.

This proof covers report queue selection only. It does not fix the public portal,
attachment or translation readers, old archived artifacts, or source-type-only
privacy policy. Do not describe the application privacy defect as fixed.

## Next work

1. Complete the explicit privacy-flag boundary before adding decision history to
   exports. Inspect all public readers, media, translation and response publication.
   `public-approved-items.ts` currently selects approved items without metadata
   filtering. `guard_engagement_response_publication` checks approval and parent
   approval but not explicit privacy flags. Metadata-only changes do not currently
   trigger response withdrawal in `guard_engagement_public_copy`.
2. Decide how to handle legacy public snapshots whose private markers were already
   stripped. Their original bytes cannot prove privacy retrospectively. Preserve
   immutable artifacts and do not silently rewrite them or claim they are safe.
3. Add private decision lineage to internal reports using existing complete
   history/context readers and validators. Current `review-export.ts` schema 1
   lacks that history; missing legacy history means uncaptured, not zero. Private
   actor, rationale and recovery context must not enter public reports.
4. Reuse existing reviewed/published "You said / We did" and translation provenance
   for public explanations. No new module or duplicate publication model is needed.
5. Exercise actual navigation at desktop and 390px, keyboard, console, private
   access, corrections and interrupted retries. Inspect generated PDF/XLSX/ZIP
   artifacts and checksums. Run appropriate QA, shuffled, isolated RLS, workers and
   upgrade checks; inspect final release-commit CI before tagging.

Read the current product authorities and run `npm run product:direction:check`
before selecting the following substantial lane. Do not resume the obsolete
v0.47 release plan as if it were current.

## Local resources to recheck after reset

- Application stack: `supabase_db_openplan-restore-target-2026091050`, database
  `postgres`, API 29821, DB 29822. Ledger at checkpoint: 341 migrations through
  `20261014000022`. Do not reset or drop it.
- Disconnected native proof database on the same container:
  `openplan_decision_link_proof_20260914`. Preserve it; never attach the app or a
  worker. Older scripts expecting ledger 340 or absent migration 22 are historical.
- Own application server was on port 3262, build `6604a87e`, version 0.59.0,
  with the translation review's network guard preloaded to prevent Anthropic
  requests. Processes and tool session IDs may not survive. Recheck ownership,
  restart only the owned server if needed, and use `which-openplan.sh` to establish
  build identity before collecting new browser evidence. Leave other servers alone.
- Private logs and synthetic browser artifacts:
  `/home/nathaniel/.local/state/openplan/response-write-probe-20260913/decision-context/`.
  The latest report proof subdirectory is recorded in its results JSON. Do not
  commit private captures or credentials.
- Browser runners are in the decision-traceability review. They use the repository
  Playwright harness with isolated contexts, a `PROBE_COMMIT` prefix and 1440/390px
  widths. Existing screenshots are historical evidence, not a new browser run.
- Worker-specific `.venv311` links in this worktree reuse existing local worker
  environments. Full TypeScript QA needed an 8 GB heap; the earlier default heap
  exhausted memory. Do not confuse that failure with a passing check.

There is no need for a live process to survive the usage reset to reconstruct
this work. Reconcile Git, CI, files, database and browser identity on return.
