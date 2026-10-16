# Experimental output reproduces the retained full schema

October 16, 2026 follow-up. The cached 0.154 binary's default output differs
from the historical full bundle. A separate offline capture with
`app-server generate-json-schema --experimental` reproduces that historical
bundle byte for byte. The connector's initialize request enables
`experimentalApi: true` in `workers/planner_agent_connector/codex-provider.mjs`.
This result records the relevant schema mode without using an account.

The new private root is
`/home/nathaniel/.local/state/openplan/a0-codex154-experimental-schema-20261016`.
It uses the preceding capture command and namespace constructors without changing
them or their original proof. The fixed retained package stays read-only inside
the namespace. Host profiles and networking stay absent. No app-server session,
account read, authentication, model turn or reset-credit operation runs.
No installation, updater, global launcher or configuration changes.

The manager and native command both finish with exit zero. Unit
`openplan-a0-codex154-experimental-schema-20261016-01` reports invocation
`4c65c39033354efaba6264a498ca59e6`, 3.641 seconds runtime, 287.8M peak memory
and zero swap. The request specifies 1 GiB maximum memory, zero swap,
50 percent CPU and a 120-second lifetime under the shared compiler flock.
This follow-up does not capture its in-unit cgroup settings or memory events;
those requested limits are not relabeled as an independently read cgroup census.
Its individual native command retains the existing 30-second wait.

The generated output has 426 files totaling 4,210,655 bytes. The full v2 bundle
SHA-256 is `7b9e7d385fffef8d428cc5490b56ce9c393bd3ed7bc7ccd730956387e723ec05`,
equal to the retained historical bundle. Structural equality and all seven
selected usage-limit definitions also match. Package binary and metadata hashes
remain equal before and after, and match the preceding default capture.

The earlier default output is an observed nonmatching comparison. Its 191
structural differences remain recorded. Selecting experimental output removes
those differences in this observed capture. This does not prove which invocation
originally produced the historical file or that all future CLI versions behave
the same way. The original default capture, commands, streams and control trials
remain unchanged.

The new record retains the exact native intent and arguments, returned PID,
native streams and exit hashes, manager intent/PID/stream/exit, runner source,
output inventory and comparator result. [Experimental evidence](experimental-evidence.json)
pins those files. The preceding namespace, predicate and path controls remain
their stated evidence; this is another actual metadata command, not another
provider compatibility campaign.

The direct helper does not enter the preceding capture main's umask setup.
ROOT records the new output modes, then normalizes only this new private root
to 0700 directories and 0600 files. Every preceding byte hash stays equal.
The prior public pin set remains in commit history; the new pin set records the
permission correction. The original default capture retains all 343 byte/mode
pins unchanged. These generated schemas contain type metadata, not account data.

Full schema reproduction establishes the retained type artifact's reproducibility
with this exact binary and mode. It does not establish native account/model
compatibility, real usage limits, route-to-database publication, SQL18/RLS,
reader/UI, desktop/390px journeys, human or scientific acceptance. Generic reset
timing stays unknown. There is no application, worker, migration, main merge,
hosted operation or release change. Independent artifact review remains pending.
