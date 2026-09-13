# Response route integration checkpoint

Historical status at 95eae82a. The later app/editor join is described in
[EDITOR_JOIN.md](EDITOR_JOIN.md); the unwired-handler statements below describe
that earlier checkpoint.

September 13, 2026. This continues the unreleased response-write work. It does
not enable the prototype SQL or replace the released editor's request contract.

`openplan/src/lib/engagement/response-write-route.ts` supplies the create, update
and remove handlers for the upcoming switch. It validates the request identity,
original version and reason, checks staff access, then calls the real typed
`writeResponse` adapter. It performs no direct response-table writes, separate
category/prior-status reads or inline email delivery. Those checks and side
effects belong to the transaction, including its replay and publication queue.
The existing route exports still use their released handlers until the editor
can retain and send the new intent. Switch those together; do not add a legacy
payload bypass to the transaction.

A confirmed receipt remains a successful save if its subsequent subscriber-status
read fails. An exact replay returns the original response, including removal, and
loads current aggregate outcomes for the original publication request. A newly
created response returns 201, its replay 200. Unconfirmed results ask for the same
request again; conflicts remain 409, with draft review required before a new
request. Database details and participant information are excluded from errors.

`response-broadcast.ts` validates the private aggregate RPC output, including both
scope IDs, known states, nonnegative integer counts and a complete prepared total.
A queued request has no known recipient count. Only successful preparation can
establish zero recipients. Extra report fields are refused rather than forwarded.
The authenticated GET at `closeloop/broadcasts/[requestId]` exposes this reader for
refresh/reload with private no-store responses. A missing record is 404, a failed
read is 503, and permission refusal is 403. The SQL remains unapplied, so this
endpoint cannot provide reports on the source stack yet.

`engagement-response-write-route.test.ts` exercises the real Next request/response
boundary, adapter and report reader, with mocked authentication/access and RPC
replies. It contains 83 tests. `prove-routes.py` records the baseline and harmless
comment survivor plus 25 targeted failures in `route-mutations.json`, then
restores source files. The first run injected an invalid TypeScript statement;
no semantic test ran for that mutation, and the harness rejected the result.
`initial-route-mutations.json` preserves that failure. The corrected injection
fails the tests that require a confirmed publication to remain successful.

Blind categories: these tests do not prove database role enforcement, concurrency,
queue trigger execution, actual provider delivery or browser reachability. They
also do not establish that the existing create/PATCH/DELETE exports use the new
handler; they deliberately do not yet. The SQL probes and worker process tests
remain separately bounded evidence. Required remaining work includes the editor's
retained pending intent, conflict comparison and review, history reason display,
Activity outcome counts, live REST/worker recovery, migration promotion and the
full affected-workflow release checks. No release claim is made here.
