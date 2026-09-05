export const REPORT_TITLE_MAX_LENGTH = 160;
export const REPORT_SUMMARY_MAX_LENGTH = 2000;

/** Match the API's trimmed text limits without truncating a planner's draft. */
export function reportTextErrors(title: string, summary: string) {
  return {
    title: !title.trim()
      ? "Enter a report title."
      : title.trim().length > REPORT_TITLE_MAX_LENGTH
        ? "Title must be 160 characters or fewer. Your draft has not been shortened."
        : null,
    summary: summary.trim().length > REPORT_SUMMARY_MAX_LENGTH
      ? "Summary must be 2,000 characters or fewer. Your draft has not been shortened."
      : null,
  };
}
