# Continue here: complete response reads

Worktree /home/nathaniel/.local/state/openplan/agent-hold-receipts-2026-09-10,
package openplan/, branch work/engagement-response-snapshots. Runtime checkpoint
5ffec6c8eb31dd29cae2f05f4774d184b95a833a is pushed. v0.55.1 is already published
at main 0f61c372; do not recreate that release. The new read repair is unreleased.
No subagents or other sessions own this worktree. Preserve root checkout/demo,
the reminder constraint and the full v1 contract. Direct main after verification,
no PR or human-review gate.

## Check results at usage-reset checkpoint

- Full QA: terminal 0, tool handle 61151. 14107 application tests passed,
  450 skipped; connector 382 passed/4 skipped; lint, types, build and audit passed.
- Shuffle 912558: terminal 0, handle 2825, same application counts.
- Full live RLS: terminal 0 at 2026-09-13T03:18:59.605Z. All 479 tests
  in 50 files passed. It targeted only openplan-restore-target-2026091050
  through OPENPLAN_SUPABASE_WORKDIR; terminal receipt and log were read back.
- Upgrade Path: GitHub run 34734998153 completed successfully on
  5ffec6c8eb31dd29cae2f05f4774d184b95a833a, upgrading from v0.55.1.
  Its completed/success result was checked through gh run view. Do not duplicate.

Private directory /home/nathaniel/.local/state/openplan/api-provider-research-2026-09-12
contains m9b-snapshot-full-qa, m9b-snapshot-shuffled and m9b-snapshot-full-rls
logs and terminal .result.json files. Missing tool handles require checking
actual processes and these receipts, not automatically restarting a live run.
Use api-settings.env without printing it. The synthetic account file is
api-settings-account.json; never copy credentials into public evidence.

## Next browser acceptance

RLS has finished. Recheck process and stack ownership before browser acceptance.
No app/proxy/browser process is currently running. The isolated stack is on
API 29821 / DB 29822, now at migration 20261013000001, with 319 migrations.
Do not reset or reapply the already-applied migration. The initial transactional
database-mutations.py is historical and expects the function absent; it cannot
be replayed unchanged after migration application. Concurrent-read mutations
restore the existing function and have completed successfully.

The private m9b-snapshot-proxy-dev.cjs launches Next dev at 3255 and a proxy at
3218 with the correct local environment. Launch its parent with Node's
--env-file=api-settings.env argument. The proxy matches POST
/rest/v1/rpc/read_engagement_response_snapshot and p_campaign, and forwards
consumed request bodies. Both prepared scripts passed node --check; the
matcher still needs actual fault/recovery acceptance. Verify free ports and
which-openplan.sh identity before claiming browser behavior.

Private m9b-snapshot-browser.cjs is adapted from the prior real-navigation
staff journey, with new output names. Run desktop and WIDTH=390 after identifying
the served checkout. It creates a campaign and response through the UI, retries
an injected RPC failure, checks unchanged response hashes, keyboard controls,
console, overflow and anonymous API denial. Inspect images and retain evidence.

Also cover the larger-than-1000 case and the public/preview response reader.
Create the campaign and first response through real UI navigation; extend via
the observed application's POST producer if bulk setup is needed. Do not use
the direct-database probe as browser acceptance. Public test campaigns must be
explicitly synthetic and have no real subscribers. Read the actual publish and
preview controls before using them. Never claim public reachability from the
staff or unit test alone. Browser evidence must not overlap a changing checkout.

Retained test campaigns are archived with public submissions disabled. Two
synthetic outsider identities remain; the first deletion attempt returned an
unexplained Auth 500. Do not bypass history guards to clean them up. Their IDs
are in initial-http-cleanup-recovery.json and postgrest-probe.json. Original
v0.55.1 responses still match their retained hashes.

After browser checks and any necessary fixes, align the next release metadata,
run applicable final gates, merge directly to main, inspect exact final CI/RLS
and upgrade evidence, and tag the coherent repair. Keep response revision history,
source-to-decision/commitment links and the rest of M9b open. Continue from the
current roadmap after that increment; the full v1 goal remains active.

## Returning after the usage reset

The user asked whether this thread can resume after a usage reset. Work is saved
and pushed on the branch above. Re-read this file and live git/process state; do
not assume old tool handles or browser sessions survive. Resume browser acceptance
for this existing implementation, then release and continue the full v1 roadmap.
No new product scope or approval is needed. No new long-running work was started
while making this checkpoint.
