# Recover accepted requests without repeating started aerial work

The current HTTP worker loses accepted receipts and queued jobs after restart.
The native counterexample records that defect. This isolated opt-in candidate
connects the existing private admission journal to the actual HTTP worker.
Default operation and the public request/callback schema remain unchanged.
Deployment configuration and hosted services remain owned by the relaunch agent.

A new request receives one original job reference and accepted callback. The
SQLite journal commits before HTTP 202. Exact repeats return the original receipt
with HTTP 200 after capacity changes or stopped-root restoration. Changed payloads
under the same ID refuse with HTTP 409. Journal errors refuse rather than falling
back to memory. Authentication and existing request validation precede admission.

The opt-in `ODM_WORKER_MANAGED_ADMISSION=1` mode requires a private work root and
explicit `ODM_WORKER_INSTALLATION_ID`. An immutable private seal preserves the
configured identity. An existing installation requires its original initialized
admission database. A missing seal cannot bind existing admissions or retained
records to a new installation. Database opening uses SQLite `mode=rw` to refuse
creation if the original file disappears at open. This is local custody, not
installation attestation or actor
authority. No original actor is invented from a bearer token or workspace ID.

One lifetime private writer lock owns the runtime root. Accepted admissions
advance in insertion order. A durable original start intent precedes the existing
pipeline. Concurrent calls cannot run two pipelines. A local terminal record
keeps callback delivery and source/engine custody unassessed. Started entries
without a retained reported engine-terminal observation hold later queued work
for reconciliation. A local failed state alone cannot release that hold. The
record preserves the original task UUID and reported status code without
attesting the engine or proving callback delivery.
A restart does not infer that missing receipts mean the engine did nothing.

Use actual HTTP admission, an owned worker child paused at imagery intake, a
second queued request, exact replay/conflict probes and actual stopped-root
capture. The fresh worker must preserve original receipts and queued work while
avoiding repeated started intake. A separate controlled terminal pipeline fixture
checks that accepted work advances once in original order. It does not establish
actual image processing, artifacts or callback delivery.

Source retention, original actor/live authority, per-stage engine intents, commit,
outputs, artifact links and callback custody remain separate integration work.
Existing retained-source and engine libraries are not silently treated as
connected. Preserve failed trials and restore mutations in `finally`. Main merges
remain held until explicit dated coordinator clearance after handoff, the separate
Opus review and blocker resolution. No deployed environment or public schema
changes in this candidate.
