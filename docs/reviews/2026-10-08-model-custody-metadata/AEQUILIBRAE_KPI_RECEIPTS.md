# Confirm AequilibraE KPI insert receipts

October 8, 2026. The AequilibraE KPI helper previously ignored the POST response and supplied no timeout. A rejected or unacknowledged insert could therefore let its caller continue as if the KPI had been retained.

The helper now requires HTTP 201 with exactly one identified row containing every submitted field and value. Missing values differ from explicit null. Transport, malformed response and mismatched-row outcomes raise the existing write-uncertainty exception without including response bodies. The request has a 30-second timeout and is not retried automatically. Existing stage uncertainty handling stops without rewriting an uncertain operation as terminal success or failure.

All 32 push-trigger checks pass. New mocked cases cover accepted rows, failed status, missing and duplicate rows, wrong run, missing null field, null changed to zero, JSON/transport failures and a synthetic stage handler that stops after an uncertain KPI insert. Harmless and restored controls pass; removing the HTTP check and returned-field comparison each fails at the intended receipt assertion. Controls use a non-listening loopback URL and restore the source in a finally block.

This is HTTP-response and synthetic stage-control evidence. It does not prove a live database insert, arbitrary scientific-handler exception propagation, attempt ownership, idempotent writes, artifact receipts, Storage bytes, process restart or scientific accuracy. The separate database prototype remains outside application migrations. ActivitySim already has its own insert receipt helper; neither package gains attempt ownership from this patch.

## Native insert and lost acknowledgement

The October 8 continuation calls the changed AequilibraE helper against the named disposable restore-target stack. The runner resolves connection settings privately and checks that the database port belongs to that named container before writing synthetic records. A direct PostgreSQL query confirms one retained KPI with an explicit null value.

A second call reaches the real database and receives HTTP 201, then the transport shim raises a timeout before the helper sees the acknowledgement. The helper raises write uncertainty. The shim records one call, and an independent PostgreSQL query finds exactly one committed row. There is no automatic retry. Synthetic records remain in the isolated test database; this is not a model execution.

Private evidence is retained as `native-aequilibrae-kpi-inserts.py` and `native-aequilibrae-kpi-inserts.json` in the existing local proof directory. The result records the exact helper source digest, fixture identities and one-call/one-row outcome without credentials. This adds native insert evidence to the earlier HTTP tests. It does not establish attempt ownership, artifact bytes, arbitrary handler propagation, process recovery or scientific validity.

## Shared artifact and KPI receipts

The next October 8 continuation traces both KPI calls. The artifact-stage KPI loop has no local exception handler; the same-network ActivitySim assignment KPI loop sits under the existing stage write-uncertainty handler. Neither direct KPI call swallows that exception.

Artifact registration had a related gap: any 2xx response was accepted, and a malformed or empty receipt could return no row. Artifact and KPI helpers now use one checked insert implementation. Artifact registration returns the validated row, preserving the identifier used by downstream evidence writes. Errors retain the HTTP status but omit private response bodies.

All 33 push-trigger and 26 ActivitySim assignment-handoff checks pass. Harmless/restored controls pass; removing the HTTP or field comparison fails at the intended artifact assertion. The native isolated-database probe retains a null KPI and synthetic artifact metadata, then confirms a real committed KPI insert with a lost acknowledgement remains uncertain with one request and one row. Private evidence is `native-aequilibrae-output-inserts.py/json`. Metadata insertion does not prove uploaded artifact bytes.

One call-site gap remains: the GeoJSON upload/registration block in `stage_artifacts` catches broad exceptions and logs a warning. This patch checks its insert receipt but does not yet establish propagation out of that block. Do not describe all artifact errors as stage-stopping. Byte integrity, attempt ownership and process recovery also remain separate work.

## GeoJSON registration uncertainty propagation

The October 8 continuation extracts the existing GeoJSON publication block into `publish_volume_geojson`. The artifact stage calls it outside local exception handling. The helper rethrows `WorkerStateWriteUnconfirmed` before its existing generation-warning handler, so an uncertain registration reaches the stage-level uncertainty boundary. The Storage request now has a 60-second timeout. Existing missing-database warnings remain explicit.

All 35 push-trigger checks pass. The new test reads a synthetic CSV, uses a mocked SQLite geometry result and generates an actual GeoJSON file. A mocked successful metadata response verifies the file hash and feature count. A simulated lost registration acknowledgement escapes as uncertainty, with one upload request and one registration request. The missing-database case makes no requests. Harmless/restored controls pass; removing the dedicated uncertainty handler fails at `uncertain GeoJSON registration swallowed`.

This closes the identified registration-exception gap. It does not prove live Storage upload bytes, arbitrary generation failures, immutable Storage keys, scientific geometry validity or process restart. Ordinary generation/upload warnings retain their prior behavior; only checked metadata-registration uncertainty now propagates.

## Native GeoJSON byte verification

The October 8 continuation exercises the extracted publisher with an actual synthetic SQLite database and SpatiaLite geometry. A one-link CSV feeds the existing GeoJSON generation code. The configured isolated Supabase Storage service accepts the upload, and the checked artifact insert retains its metadata.

The runner uses a fresh synthetic run and stage, then independently reads the artifact row through PostgreSQL and downloads the object through the authenticated Storage endpoint. Downloaded bytes equal the locally generated file. The retained hash and size match those bytes, and the GeoJSON contains the expected synthetic feature and volume. The stack database port is checked against the named restore-target container before writes.

Private script and results are `native-aequilibrae-geojson.py`, `native-aequilibrae-geojson.json` and the generated `.geojson` file in the local proof directory. This extends the mocked transport tests to an actual upload/registration/download path. No scientific computation or real geography is represented. The run-scoped key still permits upsert, so later overwrite protection, attempt ownership, restart recovery and scientific validity remain open.
