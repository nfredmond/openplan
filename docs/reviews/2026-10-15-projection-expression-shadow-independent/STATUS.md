# Independent review closes the named-expression P2

The P2 from independent review `2a33a9829` is closed by
`9368f0804bad2c6d0569d53331bd8fbe1ce08c38`. No new finding is established
within this bounded review. The correction preserves the existing production
census and guard boundaries. This disposition covers the correction, not the
integrated candidate, full QA or release acceptance.

## Source and ownership

The assigned clean tree is
`/home/nathaniel/.t3/worktrees/openplan/t3-bc779056`, on
`t3/review-projection-expression-shadow-fix`. It fast-forwards locally from
`05dd3e8da4a4572437f06e771b0a2477873e681f` to exact reviewed source `9368f0804`.
Its exact parent is `06a108010ab39aa42eed4c2bcda3e1371b8aa813`. No fetch runs.
Ownership covers this review directory and private probes. Application and
repository test sources receive no review edits.

The current AGENTS instructions, planner-writing and prove-it skills guide the
review. The actual nested `openplan/` direction check exits zero. Its registry
and matrix age, review/package version and intervening-change reminders remain.
The product records are not redated or reassessed by this correction review.

The original combined guard-fix report, prior independent report and evidence,
and correction report and evidence are read. All 14 source bindings from the
prior independent evidence match exact `06a`. Among those files, only the
scanner and its reference guard test differ at `9368`. The original reports,
copy fixes, journal fixture, runtime application code, package manifest and
lockfile remain unchanged from the reviewed base.

## The correction adds refusals without adding known projections

The scanner diff adds `ts.isFunctionExpression(node)` and
`ts.isClassExpression(node)` to the existing name-collection condition at
`openplan/src/test/supabase-call-sites.ts:613`. Removing precisely those two
terms reproduces the base scanner byte-for-byte. No lookup, module resolution,
source-root traversal, range, select record or schema logic changes.

Both syntax kinds contribute a name only when `node.name` exists. The resulting
set can grow; it cannot lose a name. Its use in imported-literal fallback can
therefore turn a known import into unknown, but cannot introduce a newly known
projection. The existing same-file declaration path remains unchanged.

Independent TypeScript symbol checks bind the function and class fixture
arguments to `FunctionExpression` and `ClassExpression`, respectively. They do
not bind to `ImportSpecifier`. Both base projections incorrectly resolve to
`"id, jurisdiction_context"`; both corrected projections remain null. This
closes a guard defect. It does not establish a production query failure.

The independent 22-case probe also covers async and generator self-bindings,
class static methods and field arrows, an import alias, unrelated expression
names, anonymous expressions, a method key that creates no binding, direct
literals, unshadowed imports, mutable/computed/private/interpolated exports,
static templates and parameter shadowing. All corrected expectations match.
All non-projection site fields remain unchanged in every comparison.

Two outside-body probes still bind to the import under TypeScript, but become
unknown because the same file contains a matching named expression. This is
the disclosed file-wide conservative refusal, permitted by the review brief.
It is not a new false-known classification. No full symbol resolver is proposed.

## The fixtures fail when their behavior breaks

The two added fixtures require exactly one site, table `projects`, argument
expression `COLUMNS` and a null projection. They invoke the actual scanner.
They do not accept an absent site or merely match fixture text.

The independent runner observes these outcomes:

- Corrected reference guard: all 10 cases pass.
- Harmless scanner comment: the same 10 cases pass before fault trials.
- Exact base scanner with corrected fixtures: both named cases fail, with
  expected null and received `"id, jurisdiction_context"`.
- Function-expression omission: only the function assertion fails; the class
  case passes. Class-expression omission gives the converse result.
- Exact restoration: all 117 cases pass across the reference guard, write-policy
  guard, GTFS claim-boundary guard and GTFS coverage guard.

The private 22-case probe has its own harmless comment survivor. Omitting
function-expression collection then fails its named `function-self` assertion.
These expected assertion failures, not startup or collection errors, support
the sensitivity claims. Each private scanner mutation restores exact saved
bytes in `finally`. Final scanner and test hashes match the assigned tree.
Scoped TypeScript and ESLint also exit zero for the two changed files and
TypeScript's transitive imports. No new harness error occurs in this round.

## Census and guard boundaries remain unchanged

Independent base and corrected scans serialize all 2,008 complete site objects
to byte-identical JSON. Both SHA-256 values are
`2738a5ccf92243023f04ece7c358296cfa85b3f152853f8122f78093efab6940`.
Both retain 181 unknown and 1,802 checkable projections. No current production
site changes classification, location, count settings or write-following status.

Removing exactly the inserted fixture block reproduces the base reference
guard test byte-for-byte. The unknown ceiling remains `< 182`; schema checks,
view exemptions, dynamic-table registry and delete-helper checks remain.
The existing actual-jurisdiction-reader assertion passes, retaining its six
fields and migration-schema check. The original one-site growth mutation is
read in prior evidence, not rerun or claimed as a fresh trial here.

## Resources, custody and limits

Private snapshots, probes, fixture files, caches, complete census files and
raw logs remain at
`/home/nathaniel/.local/state/openplan/projection-expression-shadow-independent-20261015-01/`.
The snapshot comes from a local archive of exact `9368`. Compact receipts,
source bindings, restoration, resource readings and private file hashes are in
[`evidence.json`](evidence.json).

Both serial resource scopes enforce 1 GiB memory, zero swap and one CPU quota.
Node uses a 640 MiB heap; Vitest uses one worker and private caches. The largest
observed peak is 461,139,968 bytes. Both scopes report zero swap peak and zero
OOM events. Bubblewrap mounts borrowed canonical dependencies read-only,
exposes only the private review root for persistent writes and disables network
access. Node is `24.22.0`, TypeScript `5.9.3` and Vitest `4.1.11`.
The known unrelated Mammoth argparse `1.0.10` versus root lock `2.0.1` drift
remains. These results do not establish lockfile-exact QA.

The scanner cannot prove discovery of all database reads. It depends on source
roots and recognizable `.from().select()` chains, and excludes `src/test`.
Its syntax-based resolution does not prove complete TypeScript binding or
runtime data flow. Unsupported imports and conservative shadows can remain
unknown. Embedded-resource and view columns, installed schema, RLS, actual
query results, recovery, browser workflows and practitioner acceptance remain
outside this evidence. The symbol probes establish binding identity, not valid
runtime Supabase use of the fixture's function or class.

The parent frozen `06a` checkout and QA, all other checkouts, dependencies and
application services remain untouched apart from authorized read-only reads.
No nested delegation, broad audit retry, full suite, original 175-case campaign,
build, database, browser, provider/cloud operation, installation, push, PR or
main merge runs. Historical diagnostic failures and correction-harness errors
remain in their original reports; this review does not clear them. The parent
owns integration, fresh combined QA and release decisions.
