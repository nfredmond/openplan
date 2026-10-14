# Native OCR text-layer result recovery, October 11

This bounded M3 candidate verifies the existing OCR worker's saved-result
recovery on a synthetic three-page PDF. It changes no worker runtime, contract,
schema, hosted configuration or application UI. The relaunch owner retains
hosted coordination and the main merge hold.

## Executed boundary

Base commit: `3c38b728521e6f630f8aa8008e9a7e165c9093a7`, above PR209.
[The design](DESIGN.md), [executed source hashes](evidence/executed-source-hashes.json)
and [native tool versions](evidence/native-tools.json) identify the source.
The first trial passes a smaller observation set; `native-02` is the expanded
current proof. Both remain retained. Neither is a current-main installation.

[The native driver](native_recovery.py) starts unchanged `main.main()` in an
owned child. Its wrapper selects an ephemeral loopback listener through the
existing server builder. It uses explicit synthetic bearer tokens, a private
root, a 1 MiB source limit, three-page limit, one task, 30-second recognition
deadline, empty dispatch URL and disabled proxy routing. An explicit 0077 umask
protects fixture files. This does not assess the deployment's default umask.

[The fixture builder](create_fixture.py) uses ReportLab 5.0.1 from the official
[PyPI package](https://pypi.org/project/reportlab/), installed only in a private
proof-owned environment. [Its retained dependency versions](evidence/fixture-dependencies.txt)
do not change application or worker dependencies. All three rendered pages
were inspected: text on pages one and three, a blank middle page. This is PDF
fixture inspection, not an OpenPlan browser journey.

The first worker downloads the exact PDF, runs native Poppler 26.01.0 and saves
the successful result. A separate loopback consumer saves the complete callback
and a deduplication receipt before withholding its acknowledgment. The driver
observes `undelivered` in the real SQLite journal and terminates only its owned
child during that window.

The existing root-snapshot CLI captures the stopped root and verifies its package.
Independent comparisons include every ordinary file, directory, private mode,
SQLite schema and logical row. SQLite backup layout and recognized transient
WAL/SHM bytes are not treated as ordinary file identity. The original source
root and immutable package stay unchanged. Only a separate runtime copy resumes.

With the source endpoint disabled and `pdfinfo`/`pdftotext` refusal probes ahead
of the normal PATH, the replacement worker delivers the exact original callback
bytes, callback ID, job reference, text and page sequence, including blank page
two. Two deliveries produce one logical consumer result. There is one original
download, no second source request and no extraction reentry. The journal reaches
`succeeded` while retaining the original request, admission and result content.
Native HTTP replay returns 200 with the original admission receipt; changing the
document title under that request ID returns 409.

## Checks that can fail

[The independent observation oracle](recovery_oracle.py) does not call the
worker's callback builders. [Its controls](verify_controls.py) and
[executed outcomes](evidence/observation-controls.json) cover all new observation
comparisons: 30 broken observations fail at their named comparisons, while
baseline, harmless key order and restored controls pass. These controls mutate
observations. They do not prove corresponding runtime branches individually.

A separate native broken trial removes the saved result only in a disposable
runtime copy. The actual worker reenters recognition, executes the refusal
`pdfinfo` program and saves a failed callback. The positive recovery oracle
rejects that actual failed state at `recovered-terminal-state`. Finally restores
the disposable database bytes; retained source and immutable package are never
mutation targets. Failure logs and receipts remain available.

All six unchanged OCR test scripts pass serially. Their recognizer and callback
substitutions remain mocked; the new native proof covers different boundaries.
Python parsing and changed-file whitespace checks pass. GitHub CI is a separate
exact-head check, not inferred from these local results.

[The native result](evidence/native-result.json) records 0.919 seconds for the
driver, 0.449 seconds CPU and 38,776,832 bytes peak memory. Service invocation
`d87297ffccb948a3915ea54219f3604e` exits zero under a 512 MiB cap, zero swap,
one CPU and 128 tasks. The existing test-script service invocation
`9a1e15dbeb2f4967b33b0ffea72d06cc` exits zero with 37,965,824 bytes peak memory.
Both services are stopped. Cleanup receipts record all three native child exits
and the closed local listener. The first trial did not retain resource accounting;
its short successful result is not substituted for the expanded proof.

Private evidence base:
`/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/ocr-worker-recovery-20261011/`.
It retains fixture/renderings, dependency versions, executed sources, original
and copied roots, immutable package, callback bytes/receipts, broken trial,
observations, logs and service properties. No private journal or environment
configuration is published in this note.

## Remaining M3 floor

OCRmyPDF is absent. Tesseract 5.5.0 is installed, but this proof never recognizes
a scan. It does not establish scanning accuracy, a live OpenPlan Documents
callback or live RLS. The consumer is a synthetic local deduplication fixture.
It does not prove all installed workers, aligned database/Storage capture, a
useful 45-minute computation, independent commissioning, separate physical-host
or hardware-loss recovery, browser or public readiness. No scientific or
practitioner claim changes. M3 and the complete v1 contract remain open.
