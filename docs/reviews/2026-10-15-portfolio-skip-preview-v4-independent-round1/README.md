# V4 operating packet requires three corrections before execution

Fresh independent round-one review, October 15, 2026. Verdict: **changes required**.
I find three P2 defects and no confirmed P1 defect in the reviewed scope. Do not
admit the current packet for operating execution on the strength of this review.

The subject is preparation commit
`df968613b36ea221c7ae510e5a0bb7bba046720a`, public directory
`docs/reviews/2026-10-15-portfolio-skip-preview-v4-preparation`, and private root
`/home/nathaniel/.local/state/openplan/project-portfolio-skip-preview-20261015-v4`.
The application stays at `49e3fa2004c1336ffa36c134a8f21bcc2d72d327`.
I independently match manifest SHA-256
`4392388032ad99ffe9fe83adfaa5571c9e23692151b6d6d12f294cc29dfca71a`
and operation-files SHA-256
`87f96cec8f07cb737c82ff93907619cc3e8aa9306efb0a578eed29f2ebbb7856`.

## R1, P2: imported preservation checks lose the user-bus environment

Locations in the preparation directory:

- `templates/app_binding_v1.py:342–350`, environment clearing and active check.
- `templates/app_binding_v1.py:125–127`, imported acquisition.
- `templates/helper.py:171–178`, `unchanged_inputs` calls preservation.
- `templates/helper.py:353–360`, preservation calls the old-web observer.
- `templates/helper.py:62–66` and `:372–374`, inherited subprocess environment.
- `templates/attest_start_v1.py:110–115`, second affected entrypoint.

The new observer calls `systemctl --user show` through `helper.run`, which
inherits `os.environ`. Application `main` and attestor `main` clear that
environment and retain neither `XDG_RUNTIME_DIR` nor `DBUS_SESSION_BUS_ADDRESS`.
Importing the helper does not invoke its `main`, whose line 463 adds XDG.
The application `command` helper supplies XDG explicitly, but this call bypasses it.

The exact chain is application `main` to `acquire` to
`helper.unchanged_inputs` to `preserve` to `protected_web` to `helper.run`.
Checkout, build and start also acquire through that path. Attestor `main` calls
`attest`, which calls `a.acquire` before inspecting the new web process.
Thus a healthy old preview cannot satisfy the imported check through the normal
entrypoint. In the literal recipe, the first affected stage is `active-check`,
after creation, restore, upgrade and helper startup have already occurred.

Reproduction: independent copies of these functions use a no-op subprocess spy.
The spy accepts a user-bus environment and rejects its absence. The unmodified
copied application and attestor entrypoints reach it with both variables absent
and exit 1. A harmless existing-XDG control reaches the accepted branch. An
in-memory application-main repair supplying fixed XDG reaches that same branch;
a deliberate sentinel then stops before any receipt or `/proc` access.

The parent separately supplies this actual read-only diagnostic, not rerun here:
`Failed to connect to user scope bus via local transport: $DBUS_SESSION_BUS_ADDRESS and $XDG_RUNTIME_DIR not defined`.
My controls establish propagation and composition independently. They do not
claim an independent live systemctl reproduction.

Recommended correction: give this trusted observer a fixed explicit user-bus
environment at its transport boundary, or consistently initialize all importing
entrypoints. Keep the clean npm environment and strict process checks. Add
entrypoint-composition controls that exercise the inherited subprocess boundary.
Do not weaken preservation or retry the partially allocated installation.

## R2, P2: the final stage omits the promised preservation readback

Locations: `templates/helper.py:276–285`, `templates/helper.py:465`, and
`PARENT_RECIPE.md:58–60` in the preparation directory.

The recipe requires preservation acquisition and a retained receipt after the
browser journey. Its named available stage, `verify-services`, checks the new
cluster identity, new target, upgrade receipt, helper configuration and health.
It calls neither `source_check` nor `unchanged_inputs`. It therefore omits old
packet bytes, old web identity, source fingerprint, old Storage, protected
helpers and both protected database snapshots. It returns helper receipts
without publishing a new preservation result. Earlier attestation precedes the
journey and cannot establish the required post-journey state.

