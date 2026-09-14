# Publication command integration, September 13, 2026

This continues pushed 10fe1d8f in the owned translation checkout. The commands
POST now accepts publish_generated as well as the existing manual operations.
Pending request recovery and editor/producer integration remain unfinished.
This is an engineering checkpoint, not a released or activated workflow.

## Behavior

The endpoint derives campaign, workspace and publisher from authenticated access.
Publication sends the exact references and original versions to the existing
write transaction once. It then reads immutable generation evidence through the
same caller's RPC client and verifies the receipt's words, model, original
actor, publishing actor, references and revisions. It also checks the saved
source checksum against the original source using the existing trimmed-source
compatibility convention. No service client, current key selection, source
refresh or provider call occurs in this path.

An explicit SQL refusal keeps its existing conflict, forbidden, invalid or
unavailable result. Failure after the write, including lost access during the
evidence read, remains unavailable because publication may already have
committed. The client must retain and retry the same request. A retry does not
rebase the original generation onto a newer source or saved version.

Distinct generation requests are read once per command, at most eight at a time.
A shared 20-second deadline covers the command and its evidence reads. Individual
generation reads retain their existing 10-second limit and now also accept a
caller's shorter remaining deadline. The helper checks expiry before later
batches and before confirming the receipt. This bounds HTTP work without
introducing another model job or an automatic write retry.

All commands now require the existing same-origin browser boundary and refuse
any of the three Planner Agent execution markers, including empty headers.
There is no registered translation write action yet. This is an executable
refusal, not a new agent-authority claim. Manual route test requests now carry
the same Origin header that a browser POST supplies.

## Evidence and limits

The new native command suite has 30 tests. It uses the real POST, publication
helper, output encoder, generation decoder and receipt checker with a mocked
authenticated RPC transport. Cases cover exact arguments and authorship,
response loss and replay, evidence-read failures after a successful write,
transaction refusals, altered output/source/checksums, caller-supplied fields,
origin and agent markers, repeated reads, nine-request/eighteen-field batching,
and shared deadline propagation. It does not prove live SQL authorization,
concurrent publications, browser storage or actual provider execution.

The publication-command fault report has 25 cases: baseline and three harmless
controls survive; 21 targeted faults fail the named assertions. The source and
test hashes and private logs are retained in publication-command-controls.json.
The existing manual command/storage fault suite is rerun separately because the
POST is shared. Final combined checks are recorded below after completion.

A first TypeScript check found a test header object inferred with optional
undefined values. The fixture now explicitly uses Record<string, string>.
The first deadline fixture reused one signal for both timeouts and could have
missed omitted parent cancellation. It was corrected to use independent signals
before the final fault run. The shared-deadline removal now fails that test.

No migration or permission was changed. A read-only check of the named isolated
application stack supabase_db_openplan-restore-target-2026091050 confirmed max
migration 20261014000012, authenticated command execution false, and no retained
publication helper installed. Original checkout, demo and reminder constraint
remain untouched. No browser acceptance, full QA, shuffled suite, whole-stack
RLS, worker, upgrade or restore rerun is claimed by this checkpoint.

## Continue

Integrate publication into PendingTranslation before exposing it in the editor.
Persist the exact viewed generation output and original source/saved baseline;
confirm replies with readTranslationPublicationResult. Keep the same request ID
through lost acknowledgements, storage deletion and unreadable-record recovery.
Do not turn generated words into an operator draft or silently rebase a stale
output when reopening a conflict. Keep generation and publication actors distinct.

Then replace the staff editor's legacy generation/publication producers with
queue/catalog/publish commands. Account for public producer privacy and allowance
before enabling the protected write command. Use the identified local browser
build for desktop and 390px navigation, keyboard, console and interrupted-retry
acceptance. Complete applicable release gates and inspect final main CI before
tagging. No PR or human-review release gate is required.

## Final checkpoint checks

The combined 11 native/component suites passed 289 tests. TypeScript no-emit,
focused ESLint and git diff --check completed successfully. These are focused
checks, not the full QA or shuffled release suites. The manual write boundary
report contains 77 expected cases: baseline and four harmless controls survive,
and 72 targeted faults fail. Publication source hashes match the final fault
baseline after restoration. All verification processes are terminal.

Private logs live under
/home/nathaniel/.local/state/openplan/response-write-probe-20260913:
publication-command-combined-final.log, publication-command-types-final.log,
publication-command-lint-final.log, publication-command-controls-final.log and
write-boundaries-publication-command.log. No browser journey was run this turn.
