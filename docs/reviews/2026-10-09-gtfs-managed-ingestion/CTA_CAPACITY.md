# One publisher import measurement, October 11

The installed managed worker completes one retained CTA import at frozen source
`ba1b497fce5c83f5cdb36031a56ce447d2719fb0`. The application remains version
0.68.0. This measures one input on the selected local recovered installation;
it does not establish largest-feed or nationwide capacity.

## Input, work and retained result

The source is CTA's [published schedule archive](https://www.transitchicago.com/developers/gtfs/).
Its [developer license](https://www.transitchicago.com/downloads/sch_data/developers_license_agreement.htm)
accompanies the archive. Raw source and complete parsed files remain private.
The measurement claims no CTA endorsement, legal certification or redistribution
authority.

[The native observation](cta-capacity-native.json) records 68,738,293 exact
archive bytes with SHA-256
`a9372be5b70fcee4ed98c9476433f86065637a9a500b8af6afbb84d000ef2746`.
The local retained archive and a new authenticated download of the immutable
Storage object agree in size and hash. Source and parser artifacts retain the
same installation, target, original synthetic actor, workspace, feed and version.
The parser artifact also retains the exact pinned source build. Its saved output
receipt matches the output's actual size and hash.

The production admission library creates a fresh queued version after an actual
fixture password grant and current owner membership read through RLS. This is
native admission, not another browser route journey. The actual installed
one-shot command observes its supervised parser child and completes with one
attempt, one claim and one completion receipt. Both managed state and legacy
version status are ready, with no remaining ownership token. The feed has no
current version and the new version is unadopted. Pre-existing transit identity,
claim and derived-row fingerprints remain unchanged.

| Measurement | Observed value |
|---|---:|
| Archive bytes | 68,738,293 |
| Parser bytes decompressed | 374,844,052 |
| Stop-time rows | 5,920,320 |
| Trip rows | 96,025 |
| Routes | 132 |
| Stops | 11,138 |
| Published route-service rows | 1,678 |
| Published stop-service rows | 74,517 |
| Installed worker elapsed time | 89.888 seconds |
| Parser-reported elapsed time | 30.695 seconds |
| Complete service elapsed time, including admission | 93.882 seconds |
| Runner limit, swap and CPU | 1 GiB, no swap, one CPU |
| Final journal runner peak | Rounded 728.8M |

The archive's member directory separately declares 367,361,926 bytes for
`stop_times.txt`. Declared ZIP member sizes do not prove decompressed byte use;
the parser's streaming statistics above provide that separate measurement.
The schedule window is September 11 through November 30, 2026. These schedule
and service rows do not establish observed transit operations or exact study
polygon coverage.

## Preconditions and controls

The real preparation refuses while the joined full archive drill is incomplete.
After that frozen-source drill passes and becomes inactive, its twelve exact
owned containers stop, with volumes and proofs retained. The CTA run uses the
separate recovered preview database and fresh private worker root. No database
reset, lease edit or adoption occurs. No Storage setting changes for this import.
The installed Storage 1.67.20 service reports its loaded global and standard
upload caps; both exceed this input, as does the private bucket's 200 MiB cap.
Its [pinned configuration](https://github.com/supabase/storage/blob/v1.67.20/src/config.ts)
selects `UPLOAD_FILE_SIZE_LIMIT` before the fallback `FILE_SIZE_LIMIT`.

[Scope controls](cta-capacity-preflight-controls.json) include three positive
controls and 49 invalid-input refusals with corresponding omitted-guard oracle
failures. They use synthetic observations and isolated function copies, without
database writes or downloads. [Actual fixture access controls](cta-capacity-auth-controls.json)
include three positive runs, wrong-original-actor and viewer refusals, and two
omitted-guard oracle failures. Auth creates fixture sessions; these are not
whole-database no-write checks. Transit identities remain unchanged and these
controls admit no transit version.

[Completed-observation controls](cta-capacity-observation-controls.json) apply
the same verifier to the actual successful native record. Baseline, harmless and
restored copies pass. Six changes to actor, archive hash, parser build, stop-time
count, adoption and pre-existing preservation fail at the intended boundary;
removing each corresponding guard causes its negative oracle to fail. They
mutate copied records, not live rows, Storage or worker artifacts.

## Historical bounds and remaining acceptance

The limits file previously describes a 94 MiB CTA size report as the largest
measured US feed, while also stating that it was not downloaded. The correction
keeps the numeric defaults and overrides unchanged and identifies that report
as historical input headroom. The existing threshold test now names the
historical King County measurements it actually asserts.
[Limit-note controls](capacity-limit-note-controls.json) pass all 13 tests in
baseline, harmless and restored runs. Four deliberately lowered production
constants fail at the intended historical thresholds. Strict selected-file lint
passes. These tests protect those thresholds, not current feed capacity.

[Earlier full CI](earlier-93-full-ci.json) passes 21,748 tests at `93cf7de9`,
with 1,603 skipped. All five jobs and the executed shuffled-test step pass;
the shuffled log has no numeric summary. Later keyless-map joins, dependency
installation, production build/read, exact-head CI, schema-first hosted
coordination, main integration and release remain separate work. This measurement
does not establish agency commissioning, physical-host recovery, practicing
planner acceptance or independent AequilibraE/ActivitySim validation.
