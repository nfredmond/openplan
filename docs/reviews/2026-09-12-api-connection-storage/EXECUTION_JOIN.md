# Execution join inspection, September 12

Read-only follow-on analysis while settings QA runs. This is not implemented.

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
