import { completeSignal, journal } from "./.pr332-report-io.mjs";

// Only Vitest's public reporter API is used. No subject, import transform or
// assertion is replaced. An incomplete report is evidence, never a passing run.
export default class Reporter {
  onInit() {
    this.output = journal(process.env.PR332_REPORT, 8 * 1024 * 1024);
    this.emit({ type: "start", runtime: process.version });
  }
  emit(value) {
    this.output.emit(value);
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
    let primary;
    try {
      this.emit({ type: "end", reason, modules: modules.map((module) => ({
        file: module.moduleId, state: module.state(),
        errors: module.errors().map((value) => this.error(value)),
        suiteErrors: [...module.children.allSuites()].flatMap((suite) => suite.errors().map((value) => this.error(value))),
      })), unhandledErrors: unhandledErrors.map((value) => this.error(value)) });
    } catch (error) { primary = error; }
    let recording;
    let receipt;
    try { receipt = this.output.finish(); } catch (error) { recording = error; }
    if (primary || recording) throw new AggregateError([primary, recording].filter(Boolean), "vitest_reporter_incomplete");
    completeSignal(receipt);
  }
}
