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

Finish cancellation mutation verification before further integration. The 51-case
runner completed 49 cases, including one harmless survivor and 48 targeted failures,
then `socket-cancellation` exceeded its 45-second subprocess timeout. The final
`deadline` case was not reached. Do not call this a 51-case pass. The private
`transport-mutations.json` is an older 46-case receipt; the progress JSON is newer.
The runner restored production source in `finally`; the signal is present again
in the Node request options. A restored run passed 73 transport and 48 shared
outbound tests, TypeScript and changed-file ESLint. See `checkpoint.json`.

Inspect cancellation test and fixture teardown so deliberately removing socket
cancellation produces an attributable test failure and exits cleanly. A timeout
alone is not sufficient mutation evidence. Preserve the earlier failure. The
copied runner has explicit local paths; adapt them if resuming elsewhere. It runs
in a network namespace with only loopback to keep broken SSRF mutations isolated.
Recheck process ownership before running it, and never edit a served acceptance
checkout. No need to wait for old exec session 32328; it exited with TimeoutExpired.

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
