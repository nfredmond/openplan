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
