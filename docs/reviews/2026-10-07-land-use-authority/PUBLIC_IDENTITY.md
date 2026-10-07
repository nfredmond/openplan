# Public identity stays with the frozen land-use version

The M1 investigation starts from main `3e54ecc3` and the October 6 direction
review. Plan creation still uses workspace home to gate a configured descriptor.
That defect remains open. Before changing authority ownership, this checkpoint
corrects a public reader that mixes frozen content with mutable plan identity.

## Reproduced failure and correction

Both the adopted-plan reader and the public-review reader formerly selected the
current plan title, authority, geography label, plan kind and descriptor. Those
values could differ from the identity inside the reviewed snapshot. The reader
also compared stored hash references without recomputing the content hash.

The corrected readers validate the frozen plan/version identity and recompute
the existing canonical content hash. A different plan, version, version number,
missing identity or changed content returns `incomplete`. A database error
remains `read_failure`. They return the frozen title, authority, geography label
and kind, and resolve terminology using the frozen descriptor ID. The adopted
version query now requires its plan ID as well as its adopted state and report.
The public response shape and existing routes remain unchanged.

This change does not infer legal applicability from a label or boundary. The
descriptor's current installed text is still resolved by ID; a frozen source
edition and exact study geometry require further M1 work. Historical snapshots
and hash algorithms are unchanged. A missing identity is not reconstructed from
today's draft.

## Verification

Five focused suites pass 48 tests. The new suite runs both readers against
different current and frozen identities, malformed or substituted frozen
records, changed content and read failures. Its database double returns only
selected fields. It asserts the version projection and plan ownership filter.
Equivalent object key order is a harmless content control. Full TypeScript and
ESLint for both changed TypeScript files pass.

The [control record](controls.json) includes a harmless comment, the original
reader and seven targeted faults. The harmless run passes. The original reader
fails the identity case. Removing checksum, plan/version identity, version
number, row ownership, selected snapshot or query ownership checks produces the
named assertion failure. The runner restores the source byte for byte.

The first native inventory finds 62 existing frozen test versions with empty
snapshots and mismatching placeholder hashes. All corresponding review packets
return `incomplete`; none is relabeled as valid. There are no published adopted
packets in that inventory. The [inventory](native-inventory.json) is diagnostic,
not positive compatibility acceptance.

The [native case](native-case.json) uses authenticated synthetic fixture writes
on the isolated restore target at port 29821. It saves a complete frozen identity
and public-review release, reads it, changes only the live plan labels, and reads
again. The corrected public reader returns the same original identity and hash.
The original reader, loaded separately without changing the checkout, returns
the later title, authority and geography label. Withdrawing this new synthetic
release then returns `not_found`. The fixture remains retained, and no earlier
fixture is changed or deleted.

These checks establish a reader and native-record boundary. They do not establish
an identified HTTP build, rendered public journey, adopted-packet native case,
downloads, legal completeness or professional acceptance. The broader M1 case,
plan-kind-specific requirements, recovery and full v1 scope remain open.

## Identified production follow-up

The clean, unchanged `61e82460` production build passes. The owned server on
port 3491 reports `61e824600a45`; process 3254823 runs from this worktree's
application directory. The [identity record](identity-61e8.json) preserves that
check separately from database readiness.

A second synthetic review round retains the same original version. Its live
plan still has the later labels from the native case. The public API returns
200 with the original frozen identity and hash. The server-rendered public page
returns 200, contains the original authority and excludes the later authority.
Withdrawing this test round makes the public API return 404. Both rounds remain
retained. The [HTTP record](http-61e8.json) supersedes the missing production HTTP
boundary above for this named case only. HTML inspection is not browser visual,
keyboard, console, download or practitioner acceptance. Native adopted-packet
acceptance remains open. The owned server is stopped before these evidence edits.

The [fresh integration audit](integration-audit-61e8.json) accounts for 43
worktrees, 54 local branches and 55 live origin branches. Every local branch
matches its remote and there are no stashes. Six branches remain outside main.
Only the canonical checkout's unrelated `.directory` is untracked. The BCA
server on port 3486 remains untouched.
