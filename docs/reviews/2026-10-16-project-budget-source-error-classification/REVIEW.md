# Budget source failures retain their meaning

This candidate corrects classification in the complete project-budget loader.
An internal missing-column error in stated budget, spend or invoicing stays
unreadable. It retains the original message and any supplied database code.
Valid delivery records and other readable sources remain available. Empty
failure rows do not establish recorded zero.

The assigned checkout starts clean at `05dd3e8da4a4572437f06e771b0a2477873e681f`.
An ancestry check precedes its local fast-forward to exact combined checkpoint
`93c5a1efc514d53db953bdba5a8322dcf844e14b`, application tree
`e04a8509926c27065e77537f1816071811bb5b4d`. No root checkout advances. The
base loader SHA-256 is
`30c5133a27cfb723c9ea1fdbe45cf6a19a5fb9c156d0804565105ba14b9b63ab`,
matching the preparation worker's actual production-loader probe.

## Classification has an explicit boundary

SQL19, `20261017000019_project_budget_complete_inputs.sql`, returns SQLSTATE
and SQLERRM per source. It does not return catalog-established error origin.
Its stated-budget projection is `p.budget_amount`; spend uses `s`, and invoice
queries use `i`, `l` and `p`. A helper or policy can reuse those aliases.
SQLERRM alone cannot prove which query caused an alias error.

The loader recognizes exact unqualified/public source relation messages for
`projects`, `project_spend_entries`, `client_invoices` and
`client_invoice_line_items`, each within its own source. A supplied code must
be `42P01`. Legacy exact-source fixtures without a code remain compatible.
The pre-existing deliverable classifier remains unchanged.

The established stated-budget compatibility path accepts explicitly qualified
`projects.budget_amount` and `public.projects.budget_amount`, with supported
column quoting. Its supplied PostgreSQL code must be `42703`. The existing
`readPendingSchemaMissingColumn` utility also recognizes the exact
PostgREST column/cache form naming `projects` and `budget_amount`; its supplied
code must be `PGRST204`. Legacy exact forms without codes remain compatible.
These cache forms are transport compatibility tests, not SQL19 native output.
No other source column is allowlisted.

Alias `p`, unqualified columns, other relations/fields/schemas, unknown cache
messages and conflicting codes remain failures. In particular, `42883`,
`42501` and `57014` do not become pending because their text resembles an
absent column or table. The code field remains absent when none was supplied.

A genuinely absent stated-budget column may therefore remain unreadable when
PostgreSQL reports `column p.budget_amount does not exist`. Complete native
pending-column compatibility is unproved. A future narrow SQL extension could
establish actual source-column absence from the catalog and return an explicit
flag. That extension requires separate ownership and native proof. This
candidate changes no SQL and makes no inferred origin claim.

## Scope preserves the combined candidate

The V1 contract, sole roadmap M11, CORE-PM-01 and known issues
KL-2026-09-04-023/025/027 continue to govern the larger financial outcome.
This bounded classification correction does not complete that outcome.
It preserves exact-money arithmetic, uncapped snapshot retrieval, separate
cost/billing meanings, stated-source isolation, optional delivery handling and
edit prefills. It adds no fallback reads, limits, security bypass or service.

Ownership covers the loader, one new focused test file and this new review
directory. The root grants a narrow extension for code-only expected-object
adjustments in related existing budget tests. The changes are:

- `project-budget-stated-budget-isolation.test.ts`: retain the permission
  assertion and add its original `42501` code.
- `project-budget-complete-inputs-corrections.test.ts`: retain the three
  deliverable failure message assertions and add their existing input codes.

Private receipts, original probe copies, source pins, logs and mutation records
live under
`/home/nathaniel/.local/state/openplan/project-budget-source-error-classification-20261016`.
The preparation trial01 failure remains a harness-reader failure. Its later
trial02 terminal success establishes synthetic diagnostic/control completion,
not a source fix, native failure reachability or financial acceptance.

## Verification remains bounded

