# Generation browser work in progress

Continues b456fb20 in the same owned checkout. This note is temporary recovery guidance, not acceptance evidence.

The owned Next launch on 3260 was stopped after verifying its cwd and ancestry back to this Codex process. It was restarted with process-only synthetic configuration: ANTHROPIC_API_KEY is a synthetic browser-test credential, OPENPLAN_ENGAGEMENT_TRANSLATION_MODEL is synthetic-browser-model, and NODE_OPTIONS preloads translation-browser-server-network-guard.mjs. The preload refuses all Anthropic calls from the server; generation must enqueue rather than dispatch there. `.env.local` was not modified. Original deployment Anthropic availability was false. Encryption was already configured and was not changed.

New server tool session: 90550; observed Next server PID 754508. Recheck liveness and which-openplan identity, never infer it from these saved IDs. Log: private response-write-probe-20260913/translation-generation-browser-server.log. After this acceptance work, restore ordinary dev operation by stopping only the identified owned launch and starting npm exec -- next dev --webpack --hostname 127.0.0.1 --port 3260 without these synthetic environment overrides.

The application DB remains container supabase_db_openplan-restore-target-2026091050, postgres, 336/17. API is http://127.0.0.1:29821. There were no generation fields before this work; recheck before any worker execution. The new browser worker script accepts only its configured synthetic field, intercepts the actual Anthropic SDK response locally, and rejects all other network destinations. No other database or proof worker should be started.

The guard's initial direct probe expected an asynchronous rejection but the first function threw synchronously. The wrapper now preserves fetch's async rejection behavior, and the direct block probe passed. The browser queue/publication journey is still being assembled; no generation browser result is claimed yet.

## Usage-reset checkpoint, September 13

The user asked whether work can resume in this thread after the weekly reset. Preserve this unfinished work; the full V1 objective and direct-main release authorization remain in force. This is a branch checkpoint, not a release or a successful generation acceptance claim. No PR was created.

Live process inspection found no generation-browser runner still active. The second run terminated at `page.evaluate: Error: Final history unavailable`, after its desktop queue retry, worker redelivery and retained publication retry checkpoints. Its console recorded a 503 on the final history request. Cause is not established. The 390px journey did not run. Inspect the server log and the original campaign before creating another fixture or retrying work.

Private evidence prefix: `/home/nathaniel/.local/state/openplan/response-write-probe-20260913/translation-generation-browser-1789353509529`. Runner log: `translation-generation-browser-run-2.log` in that private parent. Campaign `8e2b0137-5fc8-4506-88eb-2850508a0563`, request `f46fffaf-09d4-4b36-b42f-90712f376f06`, field `4167b7ec-b250-4202-86f4-ecd663103938`. Keep generated output and original manual history intact.

The first run, private prefix ending `1789353285305`, stopped because the harness omitted the real publication confirmation dialog. It also used the wrong publication operation name. Both harness mistakes were corrected before run 2; this did not establish an application defect.

At this checkpoint the synthetic Next server is still running: launch shell 754322, Next CLI 754495, owned by Codex ancestor 988312. Treat these as historical identifiers and revalidate cwd, ancestry and served identity on resume. The process-only synthetic provider configuration described above remains active; `.env.local` is unchanged. No browser runner or worker is being left running. Restart or restore only this owned server as required. Do not touch the original checkout, demo, other sessions or preserved databases.

The new JavaScript files parse with `node --check`, and `git diff --check` is clean. These are syntax/whitespace checks only. Worker transport and new acceptance guards still need their harmless and targeted controls; full generation browser acceptance, public generation durability, production console review, final QA/shuffled/worker/upgrade checks and release CI remain outstanding. Earlier verified evidence remains in the linked progress notes.
