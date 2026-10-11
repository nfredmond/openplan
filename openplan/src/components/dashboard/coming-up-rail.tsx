"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import {
  CalendarClock,
  CircleDollarSign,
  ClipboardCheck,
  FileCheck2,
  Flag,
  Gavel,
  Landmark,
  MessageSquareText,
  Receipt,
  ScrollText,
  type LucideIcon,
} from "lucide-react";

import {
  COMING_UP_KIND_LABELS,
  isCalendarDayPast,
  localCalendarDate,
  type ComingUpItem,
  type ComingUpKind,
} from "@/lib/dashboard/coming-up";

const KIND_ICONS: Record<ComingUpKind, LucideIcon> = {
  deliverable: FileCheck2,
  milestone: Flag,
  submittal: ClipboardCheck,
  grant: Landmark,
  award: CircleDollarSign,
  invoice: Receipt,
  "plan-action": ScrollText,
  "plan-review": ScrollText,
  "public-review": MessageSquareText,
  adoption: Gavel,
  "comment-period": MessageSquareText,
};

const noSubscription = () => () => {};

/**
 * The reader's calendar date. Null during the server render, which cannot
 * know the reader's time zone; the rail then relies on the server's own
 * conservative overdue flag until the browser supplies today.
 */
function useToday(): string | null {
  return useSyncExternalStore(
    noSubscription,
    () => localCalendarDate(new Date()),
    () => null
  );
}

function dayNumber(dueOn: string) {
  return String(Number(dueOn.slice(8, 10)));
}

function shortMonth(dueOn: string) {
  const [year, month] = dueOn.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
}

function monthLabel(dueOn: string) {
  const [year, month] = dueOn.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function relativeDays(dueOn: string, today: string): string {
  const days = Math.round((Date.parse(`${dueOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days < 0) return days === -1 ? "1 day overdue" : `${-days} days overdue`;
  return `In ${days} days`;
}

function Row({ item, today, overdue }: { item: ComingUpItem; today: string | null; overdue: boolean }) {
  const Icon = KIND_ICONS[item.kind];
  return (
    <li className="dashboard-rail-item" data-overdue={overdue ? "true" : undefined}>
      <span className="dashboard-rail-day" aria-hidden="true">
        {/* Overdue rows sit outside the month headings, so they carry their own month. */}
        {overdue ? <span className="dashboard-rail-day-month">{shortMonth(item.dueOn)}</span> : null}
        {dayNumber(item.dueOn)}
      </span>
      <div className="min-w-0">
        <Link href={item.href} className="dashboard-rail-title">
          {item.title}
        </Link>
        <p className="dashboard-rail-meta">
          <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{COMING_UP_KIND_LABELS[item.kind]}</span>
          {item.projectName ? <span className="truncate">{item.projectName}</span> : null}
          <span className={overdue ? "dashboard-rail-overdue" : undefined}>
            {overdue ? (today ? relativeDays(item.dueOn, today) : "Overdue") : today ? relativeDays(item.dueOn, today) : item.dueOn}
          </span>
        </p>
      </div>
    </li>
  );
}

/**
 * Coming up: the next weeks of dated work as one vertical rail, with month
 * breaks and a mark for today. Overdue work sits above today, in words as well
 * as colour. Each title links to the record it came from.
 */
export function ComingUpRail({
  overdue,
  overdueTotal,
  upcoming,
  windowDays,
  incompleteSentence,
  failedSentence,
  moreHref,
}: {
  overdue: readonly ComingUpItem[];
  /** All overdue items found, which may exceed the ones listed. */
  overdueTotal: number;
  upcoming: readonly ComingUpItem[];
  windowDays: number;
  /** Said when a source returned its read cap. */
  incompleteSentence: string | null;
  /** Said when a source could not be read. Never rendered as "nothing due". */
  failedSentence: string | null;
  moreHref: string;
}) {
  const today = useToday();
  // Items the server dated in the future can already be past for a reader
  // whose day has ended; the browser's date moves them above today.
  const lateToday = today ? upcoming.filter((item) => isCalendarDayPast(item.dueOn, today)) : [];
  const ahead = today ? upcoming.filter((item) => !isCalendarDayPast(item.dueOn, today)) : upcoming;
  const late = [...overdue, ...lateToday];
  const lateTotal = overdueTotal + lateToday.length;

  return (
    <section className="dashboard-panel" aria-labelledby="dashboard-coming-up">
      <header className="dashboard-panel-header">
        <h2 id="dashboard-coming-up" className="dashboard-panel-title">
          Coming up
        </h2>
        <span className="dashboard-panel-aside">Next {windowDays} days</span>
      </header>

      {failedSentence ? (
        <p className="dashboard-read-failed" role="status">
          {failedSentence}
        </p>
      ) : null}

      {late.length > 0 ? (
        <div className="dashboard-rail-late">
          <p className="dashboard-rail-late-count">
            <CalendarClock className="h-4 w-4" aria-hidden="true" />
            {lateTotal === 1 ? "1 item overdue" : `${lateTotal} items overdue`}
          </p>
          <ol className="dashboard-rail">
            {late.slice(0, 3).map((item) => (
              <Row key={item.key} item={item} today={today} overdue />
            ))}
          </ol>
        </div>
      ) : null}

      <ol className="dashboard-rail" aria-label="Upcoming dates">
        <li className="dashboard-rail-today" aria-hidden={today ? undefined : "true"}>
          Today
        </li>
        {ahead.flatMap((item, index) => {
          const month = item.dueOn.slice(0, 7);
          const row = <Row key={item.key} item={item} today={today} overdue={false} />;
          if (index > 0 && ahead[index - 1].dueOn.slice(0, 7) === month) return [row];
          return [
            <li key={`month-${month}`} className="dashboard-rail-month">
              {monthLabel(item.dueOn)}
            </li>,
            row,
          ];
        })}
      </ol>

      {ahead.length === 0 && !failedSentence ? (
        <p className="dashboard-empty">Nothing is due in the next {windowDays} days.</p>
      ) : null}

      {incompleteSentence ? <p className="dashboard-note">{incompleteSentence}</p> : null}

      <Link href={moreHref} className="dashboard-more-link">
        {lateTotal > 3 ? `${lateTotal - 3} more overdue in My Work` : "Everything in My Work"}
      </Link>
    </section>
  );
}