Reproduction: copy the actual verifier and replace its I/O with no-op fixtures.
Set `source_check` to raise `source-drift` and `unchanged_inputs` to raise
`protected-drift`. The verifier succeeds and reaches neither oracle nor a write.
Both direct oracles fail with their intended reasons. A copied proposed
composition adding preservation fails with `protected-drift`. This is an
omission in the executable final path, not evidence of current protected damage.

Recommended correction: provide an explicit one-shot final observer that acquires
the frozen source and protected state, retains its result and records the new
helper verification. Invoke it literally after the journey. Compare protected
old installations, not the new database's expected browser writes, to their
original preservation boundaries. Update the recipe and controls together.

## R3, P2: initial upgrade readback accepts unconditional CHECKs

Locations: `templates/helper.py:409–422`, `STATUS.md` upgrade-readback claims,
and `verify_controls.py` upgrade-state fixtures in the preparation directory.

`upgraded` checks each constraint for the substring
`decision <> 'create'::text`. It does not compare an independently expected
definition or its complete allowed values. For both constraints, this definition
passes the actual consumer:

```sql
CHECK ((decision <> 'create'::text) OR true)
```

That expression permits every row, including invalid create classifications.
The initial upgrade receipt records the observed definitions. `upgrade_ready`
then compares future reads against that receipt. If the first observation is
wrong, equality to that observation does not establish the intended constraint.
Drift after a correctly captured receipt is a different boundary and is checked.

Reproduction: the real pure `upgraded` consumer accepts expected state with a
harmless note. It rejects `CHECK (true)` for the required-token reason, but
accepts both unconditional expressions above while all other fields remain
correct. The copied `upgrade_ready` consumer also accepts a matching first
receipt containing those expressions. An exact-comparison candidate accepts
the harmless specimen and rejects the weakened definition.

Recommended correction: bind complete independently established normalized
definitions for both CHECKs before initial receipt publication. Retain the
fresh-read equality check afterward. Include weakened definitions that retain
the required phrase, changed allowlists and a harmless observation note in the
controls. The fixed migration bytes remain correct on inspection; I found no
evidence that a real target currently has either weakened CHECK.

## Acquisition, restore and upgrade retain useful boundaries

The external pins match all 25 manifest files. All five assembled public runtime
templates equal their private counterparts, and all five diffs regenerate
exactly from the stated inherited inputs. Actual pure consumers accept private
file bindings, the new helper import, configured application/helper values and
the fixed retained dump. The dump matches 16,232,305 bytes and its fixed hash;
no recapture or fresh dump occurs. These checks prove present bytes, not future
transport behavior or hostile-host resistance.

The plan binds the new database, four helper names and `.11` endpoints. Private
configuration preserves the role URIs, successful percent encoding, new upstreams,
own CORS, existing optional-source values and disabled managed GTFS. I inspect
configuration through its pure consumer without printing credentials. The six
ACL statements target the new database; no role or global setting write appears.
The retained native-proof database stays outside the write commands.

Restore uses `createdb` and one-worker, single-transaction `pg_restore` against
the new target. Identity readbacks bind its OID, name and owner. The existing
419 row/history/sequence/property projections precede readiness. Storage copies
only into the new root. This compares selected logical projections; it is not a
full installation recovery proof or independent PostgreSQL execution.

Upgrade assembly binds exact migration SHA-256
`b129f80e37aa9be71069683acd42df3fb6fdb94078ed0458f20b6e9c5155a41b`,
the named original v2 body and the fixed 419 history digest. The SQL contains one
transaction, history lock, target check, other-session check, candidate SQL and
history insertion before commit. No SQL reaches a transport. The other-session
query is a point-in-time check, not a lock excluding all future connections.
R3 limits the claimed initial constraint readback.

## Names, ports, failure retention and inherited recipes

