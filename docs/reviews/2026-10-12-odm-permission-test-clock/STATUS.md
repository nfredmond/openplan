# Permission expiry runs after actual preparation

PR #239 aerial CI run 38205436360 fails its permission-expiry fixture with
`Source custody deadline exceeded`. The old 0.2-second total budget can expire
during preparation before the intended permission callback on a busy runner.
This is a fixture boundary defect, not evidence of a permitted late command.

The revised fixture uses a separate clock only in URL intake. It advances that
clock after the actual authorization callback. Other stages keep their real
clocks. The fixture gives preparation 30 seconds but sleeps for no duration;
production limits and guards stay unchanged. The test still requires refusal
before any original engine intent.

Python 3.14 and 3.11 each pass 20 tests and 32 controls, with four harmless,
baseline and restored survivors and 28 selected faults. Removing the immediate
post-permission check now leaves the original intent and fails `Expired URL
draft cannot issue an intent`. The later deadline refusal still runs, which
cannot erase that earlier intent. Eight failure-classifier controls pass in
each environment. Sources restore exactly; bindings and sanitized reports are
in evidence. The owned serial service stops under its 768 MiB limit.

Exact-head GitHub regression remains pending. These tests use supplied local
adapters. Native authority, processing, installation recovery, practitioner and
scientific acceptance are not established by this correction.
