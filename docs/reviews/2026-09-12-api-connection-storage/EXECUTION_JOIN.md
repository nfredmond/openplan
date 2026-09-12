# Execution join inspection, September 12

Read-only follow-on analysis while settings QA runs. This is not implemented.

The generation adapter is now implemented separately in
`openplan/src/lib/assistant/provider-api-generation.ts`; its evidence lives in
`../2026-09-12-api-provider-generation/VERIFICATION.md`. Reuse that implementation
when joining the worker. The database lifecycle and worker below are still open.

The canonical base migration is
`20261010000001_assistant_provider_connections.sql`, followed by Claude/OpenCode
wrappers. `finish_assistant_provider_turn` contains the common output and exact
proposal checks. Its service branch currently refuses every provider except
Anthropic. Extend that branch and preserve common validation; a new worker must
not directly update successful result rows or change a provider temporarily.

The next implementation should make editing explicitly interrupt queued/running
attempts bound to the superseded API revision. Exact old save retries return
before that transition and must not cancel newer work. Revocation interrupts all
active attempts of that connection; retained completed answers remain unchanged.

Creation already checks membership/project before connection and turn. Existing
user read/cancel and Anthropic finish lock the turn before scope checks. For the
new API path, establish membership -> project -> API connection -> turn order
across create, claim, status, finish, cancel and configuration edits/revocation.
Read the candidate identity without a row lock, then acquire and recheck in order.
The queue chooser must not first lock a turn and only then lock its connection.
Existing native functions have their own connection lock path, so test their
unchanged histories and concurrency separately after any shared-function rewrite.
This is an identified risk, not a demonstrated deadlock in current settings.

Bind an optional composite workspace/API revision reference to the existing
turn. Resolve endpoint, protocol, exact model, credential mode and timeout from
that immutable revision. Include revision identity/configuration hash and explicit
charge acknowledgement in the request hash. Do not trust a browser-supplied URL
or use the current connection pointer to reinterpret a historical request.

The worker needs one claimed attempt, an explicit bounded lease and periodic
current-access/cancellation checks. Process loss must expire visibly rather than
requeue a generation. A retained completion can retry delivery without invoking
the model. Inspect the native connector's private pending-result journal before
adding a worker completion spool; the spool is a delivery receipt, not another
owner of job state. Keep sensitive result bytes out of logs and public evidence.

The existing scope helper permits viewers to ask the scoped read/draft question;
actual mutation remains separately approved/authorized. Do not accidentally
remove that established read capability while joining API selection.

The native connector already has the needed filesystem primitives in
`workers/planner_agent_connector/connector-worker.mjs`: private directory checks,
exclusive OS lock, 0600 temporary journal, fsync, atomic rename and directory sync.
`connector-client.mjs` reads bounded private JSON. Its cycle journals `running`
before generation, converts restart of that phase to an interruption, and retries
`completed` delivery without generation. Reuse or extract these tested primitives
with explicit TypeScript types; do not invent a second journaling convention.
The API worker's journal identity additionally needs deployment/stack identity and
workspace/connection/revision/turn/attempt binding, since it is not a single
personal native-connection process.

## Usage accounting inspection

Current `openplan/src/lib/runtime/ai-rate-limit.ts` explicitly allows requests
when its usage lookup fails. Its recording helper also swallows insert failures.
These are documented existing behaviors, not proof of durable dispatch custody.
Do not describe merely calling those helpers as a transactional reservation.

For the new API queue, retain a conservative dispatch event in the same
transaction that moves one queued turn to its running attempt. Reuse
`usage_events` and its unique `idempotency_key`; no new billing ledger or software
entitlement is needed. Serialize new API reservations per workspace without
inverting membership -> project -> connection -> turn locks. The existing staff
allowance is 20 events over 300 seconds across six named staff buckets. Other
provider paths still use their documented best-effort counting, so a new API
reservation cannot honestly promise a strict global cap across all AI callers.

An event records a reserved dispatch, not a provider charge or proof that the
network call occurred. A crash after claim but before dispatch must remain
interrupted and may conservatively consume that window's reservation. Retries
of saved completion delivery must neither reserve again nor generate again.
Missing usage storage must roll the new claim back before dispatch. Keep the
older provider behavior unchanged in this bounded integration and retain this
distinction in its evidence.
