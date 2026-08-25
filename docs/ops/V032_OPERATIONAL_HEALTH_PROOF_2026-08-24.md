# v0.32 operational health and evidence-honesty proof

This is the durable proof record for the v0.32 release candidate. It covers the
planner-visible worker-health, reminder-preference, crash-cutoff, and corridor
score-presentation changes. The reviewed release commit is recorded in
`docs/ROADMAP.md` when the release is cut.

## Deliberate mutation results

Each mutation below was applied to production code, its named test was run and
failed for the stated reason, and the production code was restored by editing it
back before the passing run.

| Guarded behavior | Production mutation | Failure observed |
|---|---|---|
| Two-minute heartbeat boundary | Changed both freshness comparisons from `<=` to `<` | `modeling-worker-health.test.ts` classified the exact boundary as stale |
| Stale launch acknowledgement and expiry | Removed stale states from the launch gate | Both create and relaunch route tests returned success instead of 409; the exact-observation unit assertion also failed |
| Accessibility requires transit evidence | Bypassed the transit-availability branch | `score-presentation.test.ts` exposed 72 instead of withholding it |
| Assistant facts honor score suppression | Read raw score fields in `metricLabel` | `assistant-respond.test.ts` emitted 99/98/97/96 instead of N/A |
| Report score suppression | Read the raw Accessibility field in the report card | `report-route.test.ts` printed 5 instead of withholding it |
| Suppressed map scores are neutral | Replaced the neutral fallback color with the lowest-score red | `explore-map-layer-helpers.test.ts` failed on the fallback expression |
| Per-workspace reminder window | Ignored the stored advance window and used seven days | `work-notification-sweep.test.ts` created the two-day workspace's out-of-window reminder |
| Email digest opt-out | Bypassed the email preference branch | The sweep recorded zero disabled digests instead of two and attempted their email path |
| Scheduler warning over old reminders | Hid the warning for a stale heartbeat | `work-notification-inbox.test.tsx` could not find the warning while unread rows remained |
| Analysis crash cutoff propagation | Removed `publishedThrough` from the crash snapshot | `crash-published-cutoff.test.ts` received no cutoff |
| Safety cutoff display | Forced the stored-ingest branch to use the no-cutoff sentence | `safety-workspace.test.tsx` lost the exact date and provenance link |
| Report cutoff propagation | Dropped the cutoff in the packet evidence builder | Both the packet builder and rendered HTML assertions failed |
| Authoritative FARS cutoff | Changed the final-file cutoff from 2023 to the unsupported 2024 estimate | `safety-crash-sources.test.ts` rejected the date |
| Owner/admin-only reminder writes | Added `member` to one migration write predicate | `v032-operational-health-migration.test.ts` found only two of three exact owner/admin predicates |
| Reminder-preference assistant refusal | Temporarily registered `configure_workspace_reminder_preferences` | The executable refusal test named the new action and failed |
| AequilibraE heartbeat kind | Emitted `wrong-kind` | The worker heartbeat suite rejected the payload |
| ActivitySim runtime mode | Emitted `wrong-mode` | The worker heartbeat suite rejected the payload |
| Deployment heartbeat wording | Restored the obsolete “poller with no heartbeat” copy | `deployment-health.test.ts` rejected the contradiction on both deployment surfaces |
| Corridor cutoff disclosure | Removed the no-exact-cutoff note from both the source snapshot and narrative | `crash-published-cutoff.test.ts` failed both propagation assertions |
| v0.32 migration high-water mark | Recorded 220 migrations instead of 221 | `release-ordering.test.ts` failed both the exact release count and latest-release split |

## Environment-backed checks

- The local migration applied without resetting the working database.
- Live RLS ran 100 checks against the local stack. Cross-workspace reminder
  reads stayed isolated, viewers could read but not change preferences, and
  authenticated or anonymous clients could not see worker heartbeat rows.
- The disposable recovery drill built two isolated Supabase stacks, restored a
  preference row, heartbeat row, paired crash cutoff/provenance row, evidence
  custody records, and a private Storage object, verified their relationships
  and hashes, then ran live RLS against the restored target. It passed.
- `npm run test:workers` discovered and passed all 47 Python worker suites,
  including both new heartbeat suites.
- The final `npm run qa:gate` passed 1,094 app test files with 12,457 tests,
  100 live RLS checks, the production dependency audit with zero
  vulnerabilities, and the Next.js production build. Lint and the repository's
  dead-code ratchet also passed.

The populated previous-release upgrade rehearsal inserted and verified
representative v0.32 rows after applying the new migration. CI, RLS isolation,
and the upgrade rehearsal passed for the feature candidate; CI and RLS also
passed for the final browser-found fix commit `92fb82e0`.

## Browser evidence

The desktop and 390-by-844 mobile journeys are recorded in
`docs/ops/2026-08-24-v032-browser-check.md`. They used the local Supabase stack
and the candidate source from the canonical package root. The browser pass found
two planner-facing contradictions—the obsolete worker copy and an omitted crash
cutoff disclosure—and both were fixed and mutation-guarded before release.
