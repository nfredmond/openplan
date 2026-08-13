import Link from "next/link";

import { SCREENING_GRADE_HELP_HREF, SCREENING_GRADE_TITLE } from "@/lib/help/screening-grade";

/**
 * The words "screening-grade", rendered as the way to find out what they mean.
 *
 * The phrase was asserted on twenty-odd surfaces and defined nowhere a planner
 * could click. This is the only thing that turns it into a question with an
 * answer, so it goes wherever the caveat is stated rather than being one page's
 * feature. It renders inline text, not a badge, so it can be dropped into the
 * middle of a sentence without changing what the sentence says.
 *
 * `children` exists for the sites whose surrounding grammar differs
 * ("Screening-grade" capitalized at the start of a sentence, "screening grade"
 * as a noun). The destination is never a prop: one explanation, one address.
 */
export function ScreeningGradeLink({
  children = "screening-grade",
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={SCREENING_GRADE_HELP_HREF}
      title={SCREENING_GRADE_TITLE}
      className={
        className ??
        "underline decoration-dotted underline-offset-2 hover:decoration-solid focus-visible:decoration-solid"
      }
    >
      {children}
    </Link>
  );
}
