# Confirm AequilibraE KPI insert receipts

October 8, 2026. The AequilibraE KPI helper previously ignored the POST response and supplied no timeout. A rejected or unacknowledged insert could therefore let its caller continue as if the KPI had been retained.

The helper now requires HTTP 201 with exactly one identified row containing every submitted field and value. Missing values differ from explicit null. Transport, malformed response and mismatched-row outcomes raise the existing write-uncertainty exception without including response bodies. The request has a 30-second timeout and is not retried automatically. Existing stage uncertainty handling stops without rewriting an uncertain operation as terminal success or failure.

All 32 push-trigger checks pass. New mocked cases cover accepted rows, failed status, missing and duplicate rows, wrong run, missing null field, null changed to zero, JSON/transport failures and a synthetic stage handler that stops after an uncertain KPI insert. Harmless and restored controls pass; removing the HTTP check and returned-field comparison each fails at the intended receipt assertion. Controls use a non-listening loopback URL and restore the source in a finally block.

This is HTTP-response and synthetic stage-control evidence. It does not prove a live database insert, arbitrary scientific-handler exception propagation, attempt ownership, idempotent writes, artifact receipts, Storage bytes, process restart or scientific accuracy. The separate database prototype remains outside application migrations. ActivitySim already has its own insert receipt helper; neither package gains attempt ownership from this patch.

## Native insert and lost acknowledgement

The October 8 continuation calls the changed AequilibraE helper against the named disposable restore-target stack. The runner resolves connection settings privately and checks that the database port belongs to that named container before writing synthetic records. A direct PostgreSQL query confirms one retained KPI with an explicit null value.

A second call reaches the real database and receives HTTP 201, then the transport shim raises a timeout before the helper sees the acknowledgement. The helper raises write uncertainty. The shim records one call, and an independent PostgreSQL query finds exactly one committed row. There is no automatic retry. Synthetic records remain in the isolated test database; this is not a model execution.

Private evidence is retained as `native-aequilibrae-kpi-inserts.py` and `native-aequilibrae-kpi-inserts.json` in the existing local proof directory. The result records the exact helper source digest, fixture identities and one-call/one-row outcome without credentials. This adds native insert evidence to the earlier HTTP tests. It does not establish attempt ownership, artifact bytes, arbitrary handler propagation, process recovery or scientific validity.
