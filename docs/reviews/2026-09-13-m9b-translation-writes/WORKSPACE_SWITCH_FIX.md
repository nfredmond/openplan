# Workspace switcher repair

This is an independently shippable header bug fix discovered while checking translation access on September 13, 2026. Before the repair, both changed application files were identical between main 88fb20b6 and translation checkpoint 9f6c4b94. It does not depend on the unfinished translation command or generation work. Prepare a v0.58.1 patch from current main in a separate owned checkout, apply this header-only commit, identify that build, run applicable release checks and inspect final main CI before tagging. Do not merge the incomplete translation branch to ship this repair. No PR or human-review gate is required.

## Defects and behavior

The existing max-width:960px rule hid op-cart-ws-body, including the actual workspace selector. A fresh invited viewer could not reach the target workspace through that header at 390px. This was initially mistaken for another selector problem; the subsequent named-control check and inspected screen established that the control was absent.

At desktop width, op-cart-ws-name clipped the open menu with overflow:hidden. Keyboard selection could work even though the options were invisible to a pointing user. A new browser probe opened the menu and failed an actual elementFromPoint hit-test on the target option. Its before screenshot shows only tiny clipped menu fragments.

The header now retains the selector at narrow widths and truncates only its label. Its dropdown can escape the label container. At phone widths the workspace card uses its own row above search and appearance controls. Long option names wrap, and menu width is bounded by the viewport. Single-workspace names still truncate. The workspace-switch API and membership guards are unchanged.

## Evidence and scope

The identified owned webpack build on 3260 completed keyboard selection and persistence through reload at 1440, 900, 390 and 320px. Every target option passed a real center-point hit-test and remained inside the viewport. Desktop and 390px menus were visually inspected. Baseline and harmless CSS controls completed; injecting display:none at 390px failed the visible-control assertion, and restoring overflow:hidden at desktop failed menu hit-testing. These controls reproduce both demonstrated defects. See workspace-switch-browser-controls.json and workspace-switch-evidence.json.

The six existing workspace-switcher behavior tests and thirteen translation editor tests passed; four existing dashboard layout-contract tests passed. Changed-file lint and TypeScript exited zero. No new unit test purports to measure CSS geometry. These checks cover the named header interaction, not all global layouts, release QA or production performance.

An initial post-fix probe stopped after ten seconds while waiting for the workspace-selection request. The normal 45-second navigation wait then completed all widths; no production latency claim follows. Keep workspace-switch-after.log as that earlier result. The before-image prefix is workspace-switch-baseline-1789327172530; the passing baseline is workspace-switch-baseline-1789327389813. Private artifacts remain under /home/nathaniel/.local/state/openplan/response-write-probe-20260913.

The switch probe recorded preload and map/GIS fetch warnings around navigation/reload/context closure, with no page exceptions. Their exact messages remain in the private JSON; do not call this a clean-console or geospatial-data acceptance result. The separate translation access run also recorded React script-tag messages on outsider not-found pages; its cause remains unassessed. None of these records is final release evidence for a main build.

## Next operation

Keep the original /home/nathaniel/code/openplan and demo untouched; another Codex session was active in the original checkout. The header repair should be cherry-picked into an isolated checkout of current main for its patch release. Recheck current tags/CI, serving process identity and the named local stack before building. This feature checkout's stack has 331 migrations through 20261014000012 and includes unfinished translation readers, so do not assume it represents a clean main install or downgrade it. Preserve the translation checkout and retained fixtures for subsequent M9b work. The full V1 goal remains active.
