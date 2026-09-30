# Bounded complete segment tasks and source-bound observations

September 30, 2026. Unreleased internal development following [typed fields](FIELDS.md). These functions do not dispatch a model or create a review.

`openplan/src/lib/engagement/synthesis-generation-tasks.ts` creates independently parseable tasks from the complete authoritative field inventory. Each task retains the source and record identity, complete-field checksum, exact field path/type and explicit continuation ranges in UTF-16 code units. Valid surrogate pairs stay together. Original escaped unpaired surrogate values remain distinct in the retained JSON encoding. Each field reconstructs exactly from its ordered parts, including empty values, numeric token spelling and complete container counts.

The configured limit bounds the UTF-8 size of the frozen JSON task, including instructions, input and output schema. It does not establish model tokenizer fit or include every provider transport header. Oversized metadata fails planning explicitly. It does not clip a path or replace the retained source. The planner limits its search window before serializing trial fragments, avoiding repeated scans of the entire remaining long field.

Tasks identify whether they contain the entire record. Linked references explicitly say their content is not included in that task, even when the source retains it elsewhere. All retained records are planned, including context, historical definitions and sessions. Empty selections still retain their context tasks; the future execution layer must resolve an empty contribution selection without unnecessary model dispatch. Record/context consolidation remains required before any generated synthesis can be offered for review.

The output validator requires exact supplied-part coverage for a task marked complete. It refuses duplicate/unknown coverage, citations to unprocessed parts, container values used as text quotes, invented quotes and unsupported output fields. Incomplete processing remains explicit. This validator takes a task from an independently verified plan; a caller must not treat a self-hashed task as authority. Source accounting and literal quotes cannot prove correct interpretation or representativeness. All returned results retain `interpretation: not_assessed`.

## Verification

Four focused tests cover independent full-field reconstruction across more than 300 contributions, long/multilingual text, escaping, exact numeric tokens, surrogate identity, explicit resource refusal, authoritative scope, complete task manifests and invalid observations. The combined related suite passes 114 tests across seven files. Lint and TypeScript pass on restored source. [Check receipts](tasks-checks.json) bind these results to the source and logs. [Full QA and shuffled tests](protocol-checks.json) now pass for the combined task/result increment, with 16,022 tests passing and 828 explicit skips.

The [fault results](tasks-mutations.json) retain two passing controls, 28 caught targeted failures and one observed survivor. The [initial run](tasks-first-probe.json) stopped when removing the surrogate-boundary adjustment survived. This change did not break the tested JSON fragments, so it is not counted as evidence that the test catches a broken boundary. A separate forced split creates invalid fragments while preserving their stated ranges; the well-formedness assertion fails at that boundary. The [runner](prove-tasks.py) preserves the observed survivor and restores the source.

No route, database schema, worker dispatch or UI changes here. Pending work includes complete record/context consolidation, original provider output and usage receipts, configured backend limits, durable jobs, cancellation/revocation, uncertain-call recovery, explicit staff import and browser acceptance. Provider finish reasons must be checked separately from a model's `complete` label. Manual preparation and review remain available; neither M9b nor V1 is complete.

The [result-accounting implementation](RESULTS.md) preserves selected task receipts and incomplete states before record/context consolidation.
