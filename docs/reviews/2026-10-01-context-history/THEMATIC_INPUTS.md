# Authenticated thematic input custody

October 1, 2026. M9b continuation after `d72c1109`. That preceding checkpoint's
application CI `36965343713` and native isolation `36965343670` both pass. This
record concerns subsequent request and input-choice work. Full v1 remains open.

Thematic work now has its own immutable request binding. The application derives
the binding from authenticated segment history and original source reconstruction.
It retains the current staff author, exact parent selection, segment-result
manifest, context graph and frame limit. Native creation checks current staff
membership and source/provider scope. Exact retries preserve original bytes and
remain recoverable after cancellation or provider revocation. Current staff can
inspect a departed requester's record. Neither older executor accepts this new
stage, and neither dependent stage can become a segment parent for the other.

Each contribution can retain an immutable choice of historical context. The
application replays its original responses before deriving the chosen history,
capture and result hashes. Native custody binds the context to the same source,
parent selection and graph, verifies the target against selected items or survey
answers, and rejects future selections. It permits exact acknowledgement recovery
after cancellation but refuses another input choice. Current staff access remains
separate from the original author's permission to write.

Choice reads verify campaign and workspace even when no choice exists. New rows
stay private, and direct table reads and writes remain unavailable to authenticated
users. The service role can inspect private storage but cannot impersonate a staff
requester through these authenticated commands. This checkpoint adds no route,
browser control, provider call or approval operation.

## Evidence and defects found

Additive migrations `20261015000003` and `20261015000004` are installed only on
the owned `openplan-restore-target-2026091050` stack, API29821/DB29822. No reset or
demo migration occurred. The first choice-reader draft omitted scope fields from
its receipt. The reader now includes native campaign/workspace fields and checks
the thematic request before returning an absent choice. The installed function
was replaced to match the revised, unreleased migration, with no table change.

- Installed native request and old context compatibility checks pass 61 tests.
  Thematic choice custody adds 30 passing native tests. Both new suites include
  harmless controls and targeted function/policy/immutability faults. Choice
  scope tests deliberately seed inconsistent historical rows to isolate joined
  identity guards. Those probes do not claim that ordinary callers can insert
  such rows. Every SQL fixture and fault rolls back.
- The first request fixture tried to reactivate a revoked provider connection.
  The existing immutable-connection rule refused it. Nesting checks now run
  before revocation. No production rule changed to accommodate the fixture.
- Eight request-service tests pass. Their 20 targeted faults fail with assertion
  errors, while a harmless comment change survives. These tests mock historical
  transport; native original-response reconstruction has separate evidence.
- Eleven choice-service tests pass with real reconstruction and replay, mocking
  only transport. The first parent-mismatch fixture changed the inner binding
  but not its outer parent ID, so it failed earlier than intended. Both identities
  now change together, isolating comparison with the selected context.
- Authenticated local HTTP request custody passes in 8.13 seconds after parent
  cancellation and requester departure. The complete context CLI recovery and
  thematic-choice case passes in 178.64 seconds. It checks exact original hashes,
  cancellation retry, subsequent revocation and no additional model call. The
  provider endpoint is synthetic loopback; PostgreSQL, PostgREST and the worker
  are real. This does not establish semantic quality or real-provider billing.

The 24 targeted choice-service faults also fail with assertion errors, while
the harmless comment control survives. The native HTTP recovery case fails on
its original-history hash assertion when the application deliberately supplies
64 zeroes. The test reports an assertion mismatch, not a timeout or provider
failure. Source SHA-256 returns to the recorded baseline after both fault runs.
[Mutation results](thematic-input-mutations.json) preserve each probe and its
failure. Native SQL faults roll back within their own tests. These checks do not
prove semantic quality, browser usability, populated database upgrades or a
worker input seal.

The first combined application run found three checkpoint omissions: six native
column reads lacked their accounting entries, the schema guard still expected
the pre-migration count, and Unreleased did not name the two migrations. That
run reports 16,795 passing tests, three failures and 1,234 skipped tests. The
checks stopped before connector tests, audit and build. Their assertions remain
unchanged. The revised column entries name the actual native readers or
constraints. Installed PostgreSQL confirms 273 application tables with RLS and
14 views, with zero policies on either new private table. Unreleased now names
both migrations and the unfinished workflow.

The 59 focused service, schema-accounting and release-ordering tests pass after
those corrections. A harmless SQL comment preserves both changed guards. An
unaccounted synthetic column fails the unread-column check, and removing the new
choice table's RLS statement fails the exact RLS count. The migration returns to
its original hash afterward. These static guards cannot prove native permission
behavior; the installed native cases above cover that separate boundary.

The corrected full QA gate passes against `49deefd0` plus this checkpoint:
16,798 application tests pass and 1,234 are skipped; 382 connector tests pass
and four are skipped. Lint, the configured dead-code command, dependency audit
with zero reported vulnerabilities, TypeScript and the production build pass.
The default gate skips native database writes; the 91 installed native tests and
two authenticated HTTP cases above supply the separate scoped evidence.

Main then advanced to UI commit `e5e1282c`. This worktree fast-forwarded without
conflicts. All 79 affected UI, schema and thematic-service tests pass, as do lint
on the incoming TypeScript files and the combined production build, including
TypeScript. The whole application suite was not repeated after that UI-only join;
its full run above uses the earlier baseline. This checkpoint's exact-commit CI
is pending. Raw local logs remain outside Git under
`~/.local/state/openplan/approval-resume-2026-09-27/t3-thematic-*`.

## Remaining connected work

Native rows record requested historical inputs. A caller-supplied digest is not
a signature, and the SQL command does not reconstruct model responses. Before
sealing a thematic input plan, the worker must reconstruct every chosen history,
compare the pinned hashes and prove complete membership against the original
source. It needs explicit native authority tied to the new thematic requester;
the current authenticated reader cannot stand in for a service worker.

Continue durable preparation, a verified whole-source seal, bounded task frames,
the versioned thematic recipe and fresh resource authorization. Preserve complete
original records and historical definitions alongside machine notes, including
conflicting input and unresolved uncertainty. Then retain original proposals and
let staff explicitly import one into a new reasoned review revision with an
exact expected parent. Existing approvals remain attached to their original
revision. Analysis navigation, desktop/390px evidence and human usefulness remain
unfinished. The roadmap and complete v1 contract remain the destination.
