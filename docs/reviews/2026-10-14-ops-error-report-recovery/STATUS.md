# Error reports recover from malformed configuration

October 14, 2026. Unmerged correction to PR #326, based on ebffb5ebe.

Malformed percent encoding in a configured Sentry DSN previously escaped the
forwarding catch. Parsing now returns null. Known public-token path parents now
scrub UUID-shaped tokens, while ordinary project record UUIDs remain useful.

Four six-case cohorts pass, including a harmless source comment and restored
bytes. All six targeted faults fail at the named assertions. The classifier
accepts two valid failure records and refuses six unrelated or incomplete ones.
See [controls](controls.json), [classifier controls](oracle-controls.json) and
[source bindings](source-bindings.json). The executable controller restores all
source and test bytes in finally. The initial campaign refused a generic diff
that lacked its required diagnostic. Explicit assertion messages correct the
harness; the failed private evidence remains retained.

These are local parser and report-shaping checks. No real Sentry project received
an event. Unknown public-token parents and arbitrary secrets embedded in free
text are outside this bounded correction. Related tests, static review and exact
updated-head CI remain separate checks. No provider account or setting changes.

Scoped TypeScript and changed-file lint pass. Three shuffled related cohorts
pass; counts are in [related evidence](../2026-10-14-ops-health-transport/related-tests.json).
[Frozen static review](../2026-10-14-ops-health-transport/INDEPENDENT_REVIEW.md)
finds no further concrete defect. The socket fixtures stall before headers,
so cancellation during response-body reading is not directly established.
Exact updated-head CI and hosted checks remain pending.
