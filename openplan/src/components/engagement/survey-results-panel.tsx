import { StatusBadge } from "@/components/ui/status-badge";
import { SURVEY_QUESTION_TYPES, SURVEY_SMALL_SAMPLE_N } from "@/lib/engagement/survey";
import type { SurveyQuestionAggregation } from "@/lib/engagement/survey-responses";

// Presentational only — the page computes aggregateCampaignSurvey() with a
// service-role client (the sensitive reads stay confined to survey-responses.ts).

type Agg = { n: number; lowN: boolean };

function Bar({ label, value, pct, muted }: { label: string; value: string; pct: number; muted?: boolean }) {
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className={muted ? "text-muted-foreground" : "text-foreground"}>{label}</span>
        <span className="tabular-nums text-muted-foreground">{value}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-sky-500/70" style={{ width: `${Math.max(0, Math.min(100, pct * 100)).toFixed(1)}%` }} />
      </div>
    </div>
  );
}

function pctText(pct: number): string {
  return `${(pct * 100).toFixed(0)}%`;
}

function QuestionResult({ q }: { q: SurveyQuestionAggregation }) {
  const def = SURVEY_QUESTION_TYPES[q.questionType];
  const agg = q.aggregation as Agg;
  const lowN = agg?.lowN;

  return (
    <div className="module-record-row">
      <div className="module-record-kicker">
        <StatusBadge tone="info">{def?.label ?? q.questionType}</StatusBadge>
        <StatusBadge tone="neutral">{q.answeredCount} response{q.answeredCount === 1 ? "" : "s"}</StatusBadge>
      </div>
      <p className="mt-1 font-medium text-foreground">{q.prompt}</p>

      {lowN ? (
        <p className="mt-2 rounded-[0.5rem] border border-amber-300/70 bg-amber-50/70 px-3 py-2 text-xs text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200">
          Based on {agg.n} response{agg.n === 1 ? "" : "s"} — screening input, not a statistically representative sample (below {SURVEY_SMALL_SAMPLE_N}).
        </p>
      ) : null}

      <div className="mt-3 space-y-2.5">{renderBody(q)}</div>
    </div>
  );
}

function renderBody(q: SurveyQuestionAggregation) {
  switch (q.questionType) {
    case "single_choice":
    case "multiple_choice": {
      const a = q.aggregation as { rows: { option_id: string; label: string; count: number; pct: number }[]; otherTexts: string[] };
      return (
        <>
          {a.rows.map((r) => (
            <Bar key={r.option_id} label={r.label} value={`${r.count} · ${pctText(r.pct)}`} pct={r.pct} muted={r.count === 0} />
          ))}
          {a.otherTexts.length > 0 ? <p className="text-xs text-muted-foreground">“Other”: {a.otherTexts.slice(0, 5).join("; ")}{a.otherTexts.length > 5 ? "…" : ""}</p> : null}
        </>
      );
    }
    case "likert": {
      const a = q.aggregation as { mean: number | null; distribution: Record<number, number>; topBoxPct: number | null };
      const total = Object.values(a.distribution).reduce((s, c) => s + c, 0) || 1;
      return (
        <>
          <p className="text-sm text-muted-foreground">Mean <span className="font-semibold text-foreground">{a.mean?.toFixed(2) ?? "—"}</span>{a.topBoxPct !== null ? ` · top-box ${pctText(a.topBoxPct)}` : ""}</p>
          {Object.entries(a.distribution).map(([point, count]) => (
            <Bar key={point} label={`Point ${point}`} value={String(count)} pct={count / total} muted={count === 0} />
          ))}
        </>
      );
    }
    case "rating": {
      const a = q.aggregation as { mean: number | null; min: number | null; max: number | null };
      return <p className="text-sm text-muted-foreground">Mean <span className="font-semibold text-foreground">{a.mean?.toFixed(2) ?? "—"}</span>{a.min !== null ? ` · range ${a.min}–${a.max}` : ""}</p>;
    }
    case "ranking": {
      const a = q.aggregation as { rows: { option_id: string; label: string; bordaScore: number; meanRank: number | null; timesRanked: number }[]; partialCoverage: boolean };
      const maxScore = Math.max(1, ...a.rows.map((r) => r.bordaScore));
      return (
        <>
          {a.rows.map((r) => (
            <Bar key={r.option_id} label={r.label} value={`Borda ${r.bordaScore}${r.meanRank !== null ? ` · avg rank ${r.meanRank.toFixed(1)}` : ""}`} pct={r.bordaScore / maxScore} muted={r.timesRanked === 0} />
          ))}
          {a.partialCoverage ? <p className="text-xs text-muted-foreground">Some ballots ranked only a subset; Borda credits unranked options 0.</p> : null}
        </>
      );
    }
    case "budget_allocation": {
      const a = q.aggregation as { rows: { option_id: string; label: string; totalAllocated: number; pctOfPool: number }[]; pool: number; unit: string };
      return (
        <>
          <p className="text-xs text-muted-foreground">{a.pool.toLocaleString()} {a.unit} allocated across all responses.</p>
          {a.rows.map((r) => (
            <Bar key={r.option_id} label={r.label} value={`${r.totalAllocated.toLocaleString()} · ${pctText(r.pctOfPool)}`} pct={r.pctOfPool} muted={r.totalAllocated === 0} />
          ))}
        </>
      );
    }
    case "map_point": {
      const a = q.aggregation as { points: [number, number][]; clusterCount: number };
      return <p className="text-sm text-muted-foreground">{a.points.length} mapped point{a.points.length === 1 ? "" : "s"} in {a.clusterCount} approximate cluster{a.clusterCount === 1 ? "" : "s"} (screening-grade, ~0.5&nbsp;km grid).</p>;
    }
    case "free_text":
    case "file_upload": {
      const a = q.aggregation as { answered: number; sample: string[] };
      return (
        <ul className="space-y-1 text-sm text-muted-foreground">
          {a.sample.length === 0 ? <li>No responses yet.</li> : a.sample.map((text, i) => <li key={i} className="rounded-md border border-border/50 px-2 py-1">{text}</li>)}
          {a.answered > a.sample.length ? <li className="text-xs">…and {a.answered - a.sample.length} more.</li> : null}
        </ul>
      );
    }
    default:
      return null;
  }
}

export function EngagementSurveyResults({
  approvedResponseCount,
  questions,
}: {
  approvedResponseCount: number;
  questions: SurveyQuestionAggregation[];
}) {
  return (
    <article className="module-section-surface">
      <div className="module-section-header">
        <div className="module-section-heading">
          <p className="module-section-label">Survey results</p>
          <h2 className="module-section-title">Response summary</h2>
          <p className="module-section-description">
            {approvedResponseCount} approved response{approvedResponseCount === 1 ? "" : "s"}. Screening-grade tallies of moderated-in survey answers — not a statistically representative sample.
          </p>
        </div>
      </div>
      <div className="mt-5 space-y-4">
        {questions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active survey questions.</p>
        ) : (
          questions.map((q) => <QuestionResult key={q.questionId} q={q} />)
        )}
      </div>
    </article>
  );
}
