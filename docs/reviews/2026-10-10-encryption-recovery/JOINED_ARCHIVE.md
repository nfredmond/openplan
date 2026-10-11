# Joined archive recovery, October 11

The complete local drill passes at frozen source
`ba1b497fce5c83f5cdb36031a56ce447d2719fb0`. It joins GTFS `b246ae1b`,
encryption `e24a8e27` and main `e435e58b`. The application remains version
0.68.0. This is candidate engineering evidence, not a release or hosted cutover.

## Native recovery and resources

[The selected result](joined-full-archive.json) records 374 restored tables,
six sequences and one private Storage object. The source key is privately
captured, the fresh target restarts with the retained key, and its mounted bytes
match. The actual shell checks decryption of the synthetic encrypted record.
The restored account signs in, and independent OWP reconstruction agrees between
source and target. All 104 live RLS files pass: 1,499 tests pass, 125 are skipped
and none fail. The RLS stage takes 2,695.56 seconds; the complete drill takes
2,916.327 seconds.

The runner and each of its twelve fresh services have a 1 GiB limit, swap
disabled and one CPU. The largest observed runner peak is 934,973,440 bytes;
the final journal reports a rounded 891.6M. After the successful inactive result,
each exact container ID, name and project label is rechecked before stopping the
twelve services. Containers, volumes and private proof files remain retained.
The unrelated recovered preview database and its API services stay running.

[Seventeen driver controls](joined-full-guard-controls.json) preserve baseline,
harmless and restored behavior. Seven foreign-source or resource-scope cases
refuse, and seven omitted guards cause their intended oracle failures. These
controls use isolated function copies and perform no Docker writes. The
[first harness failure](joined-full-guard-harness-failure.json) changes both the
project label and name suffix, causing a secondary refusal. It receives no
acceptance credit. The corrected harness leaves the already running native
driver unchanged.

## Exact GitHub boundaries

[Earlier candidate e24 checks](earlier-e24-ci.json) pass all five CI jobs.
QA passes 1,544 files and 20,804 tests, with 97 files and 1,603 tests skipped.
The shuffled test step actually executes and passes; its log has no numeric
summary. Separate live RLS and full archive workflows each pass 104 files and
1,499 tests, with 125 skipped. That encryption-only archive restores 362 tables
and one Storage object and signs in its restored account. Its inventory differs
from the joined GTFS candidate's 374 tables.

The remote PR subsequently joins keyless-map main `e37878ea` at `3abcd7686`.
Encryption code and the key helper are unchanged, but new-head checks remain
separate. The local native result identifies frozen `ba1b497f`; it does not
establish acceptance of the later map dependency or rendered changes.

These checks use synthetic records on one operator-controlled local Docker host.
They do not establish physical host replacement, hosted Supabase recovery,
complete external-worker restoration, agency commissioning, practitioner
acceptance or scientific model validity. Root keys, key fingerprints,
credentials and raw archives remain private. The hosted owner's cutover hold
remains in effect; this lane makes no hosted schema or service change.
