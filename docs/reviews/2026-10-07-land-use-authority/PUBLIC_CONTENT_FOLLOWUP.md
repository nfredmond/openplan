# Public plan content follow-up

October 7, 2026. Commit `70ad9299fbf87681d77148eebee026505324debf`
corrects the omissions found in the [preceding journey](FROZEN_PUBLIC_CONTEXT_ACCEPTANCE.md).
Both public pages include authored root policies and goals. Nested content appears
once; checklist selection still controls section roots. The public review page
also shows the frozen implementation program. Legacy context now says "Context
not retained with this version" and omits the contradictory saved-context introduction.

## Verification

[Thirty-two focused tests](public-content-followup/focused.log), TypeScript,
changed-file ESLint and the [identified production build](public-content-followup/build-status.json)
pass. The [controls](public-content-followup/controls/report.json) detect 12 faults:
dropped roots, duplicate nested content, unselected section inclusion, hidden
legacy content and dropped actions on each page, plus incorrect legacy heading
and introduction. Baseline and harmless-comment controls pass. Source hashes
are restored. These mounted mocks do not prove database authorization or layout.

T3 uses the actual workspace picker, plan card, historical version 1 link and
public review link on port 3498. Health identifies `70ad9299fbf8`; the process cwd
matches the owned checkout. The [desktop](public-content-followup/publicContentReviewDesktop.png)
shows both previously omitted policies and the implementation action. Separate
390px views show the [policies](public-content-followup/publicContentPoliciesMobile.png)
and [action](public-content-followup/publicContentActionsMobile.png). The document
width is 375 CSS pixels within the 390px viewport. The existing legacy adopted
page shows the corrected disclosure at [desktop](public-content-followup/publicContentLegacyDesktop.png)
and [390px](public-content-followup/publicContentLegacyMobile.png).

Keyboard activation downloads the same 5,501-byte review JSON. Its
[verification](public-content-followup/public-content-download-verification.json)
compares the file with a new read-only native snapshot and the anonymous browser
response. The canonical hash remains
`971d2c823e79849661b6563845386d3d701f2f2d412282360e43fbe36d7dc836`.
The native version equals the pre-journey record. A harmless key-order change
passes and a changed frozen title fails. No review, adoption or publication
producer runs again.

The [console record](public-content-followup/console-review.json) contains the
same three earlier preview/startup errors, with no additional application error
in the retained record. Older network entries remain omitted. The map fixture is
empty and this instance has no public Mapbox token; the page states that limit.
T3 handles target-blank navigation in the same tab. Native new-tab behavior,
nonempty maps, populated adopted content and practitioner acceptance remain
unproved. This correction retains the existing depth limit of eight; deeper or
malformed content trees need separate assessment.

The build runs alone under an 8 GiB ceiling. The
[server](public-content-followup/server-status.json) peaks at 232,419,328 bytes.
After the requested stop, Node exits 143 and systemd records `exit-code`.
Port 3498 is clear. This is not another OOM and is not reported as a clean exit.
Protected BCA, engagement and demo processes remain untouched.

GitHub checks on the next pushed head remain required. M1 and V1 stay open.
Artifact integrity is recorded in [sha256.json](public-content-followup/sha256.json).