Name absence and bind probes do not reserve their resources. `createdb` and
`docker create --name` provide collision refusal at allocation; the packet does
not fall back to another database or helper. A later port collision can still
stop Docker publication or Next startup. The strict listener/process attestor
is needed to reject a competing server. No live race is exercised here.

Request directories and exclusive intent/receipt creation retain partial state
and block automatic mutator retries. Literal `set -eu` stops on a failed stage;
the parent script hashes the runner externally and uses the shared lock. It
checks that the supplied review commit exists, not that it approves execution.
The parent's full review and disposition remain necessary. This review supplies
no approval, and its commit must not be used as a success token.

Helper failures retain a failure record; application and attestor errors rely
on systemd output plus requests/intents. `helper.run` with no log discards native
stderr before raising. R1's bus failure will therefore be less informative than
the parent's separate raw diagnostic. Preserve private observer diagnostics
without exposing credentials when correcting that path.

The inherited app build/start functions, fresh-build inventory, read-only donor,
private caches, fixed inner wrapper, 12-character health SHA versus full process
SHA, host attestor and exact npm PATH derivation remain visible. Reusing their
ASTs does not prove compatibility with the new imported observer, as R1 shows.
Active-check and checkout still have an outer bwrap wrapper, while the new
protected-web observer requires host listener PID and `/proc` environment access.
Given the retained earlier namespace/PID failure, that composition also needs
explicit observer-context evidence after correction. This review does not run
bwrap or claim a second independently reproduced namespace defect. Keep strict
identity checks and the intended read-only confinement when resolving it.

## Independent controls and remaining limits

[The independent controls](review_controls.py) and [results](controls.json)
contain 23 observations: 16 survivors and seven intended refusals. Hazard
specimens that incorrectly survive are evidence for R2/R3, not acceptance.
Every proposed detector exercised here has a harmless survivor and an intended
broken behavior. Patches restore through context managers; environment restores
in `finally`. No packet or application implementation changes.

The private proof root is
`/home/nathaniel/.local/state/openplan/portfolio-skip-preview-v4-independent-round1-20261015-1eb9f303`.
[Execution records](execution.json) retain one failed harness trial and the
corrected control run. Both use the shared compiler flock, 512 MiB memory,
zero swap, 50 percent CPU, private HOME/cache and disabled Python bytecode.
The failed trial omitted an environment-fixture key and stopped with
`KeyError: 'rest'`; it supplies no pass. The final run exits zero with 21 MB
rounded peak and zero swap. Absent event counters are not inferred.

I read AGENTS, current shared coordination and the historical canonical log,
planner-writing, prove-it, Supabase and Postgres skills, full STATUS/recipe,
literal shell, five diffs, runtime templates, binding/configuration inputs and
control/failure records. This is an assigned bounded review, not selection of a
new product lane. I do not rerun product direction, the old large campaigns,
full QA, compiler or build. I use no nested delegation or browser.

All 36 pre-existing immediate private files remain hash-identical after controls;
the candidate remains absent and execution directory empty. Only this review
directory and the new private proof root receive writes. The assigned checkout
fast-forwards from a clean baseline to the supplied preparation commit before
review. Other worktrees and the sealed subject remain unchanged by this review.

The original 74 preparation observations remain bounded evidence, not blanket
acceptance. Their protected-web tests replace `run` and therefore bypass R1;
their CHECK fault removes the required phrase and misses R3. No control here
establishes actual source/protected database preservation, SQL parsing, restore,
transaction success, live ACLs, Storage preservation, service readiness, native
host/PID visibility, build success or corrected-import UI success. The earlier
native proof, catalog discrepancy, warning and compiler receipt stay attributed
to their supplied evidence; I do not rerun or independently accept them here.
Desktop/390px, console, artifacts, practitioner/public, native workbook,
scientific, recovery and production acceptance remain open as stated.

Commit this review locally only. No push, pull request, merge, release, hosted
operation, database transport or operating-stage execution occurs.
