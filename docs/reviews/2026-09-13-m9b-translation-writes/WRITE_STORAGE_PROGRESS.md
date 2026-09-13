# Translation request storage recovery

Continuation after 6b65d82e in `/home/nathaniel/.local/state/openplan/translation-command-workflow-2026-09-13`, branch `work/translation-command-workflow`. This repairs the existing M9b editor. It is an unfinished development checkpoint, not a release or a main CI pass. The original checkout and demo remain untouched.

## Reproduced defects and repair

After failed request retention, a storage refresh could replace the request held on the page with differing stored wording under the same request id. A regression downloaded the page copy and received the differing stored words. Another regression showed a stored conflict phase could replace the page's unconfirmed status and offer conflict review for an unsent attempt. Both tests failed before the fix.

The merge now preserves the page copy, compares immutable request content while allowing phase to differ, and exposes differing stored bytes for separate recovery. The stored record is archived and downloaded intact before the original page request can be retained and retried. This keeps both copies and avoids substituting a different payload under the same id. Recovery state is assigned after reading archives completely.

The retry text also no longer claims that a request was never sent: a failed retention retry can follow a previously dispatched request with a lost acknowledgement. It says this attempt was not sent and an earlier attempt may have reached the server. Stored-copy controls no longer label every differing record unreadable.

## Verification

Eight focused suites passed, 147 tests, after the final button labels. TypeScript and changed-file lint exited zero before the label-only adjustment. Three new integrated hook tests cover differing payload recovery/download/archive/retry, an identical stored request with a different mutable phase, and a failed retry after an earlier dispatch. HTTP is mocked in these tests; downloads use actual Blob contents but stub the anchor delivery.

The new mutation runner recorded baseline and harmless-comment survivors plus five targeted failures: replacing the page copy, hiding the differing copy, calling identical content damaged, clearing the volatile request while archiving another copy, and falsely denying an earlier dispatch. Its recorded source hash matches the final hook. These are selected recovery boundaries, not complete coverage of every pending-request guard.

The identified webpack dev build on 3260 completed real navigation and keyboard journeys at 1440px and 390px. A selective localStorage quota failure prevented the first dispatch. Another real browser tab then wrote a differing synthetic request, delivering a native storage event. Separate page/stored downloads matched their originals, the conflicting bytes were archived intact, and retry dispatched the original page request. The journey continued through lost acknowledgement, exact replay, correction, competing edit, conflict review, withdrawal/recreation and retained history. Both archived requests remained intact. Existing session-draft quota, malformed bytes, interrupted archives and reload recovery were also exercised.

Screenshots of the new recovery section were inspected at both widths: controls and long wording wrap inside the panel. Twenty-two draft/request downloads were independently rehashed after the run, in addition to the retained conflict-download assertions within the browser runner. Console inspection found deliberately interrupted requests and expected 409 responses; desktop also logged font/style preload warnings. No page exceptions were recorded. The wrapper ended with child exit 0 and revoked the temporary authenticated command grant.

Two earlier browser runs failed on test maintenance errors, not accepted results: the old final assertion expected one archive after the new step added a second, then its replacement selector looked for an article inside a details element. Their artifacts remain under prefixes `translation-editor-1440-1789325956918` and `translation-editor-1440-1789326050861`. The final run verified both archive payloads and selected the matching conflict request independent of storage ordering. An initial shell command also used a duplicate package path and failed to create the test; the actual regression execution followed at the correct path.

## Resume and limits

Private evidence is under `/home/nathaniel/.local/state/openplan/response-write-probe-20260913`. Final browser prefixes: `translation-editor-1440-1789326191255` and `translation-editor-390-1789326248648`. See translation-write-storage-recovery-evidence.json for hashes, translation-write-storage-recovery-controls.json for control outcomes, and translation-write-storage-*.log for terminal checks. Browser job 77683 and test job 23385 ended successfully; no test/mutation job remains live. The owned webpack server may remain on 3260. Recheck identity and ownership before reuse.

The isolated app database remains `supabase_db_openplan-restore-target-2026091050`, API 29821 / DB 29822, 331 migrations through 20261014000012. No migration changed this increment. Command EXECUTE stays revoked outside the contained browser wrapper. Preserve synthetic history and older proof stacks; no reset is needed.

Continue from STORAGE_RECOVERY_PROGRESS.md and NEXT.md for the full scope. Private viewer/outsider browser access and machine-acceptance behavior still need their new journeys. Additional pending-request deletion/read/race boundaries need assessment; the new tests do not prove every possible storage event. GENERATION_JOIN.md records concrete reuse points for durable generation without repeat spend. Generation, retained publication, attempt accounting, cache provenance and conversion of legacy producers remain unfinished. Full QA/shuffle, standard isolated RLS, applicable worker/upgrade/restore checks and final main CI remain before merge/tag. v0.58.0 is already published; the obsolete v0.47/v0.48 prompt is not the current release task. M9b and the full V1 contract remain active, with no human-review release gate.
