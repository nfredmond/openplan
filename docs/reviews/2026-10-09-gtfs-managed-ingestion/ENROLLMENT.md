# Retained submission polling and managed API enrollment

October 10 candidate checkpoint. URL, catalog, raw ZIP and stored-source refresh
routes now have an installation opt-in path. Request IDs, exact intent and local
bytes survive an unavailable reply. The worker recovers retained submissions
before discovering processing candidates. Migration 29 adds a service-only
request-status lookup. Migrations 28 and 29 remain unreleased.

The planner panel is not connected yet. Do not enable this candidate path for
planner use until progress, cancellation, retry, completion review and adoption
are connected and assessed. This checkpoint is an API/worker implementation,
not a delivered browser journey or release.

## Behavior

Routes validate bounded inputs and current session membership and writer role
before retaining an import. They require the client to retain a request UUID.
Catalog/URL resolution occurs inside private admission, so replay uses its saved
source and feed choice instead of resolving mutable metadata again. Raw ZIP
stream bounds and MIME checks remain. Uploaded bytes keep their private exact
hash and scope. A refresh has no caller URL or catalog override.

The request-status route binds its actor to the session. Workspace viewers may
read progress. An unknown committed request returns null with an unconfirmed
explanation, while an unavailable lookup returns 503. Neither means no transit
service. Recovery requires the retained original actor, exact request header,
workspace, target and installation. An unavailable record remains unconfirmed.

Submission polling uses a separate private installation lock, bounded inventory
and a rotating cursor. Current original-actor permission precedes resolution or
admission replay. A private exact handoff marker skips already enrolled history.
Handoff remains separate from processing completion and adoption. Unavailable
inventory has a separate flag, rather than a fabricated zero or a fake job count.
Previously enrolled jobs remain eligible for a queue pass during that condition.

Managed agent submissions and refresh are explicitly refused before dispatch.
The asynchronous approval/audit journey is not established. Manual refresh
cannot approve material shrinkage before the resulting version is completed and
reviewed. The legacy action path remains behind the existing synchronous mode.

## Evidence

- [Enrollment controls](enrollment-controls.json): four positive runs and 40
  intended assertion failures. Baseline, harmless comment, harmless removal of
  the SDK-redundant early membership check, and restored source pass.
- [Submission polling controls](submission-poll-controls.json): five positive
  runs and 23 intended failures. Removing redundant relative-path and symlink
  checks survives; bypassing their complete protected behavior fails. Source is
  restored in `finally` in every mutation runner.
- [Integrated queue controls](submission-queue-controls.json): three positive
  runs and 35 intended failures, including the new recovery hook, pending count
  bounds and unavailable-inventory distinction.
- [Native request status](submission-status-native.json): three positive runs
  and five intended failures cover current membership, cross-workspace requests,
  missing requests, private fields and service-only execution. Actual PostgreSQL
  and PostgREST exercise owner, viewer, outsider, anon and authenticated roles.
- [Native retained submission polling](submission-poll-native.json): six real
  process interruption cases recover through the production recovery pass.
  Recovery performs zero mutable resolutions. ZIP cases use no client resupply
  and publish 95 route rows, 717 stop rows and one completion without adoption.
  Each handed-off request is skipped on the next pass. SQL refuses admission
  replay after the original actor becomes a viewer. URL/catalog cases preserve
  source/version identity and remain queued. Owned synthetic Storage objects are
  removed after observations; databases remain retained.
- [Regression](enrollment-tests.json) includes the GTFS/transit files plus body
  limit and workspace role inventories. Its actual counts remain in the linked
  report. One worker takes 86.0 seconds and peaks at 442.8 MiB within 1 GiB.
  Scoped TypeScript passes in 6.7 seconds at 414.6 MiB. Changed-file lint passes.

The first regression file pattern omitted eight tests whose names end with GTFS
or transit terms. The corrected broad pattern includes all 59 relevant files,
with 1,403 passing tests and 17 live-database skips.

Earlier control attempts exposed redundant local guards, an empty symlink
fixture and an error-wording assertion. The final checks use a valid private
symlink target and test refusal behavior. A route mock initially omitted typed
status fields; the final mock matches the response contract, and controls run
again against its final source. The membership SDK signal is set before
`maybeSingle` to match the installed client's typed builder.

## Remaining boundaries

An uncommitted request has no version for the existing cancellation command.
A durable request cancellation reservation must prevent late admission before
planner enrollment is enabled. Human review/adoption, browser-retained request
identity and the corresponding draft migration 30 are separate unfinished work.

Controlled route tests assert real query projections and scope but mock
admission; they do not establish route RLS or rendered usability. Native tests
use a retained main-derived schema plus candidate DDL, not a full official CLI
install/upgrade or a complete Storage/private-file restore. They do not prove
public DNS/TLS, largest-feed capacity, power-loss durability, practicing-planner
acceptance, independent CLI service installation, desktop/390px T3 journeys,
GitHub CI or release readiness. A missing retained local ZIP still refuses
admission recovery. No demo, main merge or release occurs here.
