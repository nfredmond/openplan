"use client";

import { useEffect, useState } from "react";

/**
 * The reader's own clock, in the header, correct to the minute.
 *
 * WHAT USED TO BE HERE, AND WHY IT WAS A PROBLEM. This line showed the
 * workspace's `created_at`, formatted as a date and time and printed bare with
 * no label — so it looked exactly like a clock and never moved. A planner
 * glancing at the header to check the time would read a timestamp that was
 * hours or days old and act on it: stay late, or miss a meeting. A number that
 * is silently answering a different question than the one being asked is worse
 * than no number, and the workspace's creation date was not worth a permanent
 * place in the chrome anyway.
 *
 * It renders nothing until mount on purpose. The server has no way to know the
 * reader's timezone, so any time it rendered would be its own — wrong for
 * anyone in another zone, and a hydration mismatch besides.
 */
export function LocalClock({ className = "" }: { className?: string }) {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    // The current time is not knowable during render, and it is not knowable on
    // the server at all.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(new Date());

    let interval: ReturnType<typeof setInterval> | undefined;

    // Line up with the wall clock before settling into a one-minute cadence, so
    // the display changes when the minute changes rather than up to 59 seconds
    // later. A clock that is a minute behind is the same defect in miniature.
    const timeout = setTimeout(
      () => {
        setNow(new Date());
        interval = setInterval(() => setNow(new Date()), 60_000);
      },
      60_000 - (Date.now() % 60_000)
    );

    return () => {
      clearTimeout(timeout);
      if (interval) clearInterval(interval);
    };
  }, []);

  if (!now) {
    // Holds the line's height so the header does not shift when the clock
    // appears.
    return <span className={className}>&nbsp;</span>;
  }

  return (
    <time className={className} dateTime={now.toISOString()} suppressHydrationWarning>
      {now.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}
    </time>
  );
}
