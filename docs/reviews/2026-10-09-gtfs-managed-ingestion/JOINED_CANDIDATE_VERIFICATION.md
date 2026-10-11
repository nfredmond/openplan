# Joined production and recovered preview, October 11

The frozen clean checkout `ba1b497fce5c83f5cdb36031a56ce447d2719fb0` joins GTFS `b246ae1b` and encryption `e24a8e27`, both containing main `e435e58b`. The application remains version 0.68.0. This is a development candidate, not a release or hosted deployment.

## Build and preview schema

Locked dependency installation passes under a 2 GiB service cap. Native SQLite and esbuild execute. The first [build attempt](candidate-build-01-failure.json) compiles but exhausts its 4 GiB V8 heap during TypeScript. It receives no acceptance credit. The [successful retry](candidate-build-02-success.json) completes webpack, TypeScript and all 140 static pages in 165.667 seconds, with one worker, a 6 GiB heap and a 10 GiB service cap, with swap disabled. Its largest observed exact peak is 7,780,728,832 bytes; systemd reports a rounded 7.2G peak. Build identity is `i0I-j8j9_N0rIACWRyRKQ`.

[Launch controls](candidate-launch-controls-02.json) include baseline, harmless, start and restored passes, eight protected configuration refusals and eight omitted-guard failures. These pure controls start no server. The actual serving process uses the frozen nested package on port 3568, and `/api/health` reports commit `ba1b497fce5c`. Health leaves database status `not_checked`; native database checks are separate.

The [preview schema update](candidate-preview-schema.json) applies only exact main migration `20261017000001_project_map_packages.sql`, taking the owned recovered database from 403 to 404 migrations. Existing project, model, public GTFS and private managed table fingerprints remain equal. Repeat application passes. [Observation controls](candidate-preview-schema-controls.json) exercise the extracted inventory, CLI and preservation assertions. The earlier synthetic SQL-stub return-type and unnamed-assertion harness errors stay recorded. No hosted schema changes here.

## Actual T3 journey

Retained owner cookies reach Dashboard, Data Hub, Projects, the saved synthetic Oakland project, Travel modeling and its existing draft. Native role/admission/worker journeys retain their earlier identified source boundaries. This read does not repeat import creation or worker execution.

Data Hub's recent-version control shows adopted version `8a86a802-a3cc-4b09-979d-6187bad01285`, 14 routes and 287 stops, current-use identity and the historical-receipt caveat. It separately reads cancelled version `1ca4fa87-713d-4a0e-8015-9edd428f1640`, with one progress/review panel. This uses the recent-version card, not the earlier registry-history worker-attempt display.

The draft opens on Deterministic Corridor after the new main policy join. Selecting Fast Screening reveals the transit control. Selecting the retained feed makes the real coverage POST. Its 60,606-byte serialized geometry hash is `007c5ce9a3bea160193427fe1e6f769c33c239b3b448cd9e40ab623d9acdd8fd`, equal to the freshly read saved project. The response is HTTP 200, `coverage: yes`, schedule end `2027-01-10` and 238 stop-service rows. Native counting confirms those schedule rows in the geometry's envelope. These are not distinct stops, exact polygon coverage or measured operations.

Desktop and 390px captures show readable current/cancelled cards, archive/checksum disclosure and the saved Oakland source. CSS document width equals the selected 1280px or 390px viewport. Mobile PNGs are 566 by 1224 device pixels. The draft remains at zero runs, with prototype and independent-validation caveats and unavailable compatible AequilibraE heartbeat. No model launch occurs.

The first injected fetch observer mishandles a URL object and causes an RSC navigation fallback. The corrected observer normalizes the input and contains instrumentation failures. Its interval starts at 07:27:39.562 UTC. Compact coverage hashes allow inspection without returning the large geometry through the tool. Earlier tool timeouts and host-unavailable messages remain incomplete attempts; their cause is not established here. The [browser record](candidate-joined-production-browser.json) preserves prior Electron preload errors and the first observer error. The corrected interval has no captured error, rejection or instrumentation failure. It does not declare the full browser history error-free.

## Custody checks and limits

[Fresh native records](candidate-joined-browser-native.json) retain unchanged source project geography, current-feed metadata and zero model runs. Cancellation stays terminal with one attempt and claim, no derived route or stop publication, no current version and no ownership token. The [verifier](verify_joined_candidate_browser.py) rereads native records and verifies all eight [original capture hashes](candidate-joined-browser-artifacts.json). Three baseline, harmless or restored observations pass. All 26 changed observations fail at their intended assertions, including wrong cancelled selection and observer instrumentation error. Changes stay in private in-memory copies; actual rows, app source and captures are not mutated.

[Source hashes](candidate-joined-source-hashes.json) identify the published records and verifier. The complete joined full archive check starts separately after this build and read. Current GitHub CI, hosted schema-first coordination, main integration, commissioning, largest-feed capacity, protected configuration/private-worker recovery across installations, physical host recovery, practitioner/public-participant acceptance and independent scientific validation remain separate unfinished boundaries. GTFS migrations 28 through 31 remain unreleased and this lane leaves hosted admission disabled.
