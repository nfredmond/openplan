# Email persistence and confirmation recovery, unreleased

Owner: this thread, with no subagents, in the separate checkout
/home/nathaniel/.local/state/openplan/engagement-write-recovery-2026-09-12,
branch work/engagement-write-recovery. It starts at e3ed918c; merge the final
v0.56.0 main/evidence history before landing this next increment. Installed
node_modules is shared by symlink; app source and build output are separate.

v0.56.0 is already on main at e006b98bd8aeedbde48a74bec2169e1f1d01c9ad and awaits
final CI before tagging. Its CI is 34739606630, RLS 34739606639 and Upgrade Path
34739606645. RLS and upgrade succeeded; CI was still running at this checkpoint.
Its release source remains unchanged by the work here. The superseded foundation
upgrade 34737449570 was cancelled once final-source checks were running.

The real enqueueEmail helper ignored a returned database insert error and still
attempted transport. The retained local probe returned outboxId=null, status=sent,
with one intercepted transport call. Its database and transport are explicit local
doubles; no email or network request was sent. The probe's old helper checksum
and source commit are retained. Running the old reproduction against the fixed
helper should fail its transport-call assertion rather than overwrite its receipt.

The helper now requires a successful outbox insert with an identity before any
transport attempt. Broadcast totals count only saved outbox rows as enqueued and
separate unavailable writes from saved-but-failed deliveries. The staff notice
reports unsaved emails instead of falsely calling them an empty subscriber list.
Public opt-in confirmation wording follows the actual helper result instead of
assuming a configured transport sent the email. A retry flag keeps the resident's
email address and submit control available if confirmation preparation or delivery
failed after their interest was saved. An already confirmed subscription remains
unchanged and sends no extra confirmation.

Focused checks cover 115 tests across nine files, including work-digest callers,
public form retry, subscription routes, response routes, privacy-reader inventory
and plain-language guard. TypeScript and changed-file lint exited 0 after restoring
mutations. A harmless comment survived; ten targeted source failures were matched,
including outbox refusal, identity projection, enqueue counts, UI failure notices,
confirmation outcomes and an otherwise hidden retry form. The initial mutation
script stopped before a broad projection replacement because four matches existed;
it now targets the exact enqueue single-row projection. Initial results remain.

Browser acceptance and full QA are pending. No geography, reminder constraint,
RLS policy, database migration or scientific claim changed. The code is not in
v0.56.0 and is not released. Complete reasoned/stale-safe response writes, durable
request replay, subscriber-read completeness/errors, persisted delivery-result
recovery and translation history remain open. In particular, this guard does not
make delivery exactly once or turn a response publication plus notification into
one database transaction. The current subscriber reader can still truncate or
misreport a failed read; keep its existing caveat until that reader is repaired.

Next: identify a local build of THIS checkout, exercise public confirmation failure
and retry plus staff publish/outbox failure from real navigation at desktop/390px,
inspect console and retained counts, then complete applicable QA and landing.
Use only synthetic local subscriptions and keep transport unconfigured; a retained
local confirmation message can exercise the real confirmation endpoint without
external delivery. Never hand-seed a confirmed subscriber as UI acceptance.
