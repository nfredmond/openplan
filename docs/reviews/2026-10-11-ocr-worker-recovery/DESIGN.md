# OCR worker root and saved-result recovery

M3 requires each worker family to recover beyond selected model/transit roots.
Test the existing OCR worker without changing its runtime, contract or hosted
configuration. The local machine has Poppler and Tesseract but no OCRmyPDF.
Use its supported `text` mode with a synthetic three-page PDF, including a blank
page. This is a text-layer recovery check, not scanned OCR quality acceptance.

Run only owned bounded processes and ephemeral loopback listeners. Provide
explicit fixture tokens, a private root, one task, a small page/byte ceiling and
an empty dispatch URL. Disable proxy routing. The wrapper selects a loopback
ephemeral listener through the existing `build_server` interface and starts the
unchanged main worker, queue, persistence, intake, extractor and delivery loops.
It changes no worker source file. Retain executed source hashes and tool versions.

Serve the exact PDF bytes from an owned local source. A separate local callback
consumer records the original successful payload durably and withholds its HTTP
acknowledgement. Observe that the worker persists that exact result before the
request. Interrupt only the owned worker at that window. Capture the stopped
complete private root with the existing operator, preserving every original byte,
directory and generic SQLite job record.

Keep that package immutable. Create a separate runtime copy, disable the source
endpoint and use explicit native-command refusal probes for PDF extraction.
Restart the existing worker against the copied root. The original callback ID,
job reference, page numbering, blank page, text and payload bytes must recover.
The callback consumer must keep one logical result for the same exact payload.
No second source download or extraction probe may occur. Independently inspect
the copied SQLite records and source bytes before and after continuation.

Use harmless and deliberately broken observation controls; restore disposable
mutation edits in finally. Preserve failures. Stop every owned worker and local
listener in finally while retaining roots, packages, logs and consumer receipts.
Never access the demo, a hosted callback or another agent's server/database.

This does not establish a live OpenPlan database/Documents callback, live RLS,
full installation alignment, long computation, scanning/recognition accuracy,
separate-hardware recovery, agency commissioning, browser or public readiness.
It does not replace the relaunch owner's separate hosted OCR evidence or lift
the main merge hold.
