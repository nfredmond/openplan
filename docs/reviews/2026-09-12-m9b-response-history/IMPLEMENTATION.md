# Response-history persistence foundation

v0.55.2 is published at 3455207b. This is subsequent unreleased M9b work.
Direction check passed with historical reminders. No new module, service, paid
operation, reminder constraint or scientific claim is introduced.

20261014000001_engagement_response_history.sql adds a private, immutable source
history table with response/campaign identity, ordered revision, actor, capture
time, event and generated snapshot checksum. Existing rows get explicitly labelled
legacy baselines with no invented actor or claim to recover earlier overwritten
text. Triggers capture creation, correction, publication/unpublication and removal.
Timestamp-only writes do not create a new content revision. Campaign/response
identity changes are refused. Removed response identities cannot be reused.

There is deliberately no foreign key from a history row to the current response:
removing the current record retains the history. The campaign relationship retains
custody. Staff SELECT uses campaign/workspace membership; viewers and outsiders
cannot read private old copies. Ordinary users cannot write history, and the
immutable trigger also refuses privileged UPDATE/DELETE. Public response loaders
and reports still read the current response table, whose columns are unchanged.
An unpublished event records a status transition; it does not establish a deliberate
human decision or imply that a human supplied a review reason.

## Evidence and corrections

Before application, history-probe.sql exercised the candidate migration inside
rolled-back transactions on openplan-restore-target-2026091050. It covered truthful
legacy copies, original actor/content, ordered changes, unchanged-write control,
checksums, scope identity, retained removal, refusal of identity reuse, immutable
history, actual outsider/viewer role denial and anonymous privileges. It also
changed an approved source contribution through the existing review guard: the
response still became private and both its old published copy and withdrawal
were retained. These are SQL fixtures, not browser acceptance.

The mutation harness retained two survivors and nine targeted failures. A harmless
comment survived. Removing one membership predicate also survived because the
joined campaign's own RLS still protected it; the initial assumption that this
would leak was wrong. A permissive history policy failed the outsider
probe. Other targeted changes failed baseline capture, update/removal retention,
immutability, viewer privacy, campaign identity, source-trigger capture and checksum
checks. The original failed expectation is retained in history-mutations-initial.json.
The source bytes were restored, and the table was confirmed absent after those
transactional probes.

The offline inventory initially rejected the intentional new table/policy counts.
A real transactional catalog comparison confirmed +1 table, policy, permissive
policy and RLS-enabled table. Expectations now match 753 policies and 240 app
tables. The permanent live inventory adds a history fixture through the actual
response-insert trigger and reads its explicit campaign/response/revision fields.
Offline migration/inventory checks passed 40 tests with 20 live tests skipped;
separate live inventory, schema drift and policy checks passed all 37 tests.
TypeScript and changed-file ESLint passed. Full application QA has not yet run
for this new history foundation.

The live inventory mutation survived a harmless comment and failed a deliberately
invalid history projection at the service/member positive controls. An initial
matcher expected the full column name, but Vitest abbreviated it. The corrected
matcher requires the named history member-read check and qualified column-error
prefix; a fresh harmless/failure pair matched. Source was restored. These checks
prove that failed queries cannot masquerade as successful permission denial.

All 319 prior migration files matched the isolated stack before copying only the
new file. The CLI applied it with exit 0; that stack now has 320 migrations ending
20261014000001. The earlier transactional migration harness intentionally requires
an unapplied table and must not be replayed unchanged now. Do not reset/drop the
history to make it replayable. New mutations should restore applied definitions
or use a separately identified disposable stack. No browser or app server is live
from this work. Historical test fixtures remain retained under existing custody
rules and the RLS suite revokes its fixture memberships.

## Remaining implementation

This is persistence, not completed response administration. The staff history UI,
required correction reasons, exact version checks, conflict recovery, durable
identical-request replay, changed-payload retry denial and publication side-effect
receipts remain to implement. Preserve the automatic source-review withdrawal;
it cannot require an invented human response-review reason. Review/translation
versions and source-to-project-decision links still need explicit custody. The
current source snapshot does not record every translated word a resident saw.

Before claiming a coherent release, exercise concurrent writers, interruption,
legacy/removal navigation, public/private readers, translations and frozen exports
through the complete workflow; run full QA, shuffle, full isolated RLS, upgrade
and exact final CI. New history reads must avoid the API row cap and preserve
error/empty distinctions. Inspect real desktop/390px keyboard journeys from
navigation. NEXT.md retains the existing producers, related RTP/land-use reader
gaps and the full remaining product scope. No human review gates block engineering.

After applying history and finishing live mutations, the actual HTTP response
loader again returned all 1005 records with the original browser checksum.
post-history-application-custody.json records that fresh comparison.
