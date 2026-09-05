# Browser interruption after the green QA gate

This supplements, rather than rewrites, the earlier v0.44 continuation record.

On `898a26e2f5c656cf1f5b7137e8172a775c788e1f`, the clean `qa:gate` exited
zero. It ran 12,825 app tests, 132 live isolation tests, the production
dependency audit, and the production build. CI 33939915252, RLS 33939915314,
and the manually requested v0.43.0 upgrade rehearsal 33940472939 all succeeded.
The study verifier still checked every published artifact and conservation and
custody binding. No pre-v0.44 modeling artifact was modified or deleted.

A desktop browser journey entered Travel modeling from the visible module
switcher on the matching production build at localhost:3200. Repeated file
clicks stopped after eight or nine successful downloads. Response tracing
showed Next's page-prefetch requests for attachments, followed by full document
requests for early clicks, then no attachment request for a subsequent click.
The failure repeated with paced clicks and after explicitly waiting for the
selected county/method links. Screenshots and response traces remain in
`/tmp/openplan-v044-visible-proof/` and its adjacent log. This is not a passing
download journey; the console happened to be clean despite the stalled link.

The installed Next 16.2.11 source confirms that page navigation can suspend
while waiting for a full-page transition, and that a download attribute avoids
the page-navigation handler. The five v0.44 evidence links now use ordinary
download anchors, which also avoid speculative attachment prefetching. No
route, authorization rule, source, hash, or scientific result changed.

The added rendered-link assertion failed against the previous code. A harmless
comment survived; removing download semantics from the selected audit link
failed that exact assertion; restoration passed. The component assertion
cannot prove browser routing or file bytes, so a production-browser rerun is
still mandatory.

The full first-week run `2026-09-05T02-57-00-885Z` was interrupted during its
first job before editing the tree. It is incomplete and cannot pass the release
gate. Its processes and the production server started by this continuation were
stopped; the existing modeling workers were left running. Start a new complete
run only after the download regression and the pending Safety/report checks
have passed on the next clean, identified build.
