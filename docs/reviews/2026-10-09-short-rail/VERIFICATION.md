# Stable navigation in short desktop windows

T3 acceptance of integration candidate `f2e1d19176ed` reproduces a missed first
Engagement click at 1280 by 800 pixels. After opening and closing New project,
the pointer is outside the rail and its six group headings have zero height.
Engagement starts at y 441.821 with height 23.998. Pointer-down reaches Engagement
at y 453.820. Hover and focus restore the group headings, moving Engagement to
y 541.821. Pointer-up reaches Travel modeling; the resulting click targets NAV,
and the browser remains on Projects. A second click succeeds after expansion.

A temporary short-window style keeps heading height zero and margins at
6px 18px 0. Repeating the same real controls sends pointer-down, pointer-up and
click to Engagement and reaches the campaign catalog. The diagnostic style and
event listeners are removed afterward. This establishes the observed cause; it
does not constitute rebuilt-source acceptance.

The source correction keeps the compact geometry for rest, hover and focus below
881 pixels high. It removes the redundant lower-height exception. Desktop labels
and the existing phone-specific rules remain. No test or guard changes.

The correction lives in a separate worktree so the integration acceptance build
remains unchanged. The six existing safety map/rail checks pass from the nested
application directory. An initial invocation from the repository root fails
before running tests because its relative stylesheet path is wrong; that is a
command setup failure. A configured production build and identified-build
desktop, tablet-width and 390px navigation remain pending.

## Rebuilt acceptance

Source `b1b0fc56f8e2dea07813d79496df6a67585b864d` builds successfully in
1 minute 55.828 seconds with a journal-reported 7.1 GiB peak. The service has an
8 GiB cap, no swap, 256-task limit and two page workers. Build-log SHA-256 is
`e27dce7fdaf12f8aa1d8435f4d27b98a663f925ff52823f81017ccd7dcccdec0`.

The separate server on port 3521 reports commit `b1b0fc56f8e2`, version 0.68.0,
and the expected worktree cwd. T3 opens Projects, opens and dismisses New project
to move the pointer out of the rail, then activates Engagement once. At 1280 by
800 and 1024 by 768, every pointer event reaches Engagement and its top remains
y 441.821. Both activations reach the campaign catalog. No diagnostic style is
installed during these baseline journeys.

At 390 by 844, Projects opens through the phone rail, More opens the complete
navigation dialog, and Engagement reaches the catalog and closes the dialog.
All six rail headings retain zero height and zero top margin. Document widths
match each viewport. Focusing Projects and pressing Enter also navigates.

A harmless outline-offset change still passes. A targeted temporary style that
restores the original heading expansion reproduces the 100-pixel shift,
pointer-up on Travel modeling, click on NAV and unchanged Projects URL. Removing
that style restores the first-click success. All diagnostic styles and listeners
are removed. These are rendered controls; no tracked test or guard changes.

Desktop and phone screenshots are visually inspected and identified in
`acceptance.json`. Console history has no new entries after opening this build
at 22:01 UTC. Earlier deliberate synthesis contention produces three visible
503 errors in the retained history; it is not a clean whole-session claim.

This verifies the exercised links and sizes with T3's desktop user agent.
It does not establish every input device, every navigation destination, native
mobile behavior or practitioner acceptance. GitHub CI remains separately tracked.
