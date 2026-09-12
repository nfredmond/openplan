# Resume after usage reset, September 12, 2026

This is an unfinished development checkpoint, not a release or usable API connection.
The user asked to protect progress before the weekly usage reset. Continue the full
v1 goal with direct main integration after verification, no PRs, no human engineering
release gate, local/free operation and no paid provider requests.

## Where the work lives

- Checkout: `/home/nathaniel/.local/state/openplan/agent-hold-receipts-2026-09-10`
- Package: `openplan/`; branch: `work/planner-agent-api-connections`.
- Base main: `3a4d0900776dcf0531fa0e6b8cf7218620f448b8`.
- v0.54.0 is already published. Its release receipts are in
  `../2026-09-10-opencode-native-spike/publication.json`. Do not repeat that release.
- Private logs and original mutation runner:
  `/home/nathaniel/.local/state/openplan/api-provider-research-2026-09-12`.
- No mutation runner or Vitest process remained at checkpoint inspection.

## Exact next action

The cancellation mutation timeout is resolved. The complete 51-case transport
campaign and separate readable cancellation rerun passed their expected outcomes.
Credential binding is now implemented and its 23-case mutation campaign passed
its expected outcomes. Each campaign includes a surviving harmless comment.
See `VERIFICATION.md` and the three mutation JSON receipts. The original
`checkpoint.json` is historical partial evidence and must not be treated as the
latest state. Restored focused tests: 155 across three files.

Source `a86a1cd9` passed full QA and shuffled seed 912054 with 13,907 app tests
and 401 skips, 382 connector tests/four native opt-in skips, 430 isolated RLS
checks, all 52 worker suites and the production build. Final focused count is
157. See `local-checks.json`. The superseded shuffled failure and deliberately
interrupted first QA remain in private logs. All of those local jobs are finished.
The selected disposable RLS stack remains
`/home/nathaniel/.local/state/openplan/openplan-restore-target-2026091050`, API
29821, DB 29822, container `supabase_db_openplan-restore-target-2026091050`.
No migrations have been added by this increment. Check GitHub's current main
SHA and CI separately before resuming; do not infer remote success from the push.

Next implement versioned workspace connection storage and the execution join.
The exact endpoint canonicalizer is exported from `provider-api-transport.ts`;
`provider-api-credentials.ts` shares it and reuses existing integration encryption.
Its credential envelope binds workspace, revision and the complete normalized
configuration. Keyless connections need no operator encryption secret; keyed
connections refuse missing/rotated secrets without fallback.

## Implementation and remaining scope

`provider-api-transport.ts` and its tests implement an unused request transport,
with exact endpoint/model/key binding, pinned validated DNS, public HTTPS or
operator-approved loopback endpoints, private agents, TLS checks, bounded bodies,
raw response identity validation, cancellation and no automatic retry/fallback.
The pinned new dependency is `@ai-sdk/openai-compatible` 2.0.75 on existing AI SDK 6.
The SDK otherwise fills in missing response model identity, which this guard refuses.

Next extend existing integration encryption and owner/admin authorization with
immutable workspace API connection revisions. Bind revisions to retained request
identity, implement execution/recovery without rerouting old attempts, and expose
selection through the existing provider workflow. Decide how long local generations
use durable workers rather than assuming they fit the existing short API route.
See `../2026-09-10-opencode-native-spike/API_PROVIDER_NEXT.md` for design context.
There is no new database schema, API connection UI or live provider integration yet.

Blind categories: local fixtures do not prove real provider compatibility; this
transport does not establish workspace authority; cancellation cannot undo remote
computation already accepted; DNS may finish after cancellation without a socket.
Full QA, shuffled tests, isolated RLS/upgrade/worker checks, and identified desktop
and 390px browser journeys remain required for the eventual integrated capability.
Keep the pending reminder constraint unchanged. Preserve the complete roadmap and
separate AequilibraE/ActivitySim validation obligations. Re-run product direction
and inspect current ownership, main, tags and CI before selecting further work.
