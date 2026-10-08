/** Carry only measured byte limits across worker boundaries. This diagnostic
 * does not change saved intent, grant retries or describe other task outcomes.
 */
export class SynthesisTaskResourceError extends Error {
  constructor(readonly taskIndex: number, readonly requiredTaskBytes: number, readonly taskByteLimit: number) {
    super("Synthesis task exceeds its saved byte limit");
    if (![taskIndex, requiredTaskBytes, taskByteLimit].every(Number.isSafeInteger) ||
      taskIndex < 0 || taskByteLimit < 4096 || taskByteLimit > 1048576 || requiredTaskBytes <= taskByteLimit) {
      throw new Error("Invalid synthesis resource diagnostic");
    }
    this.name = "SynthesisTaskResourceError";
  }
}
