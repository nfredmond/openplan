import { openSync, writeSync, closeSync } from "node:fs";

// Future granted use only. Emit bounded structured test events without importing
// a subject or replacing Node's test selection. Keep partial output on failure.
export default async function* reporter(events) {
  const fd = openSync(process.env.PR332_REPORT, "wx", 0o600);
  let written = 0;
  function emit(value) {
    const bytes = Buffer.from(`${JSON.stringify(value)}\n`);
    if (written + bytes.length > 4 * 1024 * 1024) throw new Error("node_report_limit");
    writeSync(fd, bytes);
    written += bytes.length;
  }
  function error(value, depth = 0) {
    if (!value) return null;
    return {
      name: value.name, code: value.code, message: value.message,
      stack: value.stack, actual: value.actual, expected: value.expected,
      failureType: value.failureType,
      cause: depth < 2 ? error(value.cause, depth + 1) : null,
    };
  }
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
  } finally {
    closeSync(fd);
  }
  yield "PR332 Node report retained\n";
}
