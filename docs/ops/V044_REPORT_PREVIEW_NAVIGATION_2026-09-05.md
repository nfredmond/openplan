# Report preview navigation correction

Release acceptance remains incomplete. Run `2026-09-06T00-38-40-005Z` on
`b51c4361` reached setup and neutral-jurisdiction outcomes. Job 02 reported yes
but recorded seven fatal console errors, so it is not accepted. Job 03 was
intentionally interrupted and later jobs failed server preflight. Original
findings, stdout, downloads and outcomes remain unchanged.

## Confirmed failure and correction

The tester clicked "Open the project record" inside a report preview. The
relative link loaded OpenPlan inside its scriptless iframe. Scripts and frame
protections refused the nested application. Independent reproduction entered
through sign-in and Reports and used an actual mouse click, without injecting
code into the frame. It produced a blank refused frame, a CSP error and no
parent navigation. Both before and after screenshots were inspected.

Report `6c07516e-43a0-44c4-86b3-ddaaef752d31` links to project
`56d2f367-982a-4325-98e6-ecfad420a741`. Its nine-page native PDF remains intact:
304,752 bytes match private Storage and SHA-256
`47ae96156949e36e277749413e820a201d95e3178d19cdcbfa626f16374fb4a3`.
All nine pages were inspected. Pagination still has queued defects.

The preview now binds user clicks to a native anchor in the host page. Internal
links retain path, query and fragment. External and modified clicks open
separately without opener access. Download attributes remain intact. Local
section jumps remain in the report; invalid or unsafe schemes are refused.
Initial binding handles a document loaded before hydration; subsequent loads
replace handlers. The sandbox remains exactly `allow-same-origin`. No scripts,
forms, popups or frame-driven top navigation are permitted. Stored artifacts,
console classification, scientific outcomes, thresholds and defaults are intact.

## Verification boundary

Fifteen new link tests, two existing preview tests and nine adjacent screening
tests pass. A harmless comment mutation survives. Sixteen real mutations fail:
omitted click binding, iframe-owned navigation, default frame navigation, script
permission, unsafe schemes, missing opener protection, lost query/fragment,
lost download, escaping section jumps, absent middle-click binding, lost reload
binding, missed nested links, lost new-tab behavior, empty or invalid navigation,
and absent pre-hydration binding. The last mutation fails only the new hydration
case; the other sixteen tests still pass. All mutations are restored.

These tests cannot prove actual browser navigation, user activation, layout or
downloaded bytes. Rebuilt desktop and 390px proof, full QA, exact-commit remote
checks and another complete twelve-job outcome gate remain required. Evidence
is in `~/.local/state/openplan/release-checks/v044-2026-09-05/`, prefixes
`report-link-final-` and `report-preview-link-`.

On the previous `b51c4361`, 12,978 app tests, 135 live isolation checks, lint,
dead-code checks, production dependency audit and build passed. Exact-commit CI
`34001518582`, isolation `34001518591`, upgrade `34001543285` and nightly
`34001536763` succeeded. Those checks do not cover this new correction.
The full developer dependency audit retains ten findings, tracked in issue 046.

Identified-build desktop and 390px checks of both original model runs show
29.7% and the same negative advice in the screening note and zone panel, with
no console errors. Run columns and a zone badge remain cramped, queued as 069.
This verifies the previous presentation correction, not scientific accuracy.
