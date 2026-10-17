import { openSync, writeSync, closeSync } from "node:fs";

// Only Vitest's public reporter API is used. No subject, import transform or
// assertion is replaced. An incomplete report is evidence, never a passing run.
export default class Reporter {
  onInit() {
    this.fd = openSync(process.env.PR332_REPORT, "wx", 0o600);
    this.written = 0;
    this.emit({ type: "start", runtime: process.version });
  }
  emit(value) {
    const bytes = Buffer.from(`${JSON.stringify(value)}\n`);
    if (this.written + bytes.length > 8 * 1024 * 1024) throw new Error("vitest_report_limit");
    writeSync(this.fd, bytes);
    this.written += bytes.length;
  }
  error(value) {
    const json = (item) => {
      if (item instanceof Error || (item && typeof item === "object" && item.message)) {
        return { name: item.name, code: item.code, message: item.message, stack: item.stack };
      }
      return item;
    };
    return { name: value.name, code: value.code, message: value.message, stack: value.stack,
      stacks: value.stacks, actual: json(value.actual), expected: json(value.expected) };
  }
  onTestCaseResult(test) {
    const result = test.result();
    this.emit({ type: "case", file: test.module.moduleId, fullName: test.fullName,
      name: test.name, state: result.state, location: test.location,
      errors: (result.errors || []).map((value) => this.error(value)) });
  }
  onTestRunEnd(modules, unhandledErrors, reason) {
    try {
      this.emit({ type: "end", reason, modules: modules.map((module) => ({
        file: module.moduleId, state: module.state(),
        errors: module.errors().map((value) => this.error(value)),
        suiteErrors: [...module.children.allSuites()].flatMap((suite) => suite.errors().map((value) => this.error(value))),
      })), unhandledErrors: unhandledErrors.map((value) => this.error(value)) });
    } finally {
      closeSync(this.fd);
    }
  }
}
