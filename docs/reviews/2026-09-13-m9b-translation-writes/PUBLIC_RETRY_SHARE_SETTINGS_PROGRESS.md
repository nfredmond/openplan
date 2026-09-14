# Public retry, share settings and portal presentation

Continues `cbcb8985` in `/home/nathaniel/.local/state/openplan/translation-command-workflow-2026-09-13`, branch `work/translation-command-workflow`. The preceding goal turn made progress by installing migration 20, exercising public queue/worker recovery and pushing that evidence. V0.58.1 remains the released version; the translation increment and complete V1 objective remain unfinished.

## Fixed saved-setting behavior

The lower share controls were keeping their initial form values after the upper publish flow saved new settings. That made the lower status say view-only while the campaign was accepting input, and a later save could resend those stale values. Untouched fields now follow server props. A local edit survives unrelated refreshes, clears when its saved value is confirmed, and does not carry into a different campaign. Save sends only changed fields, preserves explicit null/false clears and refuses an empty request. Live portal status comes from saved campaign values rather than unsaved drafts.

The four share-control suites pass 25 tests. The refresh prover has two harmless survivors and 14 targeted failures covering stale values, lost or revived drafts, campaign scope, live status, untouched fields, explicit clears and token replay. It restores exact source bytes after each fault. Standalone types and changed-file lint passed before the final copy-only adjustments; check final logs for the latest result. Same-field concurrent campaign edits and failed server reads represented as null are not newly solved by this component repair.

## Public browser, worker and privacy evidence

`public-translation-retry-browser-evidence.json` records the final source hashes and artifact hashes for desktop 1440px and 390px journeys. Both create campaigns and approved synthetic meeting input through the UI, carry a slug draft across publish actions, and save only that slug while the other settings follow the server. Anonymous readers enter through the offered public URL, follow the comments door, and open Community feedback. Keyboard navigation and console inspection are included.

Each width proves lost POST acknowledgement recovery without another POST, completed worker-output acknowledgement recovery with no repeat provider call, explicit provider failure without automatic retry, one explicitly requested successor, preserved failed predecessor and original comment, and old-token refusal after public-link rotation. The real worker and SDK make three locally intercepted provider requests per width: initial success, deliberate 503 and successful successor. No paid provider call occurs. Wrong displayed source returns 409; old-token POST and exact GET both refuse access with 404 after rotation. Retained database records remain intact.

The synthetic wrapper now supports a deliberate provider-failure mode. Its source/model predicate continues to have baseline/harmless controls and targeted substitutions. The opt-in public RLS test is now included in `npm run test:rls-live`, so the normal isolated suite will execute it.

The empty feedback map frame is hidden only when its child map renders nothing. Browser controls show that a nonempty frame stays visible, removing the empty-frame class restores the bad blank box, and restoring it hides the empty frame again. I inspected completion/successor screenshots at both widths. The original and translated words, caveat and controls are visible without overflow. The per-comment caveat now correctly identifies the participant's original comment rather than calling it the project team's official wording. Other agency-authored translation notices remain unchanged.

Browser console errors correspond to the deliberately dropped response, wrong-source 409 and revoked-token 404s. The mobile run also retains development font/CSS preload warnings; no page errors occurred. One first navigation after restarting the development server returned to the map while the comments route first loaded. The warmed retry passed, as did an earlier independent keyboard diagnostic. Do not declare the cold-navigation behavior fixed: exercise this path in the production build as part of final acceptance.

## Continue

Run full QA and shuffled tests in the owned separate QA checkout, plus the complete isolated RLS, worker and populated upgrade checks. Finish legacy-cache browser compatibility and production-build cold navigation. Recheck the remaining translation workflow boundaries in the earlier notes, then prepare the coherent minor release, push verified work directly to main, inspect exact main CI and tag only after the declared checks pass. No PR or human-review release gate is needed. Keep the full current V1 contract and roadmap intact.

## Checkpoint state

Final standalone TypeScript and changed-file ESLint both exited 0 after the copy/layout changes. All browser and mutation runners are terminal. The named isolated application database remains at 339/20261014000020, with 20 completed, 36 cancelled and 16 interrupted fields and none queued/reserved/running. Failed synthetic attempts and older evidence are retained. The owned synthetic development server remains on 3260; re-identify it before reuse. Main was refreshed read-only and remains `ef16f166`, with v0.58.1 as its latest release; this branch already contains main. The dedicated QA checkout at `/home/nathaniel/.local/state/openplan/translation-resolution-qa-20260913-125bf2a3` was clean at `e30996ae` before updating it for the next full gate.
