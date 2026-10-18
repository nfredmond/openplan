# Publication refuses ambiguous native adoption decisions

October 16, 2026. This is a bounded source response, pending a fresh independent
exact-commit review. Migration 425 remains unapplied and native acceptance open.

The complete round-2 review is preserved unchanged at
[`../2026-10-16-land-use-publication-retained-independent/REPORT.md`](../2026-10-16-land-use-publication-retained-independent/REPORT.md).
Review commit `2da034a2189c99e5538b56f62cd96ed135d5823b` requests changes for
one new P2 at candidate `ac9c74a80b1de7b402cc54e7c216107a79aaaaed`.
It supports the two earlier retained-artifact and nested-decision corrections
at their bounded source tier. Neither request-changes report is rewritten.

## The count matches the unchanged reader

The publication function selects one adoption/amendment record with LIMIT 1.
That does not establish that the edition's native query sees one record.
`loadReportAdoption` queries by plan ID, version ID and manifest hash, then uses
`maybeSingle()`. The schema permits multiple rows with those same values.
Two valid retained rows can therefore pass the selected-row checks while making
the reader refuse. This is a source counterexample, not a native reproduction.
The API's zero-or-one contract is documented by
[Supabase](https://supabase.com/docs/reference/javascript/maybesingle).

The function now counts matches in exactly that three-field scope. It requires
one before either inserting a packet or confirming an existing pointer. The count
does not add a workspace, decision-kind or content-hash predicate absent from
the unchanged reader query. Other decision history with a different manifest hash
does not enter this count. No rows are deleted or repaired, no manifest is
synthesized and no global uniqueness constraint is introduced.

The selected native row, its hash, seven nested values and frozen source still
undergo their existing checks. The singleton HTML artifact, disqualifying-kind
refusal, current actor/adopted/version locks, report/artifact inserts and
NULL-guarded pointer update remain unchanged. Hash encodings, helper, route,
reader, base grants and policies remain unchanged. Migration 425 retains its
CLI-generated filename; its exact prior bytes remain preserved privately.

The count establishes a retained-state precondition at its query, not exclusion
of every later direct insert. PostgreSQL parsing, installed visibility, concurrent
writers, rollback, RLS, ACLs and migration history still need native evidence.

## Four selected cases and four intended faults complete

One unit, `openplan-land-use-publication-cardinality-checks-20261016-01`,
finishes exit zero. The bounded parent records 28.511573330964893 seconds.
Entry records invocation `054acb06e2744bcea9afced5eb2c06ec`; it is not inferred
from the manager announcement. Actual limits are 1 GiB, zero swap, CPU50 and
Tasks64. The late in-unit peak is 286,007,296 bytes, PID peak42, with zero memory
and PID limit events. Named root/source/donor mounts are read-only, the new proof
root is writable, and its network namespace differs from the recorded host.
These receipts do not establish host-wide confinement.

Harmless, baseline and restored selections each pass four cases. Three are new:
the actual unchanged reader refuses a supplied PGRST116 multirow error; the SQL
composition contains the exact three-field count; and that refusal precedes both
publication paths. One existing valid nullable-decision case provides continuity,
including its exact native projection and filters. The other 19 cases in this
test file stay skipped. The earlier 21-case/12-fault and original 25-case/16-fault
campaigns do not repeat.

The supplied error has the installed PostgREST builder's PGRST116 code and message,
with data null. Root reads that builder's multiple-row branch as source before
the grant. This is still a supplied response, not an SDK or database invocation.
The test helper adds an optional error parameter whose default keeps old fixture
responses unchanged. No earlier assertion or expected result is removed.

A SQL-comment harmless control survives. Four named faults fail their exact
baseline-joined oracle with AssertionError messages:

| Fault | Observed failure | Failed assertions |
| --- | --- | --- |
| Missing native count | Required scope and pre-branch count disappear. | 2 |
| Extra decision-kind predicate | Required exact reader scope changes. | 1 |
| Count moved after publication branches | Required scope location and early order fail. | 2 |
| Reader invalid status changed to absent | Supplied multirow refusal reports absent. | 1 |

The first three alter only private SQL text. The fourth uses a private Vite
transform of the actual unchanged reader. Exact input copies/hashes, applied
transform, full names, messages, stage streams, intents, PIDs and terminal records
are retained. Every selected name agrees with baseline and no suite-runtime
message is accepted as a fault result.

Scoped types, focused test lint and nested direction each exit zero. Direction
retains its existing expired-review, age and version reminders. No date or registry
changes. Finally all ten source/config/test pins and eight preservation pins
match; the transform clears and SQL fixture restores. A read-only exact compiler
lock inventory is empty after terminal completion. No retry or successor runs.

## Custody and blind categories remain separate

The new source parent is `eb4e2a4328880d2650251347a8629a6ad3c0ab27`.
The only executable changes are six migration lines and the focused test additions.
Both independent reports and all prior failure dispositions remain historical
authority for their exact subjects. All 2,601 retained-validator proof entries
and all 3,119 original proof entries match bytes, lengths, modes and ownership.
Old evidence is referenced without copying its corpus or rebinding it to this
new application tree. The new manifest binds 2,530 own files at seal; later
local-commit metadata remains separate.

An initial ungranted fixture message was aligned with the installed builder's
exact text before the sole run. Its initial source pins/preparation manifest stay
preserved. The round-2 evidence display was truncated; its complete JSON is parsed
and its stage/stream fields retained in a separate inspection receipt. No runtime
failure, source retry or test relaxation is hidden by these source/metadata reads.

The SQL assertions inspect strings, scope and order. They do not execute a
one-row or two-row SQL state and can match dead text. The reader case exercises
the actual reader with a mocked query error; it does not establish real multirow
transport, schema visibility or privileges. Passing these checks supports the
selected source correction, not native behavior or a working published edition.

Native migration425/parser/application, persistence, transaction/lock races,
ordinary-caller RLS/ACL, identified build/navigation, desktop390px, console,
actual artifacts, human legal/adoption judgments and practitioner acceptance
remain open. The separate empty-root tool startup observes two CLI outputs only;
it does not inspect the archive or supply native publication proof. KI-025, M1,
scientific acceptance, full V1, hosted and release acceptance remain open.
