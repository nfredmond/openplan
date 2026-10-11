# Joined production build and transit read, October 10

The full production build at clean source `48648251cbdabb0b90e8f2395f3662950c284c4a` passes. Build ID is `V-81SxKhPY1f6Mv6vyN7x`. [The build record](joined-map-ui-production-build-success.json) identifies the actual npm webpack command, TypeScript completion and 137 generated pages with one page worker. Wall time is 110.990 seconds; CPU time is 110.819 seconds. The service limits memory to 8 GiB, disables swap and supplies a 4 GiB V8 heap. The journal reports a rounded 4.9G peak; the largest sampled peak is 5,302,833,152 bytes. That sampled value is not an exact final cgroup maximum.

An earlier attempt at this source compiles webpack but exhausts its 2 GiB TypeScript-worker heap. [Its failed record](joined-map-ui-production-build-2g-failure.json) preserves the initial memory throttling and later service-limit adjustment. It receives no full-build credit. The two earlier 4 GiB service failures remain in [the build-command report](BUILD_MEMORY.md). Smaller test heaps prove option preservation, not application build capacity.

[Serving identity](joined-map-ui-production-runtime.json) records the owned production app, actual nested-package process directories and matching health commit. The app runs at `http://127.74.9.10:3564` with a 1 GiB service limit and a 768 MiB heap. Health checks the application only. Fresh native reads establish the separate database boundary.

## The saved project reaches the transit check

After T3 reopens, real navigation proceeds from Dashboard through Data Hub, Projects, the retained synthetic Oakland project, Travel modeling and its draft model. [Browser observations](joined-production-browser.json) record selected values, request bytes, observation times and desktop/390px layout measurements. The coverage POST carries 60,606 serialized geometry bytes. Its SHA-256 equals [the fresh native saved geometry](joined-browser-native.json), which remains identical to the source database record.

The selected BART version returns `coverage: yes` and 238 stop-service rows in the study-area envelope. A separate native SQL count confirms 238 rows for that current version and the saved geometry's bounding coordinates. These rows represent stops by service day. They are not distinct stops, polygon intersection coverage, measured operations or model validation. The selected schedule ends January 10, 2027.

The model remains a draft with zero runs and the original project/workspace binding. Both layouts show the saved Oakland source and scientific caveats. The optional feed selector retains the exact-archive and checksum explanation. No model is launched. The page reports no compatible AequilibraE worker heartbeat for this installation; this read does not establish model-worker readiness.

## Version review and cancellation remain distinct

The Data Hub identifies version `8a86a802-a3cc-4b09-979d-6187bad01285` as currently in use. Its 14 routes and 287 stops match fresh native parser metadata. The historical-receipt disclosure remains visible at both widths. This read does not repeat adoption or authorize a new decision.

Retained TriMet request `b8362580-4aee-4156-aff7-e504ba83c64d` displays cancelled version `1ca4fa87-713d-4a0e-8015-9edd428f1640`, one worker attempt and its synthetic cancellation reason. Native state confirms cancellation, one claim, no live token, no adopted current version and zero derived route/stop rows. One managed panel remains mounted. Retained decision receipts remain unchecked in this session. Earlier active cancellation and uncertain-admission recovery retain their own build boundaries.

## Captures, console and controls

All eight [original captures and hashes](joined-browser-artifacts.json) are inspected. Cancellation, current-version review, saved study area and selected-feed explanation each have desktop and 390 CSS pixel captures. Document widths equal viewport widths. Narrow images contain 566 by 1,224 image pixels because T3 scales its capture. The desktop user agent does not establish physical-phone acceptance.

The future-only observer records no console errors, window errors or unhandled rejections between 04:57:47.860Z and 05:02:31.762Z on October 11 UTC. [Diagnostics](joined-browser-diagnostics.json) preserve two Electron preload errors at 04:32:09Z, before that interval. One model prefetch returns `ERR_ABORTED` during navigation. Later actual model navigation and the coverage POST complete. This packet does not claim an error-free browser history or universal network success.

Some T3 selector/key calls report failure despite subsequent selection and response completion. A wrapped project link requires clicking its observed text fragment after automation targets empty space within its bounding rectangle. Actual URL changes establish navigation. Captures and DOM measurements establish the completed read; a failed tool result alone receives no credit.

[Observation controls](joined-browser-controls.json) pass baseline, an unrelated harmless note and restored records. Twenty-four altered copies fail at named assertions for build/health identity, geometry, project/model binding, coverage, metadata, cancellation, layout, disclosures, console and capture inventory/hash. The [verifier](verify_joined_browser.py) checks original records in `finally` and edits no database, application or image bytes.

[Actual CLI scope controls](joined-browser-scope-controls.json) repeat baseline, harmless protected-configuration note and restored input. Wrong database identity and missing proof directories fail before SQL dispatch, checked with a Docker sentinel. Original private configuration bytes remain unchanged. These reruns reread native records against saved observations; they do not repeat navigation.

This closes the identified-build project-geography/transit read for the later UI join within this local boundary. Exact-head CI, schema-first hosted coordination, integration and release remain separate. Migrations 28 through 31 remain unreleased candidates; managed admission stays opt-in. Cross-host reconstruction, hosted GTFS commissioning, practicing-planner acceptance, independent scientific validation and complete M3/v1 remain unproved.