The root-authorized checks01 unit stops before tests because the harness passes
an unsupported Vitest 4.1.11 `--minWorkers` option. The retained raw error is
`CACError: Unknown option --minWorkers`. No test, fault or compiler result comes
from that trial. Invocation `de3c612280004e5a80d93883df96fd20` ends with status 1
after 376 ms. The resource receipt records peak 28,319,744 bytes, zero memory
events, 1 GiB maximum, zero swap, 50 percent CPU and 48 tasks. The exact private
loader bytes restore in `finally`; the original checkout source remains
unchanged. The lock releases at terminal. `trial01/SEALS.json` preserves the
failed harness, configuration, raw log and receipts. No automatic retry runs.

The separately authorized checks02 trial executes all four focused files.
Baseline and harmless annotation each pass 128 cases. Its first fault runs
the 11 new cases and produces the intended internal-column failure, expected
false and actual true. The reader nevertheless stops because Vitest quotes
the parameterized suite name and the expected full name omitted those quotes.
This is a harness-reader failure, not a completed falsification campaign.
Trial02 ends with status 1 after 9.097 seconds, peak 163,373,056 bytes and zero
memory events. Its private loader restores exactly; no types, lint or direction
check runs. `trial02/SEALS.json` retains raw JSON and the failure. The next
proposed reader correction adds exact suite-name quotes and new output paths;
it changes no source or test assertion.

The separately authorized checks03 unit completes with terminal status 0. All
16 expected fault names match unique passed baseline assertions before any
dependency command. Baseline, harmless annotation and exact-restored runs each
pass 128 cases across the same four loader files, including the 11 new cases.
Scoped TypeScript, lint of the loader/four test files and product direction each
exit 0. This is a scoped check, not a full application compile or suite.
The direction check retains its review-age and release-version reminders.

The unit runs for 50.420 seconds. Its receipt records peak 347,152,384 bytes,
zero memory events, 1 GiB maximum, zero swap, 50 percent CPU and 48 tasks.
The kernel mounts the host/old source read-only, a private exact-byte loader
file for faults, and the read-only dependency donor at the final app mount
before the first dependency command. The network namespace is unshared;
environment/home/cache/temp are private. One nonblocking shared lock encloses
the finite unit. Vitest uses one worker. Python runs with `-B`. Terminal
completion releases the lock. No later dependency or compiler command runs.

The harmless annotation survives. Every fault below produces an exact-named
`AssertionError`; setup failures do not count. `finally` restores the private
loader to SHA-256
`c763dfe4041b9f6390f93b2329312a539a2d13796a74719d84f9630413bf9743`.
The actual checkout loader has the same bytes and remains unchanged throughout
falsification. [CHECKS.json](CHECKS.json) records each fault and its actual first
failure line. Private raw JSON retains the full failures and named tests.

| Fault | Assertion that rejects it |
|---|---|
| Mark any stated/spend/invoice error pending, three faults | Each source's original-failure case |
| Remove each source's pending output, three faults | Each source's exact-absence case |
| Erase deliveries when each source fails, three faults | Each source's independent-readable-data case |
| Drop source SQLSTATE | New custody assertions and both existing code-only expectation updates |
| Drop outer RPC SQLSTATE | Outer RPC custody case |
| Substitute zero for missing stated budget | Stated/non-entered/recorded-zero case |
| Ignore relation SQLSTATE | Spend source's conflicting-code case |
| Ignore column SQLSTATE | Stated source's conflicting-code case |
| Accept another missing projects column | Stated source's field allowlist case |
| Accept an unqualified column | Stated source's qualification case |

The changed existing expectations retain every prior assertion. The drop-code
fault also fails the existing stated-budget permission case and all three
existing deliverable dependency cases. The harmless run passes them. No test
assertion changes follow the final checks. Only reports and seals change.

The new tests use synthetic envelopes passed to the actual loader. They check
each source's internal failures, exact pending controls, code/text conflicts,
original code/message custody, retained delivery records, other-source
independence, stated amount precedence, not-entered and recorded-zero states.
The mocked transport asserts the exact RPC name and project argument. No table
query or SQL projection is mocked as though PostgreSQL executed it.

The blind category includes native SQL error reachability and origin, catalog
state, RLS, cancellation behavior, HTTP, browser navigation, artifacts,
practitioner usefulness and scientific acceptance. Fresh independent review of
final bytes belongs to the root before joining or native acceptance. No DB,
socket, Docker, HTTP, account, browser, service, build, full suite, dependency
installation, hosted operation, push, PR, main or release action runs here.
