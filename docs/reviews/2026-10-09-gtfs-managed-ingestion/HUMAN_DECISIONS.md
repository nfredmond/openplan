# Human review and request cancellation

October 10 candidate checkpoint. Manual routes read completed parser counts,
adopt an exact reviewed version and cancel a request before its version exists.
Candidate migrations 30 and 31 join unreleased migrations 28 and 29. The planner
panel remains unconnected. These files do not declare a delivered browser
journey, a main merge or a release.

## Behavior

Human commands retain installation, target, current session actor, command UUID
and exact intent in a private journal before dispatch. A lost reply remains
unconfirmed. A fresh process repeats the same SQL command. SQL rechecks current
permission even when a receipt already exists. A historical adoption receipt
does not reapply its earlier decision.

Review uses completed parser counts and the exact current predecessor. A new
adoption cannot use stale counts or a changed predecessor. A reduction greater
than 20 percent in routes or stops requires explicit human acceptance. This is
the existing feed replacement safeguard, not a service accuracy criterion.
Reading a review does not adopt the version. The worker does not adopt feeds.

An early cancellation has no version to close. Migration 31 reserves the
request UUID and serializes cancellation with admission's request lock. A
cancelled request cannot later create a version. Cancellation after admission
closes its unfinished version through the existing native command, including
its archive reconciliation requirements. Reservations survive feed deletion.
Ready or failed processing cannot be renamed cancelled. Existing cancellation
receipts retain their command identity and exact reason.

Submission recovery reads cancellation before mutable resolution or admission.
A validated private cancellation marker skips that request on later passes.
Unavailable cancellation lookup remains unconfirmed. Public progress keeps an
early cancellation separate from missing version status. Current members may
read; viewers cannot issue decisions. Routes refuse agent writes before private
command custody because agent approval and audit for these decisions are not
established.

Browser helpers retain request and decision identity before transmission. They
bind history to installation, workspace and actor, bound its size, verify the
storage write and preserve earlier unknown commands. A changed review requires
a new explicit command. Forgetting browser history cannot retract a server
decision. Wire guards keep missing, unavailable, queued, cancelled, completed
and current states distinct. These helpers are not connected to the panel yet.

## Evidence

- [Human command controls](human-command-controls.json): four positive runs and
  28 intended failures cover exact private command retention, replay, receipt
  scope, shrinkage disclosure and browser request retention. Concurrent command
  dispatch is refused by the private lock, rather than waiting in that lock.
- [Cancellation and manual route controls](request-cancellation-controls.json):
  three positive runs and 39 intended failures cover request journals, current
  session authority, bounded valid JSON bodies, cancelled history and distinct
  public status. The final mutations increase body limits to an actual larger
  bound and deliberately bypass session identity, rather than relying on a
  missing configuration value or a null-actor exception.
- [Browser decision controls](client-decision-controls.json) and
  [progress controls](progress-controls.json): each has baseline, harmless and
  restored passes. Fourteen and 17 intended failures respectively protect exact
  decisions, preserved history, storage bounds and matching presentation facts.
- [Native human review SQL](human-review-sql.json): six positive runs and 12
  intended failures cover current roles, completed counts, predecessor review,
  material acceptance, receipt replay and service-only privileges. Redundant
  guards have harmless removals; broken controls remove the complete protected
  behavior. The privilege fixture reads a fresh current basis so stale review
  cannot mask an unauthorized execution grant.
- [Native request cancellation SQL](request-cancellation-sql.json): three
  positive runs and 11 intended failures cover early reservation, late admission,
  exact receipts, current roles, known version closure, feed deletion and private
  admission custody. The fixture retains a second owner during permission
  revocation and reuses a scoped feed to respect the actual source URL identity.
- [Native transaction order](request-cancellation-order.json): baseline,
  harmless and restored variants pass both orders. `pg_blocking_pids` observes
  the expected transaction before commit. Removing cancellation's request lock
  fails both orders. Cancellation first leaves zero submissions and versions;
  admission first produces one version closed by cancellation.
- [Native HTTP/process recovery](human-native.json): four committed-reply
  interruptions recover exact early cancellation, unfinished cancellation,
  ordinary adoption and accepted material shrinkage. Current viewer, anon and
  authenticated roles cannot write or impersonate the service actor. A revoked
  original actor cannot replay a decision through the production helper. These
  completed-count fixtures are synthetic and do not prove physical archives.
- [Native submission and cancellation recovery](submission-cancel-native.json):
  six admission interruptions still recover saved source/version identity. Four
  ZIP cases publish 95 derived route rows, 717 derived stop rows and one
  completion without adoption. A seventh case cancels after exact private ZIP
  retention but before admission. It resolves nothing, uploads nothing, creates
  no version and skips its cancelled history on the following pass. Owned
  synthetic Storage objects are removed after observations; databases remain.
- [Write-role inventory](human-role-inventory.json): baseline, harmless and
  restored runs pass. Six intended failures reject an unrecognized gate, a
  membership-only helper, read-mode calls and ignored authorization refusals.
  The first broad regression found that this shared helper was not yet recognized.
  The correction recognizes it and checks refusal before dispatch, without an
  exemption.
- [Current submission polling controls](human-submission-poll-controls.json):
  five positive runs and 23 intended failures rerun the existing recovery controls
  against cancellation-aware source. Actor and workspace mutations cover both
  lookup and admission scope.
- [CLI upgrade](human-upgrade.json): the installed CLI upgrades a retained
  393-migration predecessor through the identified current main with 399
  migrations, then the candidate with 403. Populated GTFS records remain equal,
  existing imports are not enrolled and repeat application changes nothing.
  Baseline, harmless and restored preservation checks pass; three deliberate
  changes to existing records fail. This covers all four candidate migrations.

[Final regression](human-tests.json) passes 65 test files, with 1,571 tests
passing, 17 live-database cases skipped and none failing. Scoped TypeScript and
changed-file lint pass. The serial regression peaks at 437.3 MiB under a 1 GiB
service limit. Current enrollment controls also retain four positive runs and
40 intended failures. Earlier tool attempts used an unsupported Vitest flag,
an incorrect blocking-lock expectation and a transaction-prefix check that did
not allow migration comments. Corrected runs use the installed interfaces and
preserve all retained proof databases. Mutation runners restore source in
`finally` without destructive resets.

## Remaining boundaries

Planner progress, retry, command recovery and adoption are not connected to the
interface. An identified-build T3 journey from real navigation still requires
desktop, 390px, console and artifact evidence, including service coverage and
project geography. The new T3 tab is available but has not supplied acceptance.

Native commands and representative CLI upgrades do not prove a complete
database, Storage and private-file restore or a new installation from an empty
platform. Missing retained local ZIP recovery still refuses admission. Public
DNS/TLS, largest-feed capacity, installed worker service operation, application
session HTTP authorization, full GitHub CI, practicing-planner acceptance and
release readiness remain separate checks. No scientific validation is claimed.
