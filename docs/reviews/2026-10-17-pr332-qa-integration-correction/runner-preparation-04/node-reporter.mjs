import { completeSignal, journal } from "./.pr332-report-io.mjs";

// Future granted use only. Emit bounded structured test events without importing
// a subject or replacing Node's test selection. Keep partial output on failure.
export default async function* reporter(events) {
  const output = journal(process.env.PR332_REPORT, 4 * 1024 * 1024);
  const emit = value => output.emit(value);
  function error(value, depth = 0) {
    if (!value) return null;
    return {
      name: value.name, code: value.code, message: value.message,
      stack: value.stack, actual: value.actual, expected: value.expected,
      failureType: value.failureType,
      cause: depth < 2 ? error(value.cause, depth + 1) : null,
    };
  }
  let primary;
  try {
    emit({ type: "start", runtime: process.version });
    for await (const event of events) {
      if (event.type === "test:pass" || event.type === "test:fail") {
        const data = event.data;
        emit({ type: "case", name: data.name, state: event.type === "test:fail" ? "failed" : "passed",
          skip: data.skip || false, file: data.file, line: data.line,
          error: error(data.details?.error) });
      } else if (event.type === "test:summary") {
        emit({ type: "summary", data: event.data });
      }
    }
    emit({ type: "end" });
  } catch (error) { primary = error; }
  let recording;
  let receipt;
  try { receipt = output.finish(); } catch (error) { recording = error; }
  if (primary || recording) throw new AggregateError([primary, recording].filter(Boolean), "node_reporter_incomplete");
  completeSignal(receipt);
  yield "PR332 Node report retained\n";
}
