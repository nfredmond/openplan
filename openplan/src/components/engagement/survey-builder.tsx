"use client";

import { useState } from "react";
import { Loader2, Plus, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  SURVEY_CONDITION_OPERATORS_BY_TYPE,
  SURVEY_QUESTION_TYPES,
  SURVEY_CONDITION_OPERATORS_LIST,
  SURVEY_QUESTION_TYPES_LIST,
  conditionValueIsNumber,
  conditionValueIsOptionId,
  type SurveyConditionOperator,
  type SurveyQuestionType,
} from "@/lib/engagement/survey";

const SELECT_CLASS =
  "flex h-11 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
const LABEL_CLASS = "text-[0.82rem] font-semibold text-foreground";
const ERROR_CLASS =
  "rounded-[0.5rem] border border-red-300/80 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200";

type OptionRow = { id: string; question_id: string; label: string; value: string | null; is_active: boolean; sort_order: number; metadata_json: Record<string, unknown> };
type QuestionRow = {
  id: string;
  campaign_id: string;
  category_id: string | null;
  question_type: SurveyQuestionType;
  prompt: string;
  help_text: string | null;
  required: boolean;
  is_active: boolean;
  /**
   * 'draft' means written but never shown to anybody — the state the Planner
   * Agent's proposals land in. `null` is a database that predates the column,
   * where every stored question is live.
   */
  status?: "draft" | "published" | null;
  sort_order: number;
  config_json: Record<string, unknown>;
  options?: OptionRow[];
};

/** A question the public is being asked, as opposed to one merely written. */
function isDraft(question: QuestionRow): boolean {
  return question.status === "draft";
}
type Category = { id: string; label: string };

async function api(url: string, method: string, body?: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error((payload.error as string) || `Request failed (${res.status})`);
  return payload;
}

function num(value: string): number | undefined {
  const n = Number(value);
  return value.trim() === "" || Number.isNaN(n) ? undefined : n;
}

/** Compact per-type config editor — emits a partial config the routes validate. */
function ConfigEditor({ type, config, onChange }: { type: SurveyQuestionType; config: Record<string, unknown>; onChange: (next: Record<string, unknown>) => void }) {
  const set = (key: string, value: unknown) => onChange({ ...config, [key]: value });
  const bool = (key: string, label: string) => (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={Boolean(config[key])} onChange={(e) => set(key, e.target.checked)} /> {label}
    </label>
  );
  const numField = (key: string, label: string, placeholder = "") => (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <Input type="number" value={(config[key] as number | undefined) ?? ""} placeholder={placeholder} onChange={(e) => set(key, num(e.target.value))} />
    </label>
  );

  switch (type) {
    case "single_choice":
      return <div className="space-y-2">{bool("allow_other", "Allow an “other” free-text answer")}</div>;
    case "multiple_choice":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          {numField("min_select", "Min selections")}
          {numField("max_select", "Max selections")}
          <div className="sm:col-span-2">{bool("allow_other", "Allow an “other” answer")}</div>
        </div>
      );
    case "likert":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">Scale</span>
            <select className={SELECT_CLASS} value={(config.scale as number) ?? 5} onChange={(e) => set("scale", Number(e.target.value))}>
              <option value={5}>5-point</option>
              <option value={7}>7-point</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="text-muted-foreground">Point labels (comma-separated, must match scale — optional)</span>
            <Input
              value={Array.isArray(config.labels) ? (config.labels as string[]).join(", ") : ""}
              placeholder="Strongly disagree, Disagree, Neutral, Agree, Strongly agree"
              onChange={(e) => {
                const labels = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
                set("labels", labels.length ? labels : undefined);
              }}
            />
          </label>
        </div>
      );
    case "rating":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          {numField("max", "Max rating (2–10)", "5")}
          {bool("allow_half", "Allow half steps")}
        </div>
      );
    case "ranking":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          {numField("max_ranked", "Max items to rank")}
          {bool("require_full", "Require ranking every option")}
        </div>
      );
    case "map_point":
      return (
        <div className="space-y-2">
          <span className="text-sm text-muted-foreground">Allowed geometry</span>
          <div className="flex flex-wrap gap-3">
            {(["Point", "LineString", "Polygon"] as const).map((g) => {
              const current = Array.isArray(config.geometry_types) ? (config.geometry_types as string[]) : ["Point"];
              return (
                <label key={g} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={current.includes(g)}
                    onChange={(e) => {
                      const next = e.target.checked ? [...new Set([...current, g])] : current.filter((x) => x !== g);
                      set("geometry_types", next.length ? next : ["Point"]);
                    }}
                  />
                  {g}
                </label>
              );
            })}
          </div>
        </div>
      );
    case "budget_allocation":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          {numField("total", "Total budget", "1000")}
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">Unit</span>
            <select className={SELECT_CLASS} value={(config.unit as string) ?? "usd"} onChange={(e) => set("unit", e.target.value)}>
              <option value="usd">Dollars</option>
              <option value="points">Points</option>
              <option value="percent">Percent</option>
            </select>
          </label>
          <div className="sm:col-span-2">{bool("must_allocate_all", "Require the full budget be allocated")}</div>
        </div>
      );
    case "free_text":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          {numField("min_length", "Min length")}
          {numField("max_length", "Max length (≤5000)", "2000")}
        </div>
      );
    case "file_upload":
      return <div className="grid gap-3 sm:grid-cols-2">{numField("max_files", "Max files (≤5)", "1")}</div>;
    default:
      return null;
  }
}

function OptionManager({ campaignId, question, onChange }: { campaignId: string; question: QuestionRow; onChange: (options: OptionRow[]) => void }) {
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const options = question.options ?? [];
  const base = `/api/engagement/campaigns/${campaignId}/survey/questions/${question.id}/options`;

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim()) return;
    setError(null);
    setBusy(true);
    try {
      const payload = await api(base, "POST", { label: label.trim() });
      onChange([...options, payload.option as OptionRow]);
      setLabel("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add option");
    } finally {
      setBusy(false);
    }
  }
  async function remove(optionId: string) {
    setError(null);
    try {
      await api(`${base}/${optionId}`, "DELETE");
      onChange(options.filter((o) => o.id !== optionId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove option");
    }
  }

  return (
    <div className="space-y-2">
      <p className={LABEL_CLASS}>Options</p>
      {options.length === 0 ? <p className="text-sm text-muted-foreground">No options yet.</p> : null}
      <ul className="space-y-1">
        {options.map((option) => (
          <li key={option.id} className="flex items-center justify-between gap-2 rounded-lg border border-border/60 px-3 py-1.5 text-sm">
            <span>{option.label}</span>
            <Button type="button" variant="ghost" size="icon-xs" aria-label={`Remove ${option.label}`} onClick={() => void remove(option.id)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="flex items-center gap-2">
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Add an option label" />
        <Button type="submit" variant="outline" size="sm" disabled={busy || !label.trim()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add
        </Button>
      </form>
      {error ? <p className={ERROR_CLASS}>{error}</p> : null}
    </div>
  );
}


/** What each operator means, in the words an operator would use. */
const CONDITION_OPERATOR_LABELS: Record<SurveyConditionOperator, string> = {
  answered: "was answered",
  not_answered: "was not answered",
  equals: "is",
  not_equals: "is not",
  includes: "includes",
  gte: "is at least",
  lte: "is at most",
};

const VALUE_FREE_OPERATORS: SurveyConditionOperator[] = ["answered", "not_answered"];

/** A condition as it exists WHILE it is being written, which is not yet valid. */
type DraftCondition = { question_id: string; operator: SurveyConditionOperator; value?: string | number };

/**
 * READ A HALF-WRITTEN CONDITION, which `readSurveyVisibilityCondition` will not.
 *
 * That function answers "is this a condition the server can evaluate", and the
 * honest answer for a condition mid-authoring is NO — an operator who has picked
 * "is" but not yet picked WHICH option has written something the schema rejects,
 * because `value` must be a non-empty string or a number. Deriving the editor's
 * own state from the strict parser therefore made every value-carrying condition
 * unauthorable: the moment the operator chose "is", "is not", "includes", "at
 * least" or "at most", the parse failed, the editor read back `null`, and their
 * chosen question silently reverted to "Always show it" in front of them. Only
 * "was answered" and "was not answered" could ever be saved.
 *
 * So the EDITOR reads leniently and the SERVER stays strict. What is still
 * missing is named on screen rather than discovered as a rejected save, and
 * `validateSurveyConfig` remains the only thing that decides what may be stored.
 */
function readDraftCondition(config: Record<string, unknown>): DraftCondition | null {
  const raw = config.visible_when;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.question_id !== "string") return null;
  const operator = SURVEY_CONDITION_OPERATORS_LIST.find((candidate) => candidate === record.operator);
  if (!operator) return null;
  const value =
    typeof record.value === "string" || typeof record.value === "number" ? record.value : undefined;
  return { question_id: record.question_id, operator, value };
}

/**
 * WHEN THIS QUESTION APPLIES — the authoring half of conditional logic.
 *
 * Only questions ABOVE this one are offered, which is the same rule the API
 * refuses a violation of: a respondent reaching question 3 has not answered
 * question 7, so a condition pointing forward is a question that never appears.
 * Enforcing it in the picker means the operator meets the rule as a shorter list
 * rather than as an error message — the server still refuses it, because a
 * reorder can turn a valid backward reference into a forward one after the fact.
 *
 * The condition is stored in the question's own `config_json` under
 * `visible_when`, so it saves through the same PATCH as every other setting and
 * needs no separate write path.
 */
function ConditionEditor({
  earlier,
  config,
  onChange,
}: {
  earlier: QuestionRow[];
  config: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}) {
  const current = readDraftCondition(config);
  const controller = earlier.find((q) => q.id === current?.question_id) ?? null;
  const allowedOperators = controller ? SURVEY_CONDITION_OPERATORS_BY_TYPE[controller.question_type] : [];
  const operator = current?.operator ?? "answered";
  // WHICH COMPARISON FIELD TO OFFER IS THE CONTROLLING QUESTION'S DECISION, not
  // the operator's, and it is read from the same two helpers the server
  // evaluates with. `is` against a single-choice question names an option; `is`
  // against a Likert or rating question names a number on the scale, and those
  // types carry no options at all — deciding from the operator alone offered an
  // empty option dropdown for a condition that could then never be saved.
  const needsOption = controller ? conditionValueIsOptionId(controller.question_type, operator) : false;
  const needsNumber = controller ? conditionValueIsNumber(controller.question_type, operator) : false;
  const controllerOptions = (controller?.options ?? []).filter((option) => option.is_active);
  // A comparison with no value yet is refused by the API (the schema requires
  // one), so it is named here rather than met as "Invalid config" after a save.
  const valueMissing =
    controller !== null &&
    !VALUE_FREE_OPERATORS.includes(operator) &&
    (needsOption ? typeof current?.value !== "string" || current.value === "" : typeof current?.value !== "number");

  function write(next: { question_id: string; operator: SurveyConditionOperator; value?: string | number } | null) {
    const rest = { ...config };
    if (!next) {
      delete rest.visible_when;
      onChange(rest);
      return;
    }
    onChange({ ...rest, visible_when: next });
  }

  function chooseController(questionId: string) {
    if (!questionId) return write(null);
    // A new controller resets the comparison: an operator or an option id
    // carried over from another question is a condition that cannot be true.
    write({ question_id: questionId, operator: "answered" });
  }

  function chooseOperator(nextOperator: SurveyConditionOperator) {
    if (!current) return;
    // No placeholder value. An operator that needs one starts WITHOUT one and is
    // told so (`valueMissing` below) — writing an empty string instead made the
    // whole condition unparseable, which is what erased the operator's work.
    write({ question_id: current.question_id, operator: nextOperator });
  }

  if (earlier.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        This is the first question in the survey, so there is no earlier answer it could depend on.
      </p>
    );
  }

  return (
    <div className="space-y-2 rounded-[0.5rem] border border-border/60 p-3">
      <p className={LABEL_CLASS}>When this question applies</p>
      <p className="text-xs text-muted-foreground">
        Leave this unset and every respondent sees the question. Set it and only the respondents whose earlier
        answer matches are asked.
      </p>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted-foreground">Show this question only when</span>
        <select className={SELECT_CLASS} value={current?.question_id ?? ""} onChange={(e) => chooseController(e.target.value)}>
          <option value="">Always show it</option>
          {earlier.map((q) => (
            <option key={q.id} value={q.id}>
              {q.prompt}
            </option>
          ))}
        </select>
      </label>
      {current && controller ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">…that answer</span>
            <select
              className={SELECT_CLASS}
              value={operator}
              onChange={(e) => chooseOperator(e.target.value as SurveyConditionOperator)}
            >
              {allowedOperators.map((op) => (
                <option key={op} value={op}>
                  {CONDITION_OPERATOR_LABELS[op]}
                </option>
              ))}
            </select>
          </label>
          {needsOption ? (
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">…this option</span>
              <select
                className={SELECT_CLASS}
                value={typeof current.value === "string" ? current.value : ""}
                onChange={(e) => write({ question_id: current.question_id, operator, value: e.target.value })}
              >
                <option value="">Choose an option</option>
                {controllerOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {needsNumber ? (
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">…this value</span>
              <Input
                type="number"
                value={typeof current.value === "number" ? current.value : ""}
                onChange={(e) => write({ question_id: current.question_id, operator, value: num(e.target.value) ?? 0 })}
              />
            </label>
          ) : null}
          {valueMissing ? (
            <p className="sm:col-span-2 text-xs text-red-700 dark:text-red-300">
              This condition needs something to compare against. Until it has one, the question would never appear.
            </p>
          ) : null}
        </div>
      ) : null}
      {current && !controller ? (
        <p className={ERROR_CLASS}>
          This question depends on a question that is no longer above it in the survey. Choose another, or set it
          back to “Always show it”.
        </p>
      ) : null}
    </div>
  );
}

function QuestionCard({ campaignId, question, earlier, onUpdate, onRemove }: { campaignId: string; question: QuestionRow; earlier: QuestionRow[]; onUpdate: (q: QuestionRow) => void; onRemove: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState(question.prompt);
  const [helpText, setHelpText] = useState(question.help_text ?? "");
  const [required, setRequired] = useState(question.required);
  const [config, setConfig] = useState<Record<string, unknown>>(question.config_json ?? {});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const def = SURVEY_QUESTION_TYPES[question.question_type];
  const base = `/api/engagement/campaigns/${campaignId}/survey/questions/${question.id}`;

  async function save() {
    setError(null);
    setBusy(true);
    try {
      const payload = await api(base, "PATCH", { prompt, helpText: helpText.trim() || null, required, config });
      onUpdate({ ...(payload.question as QuestionRow), options: question.options });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save question");
    } finally {
      setBusy(false);
    }
  }
  async function toggleArchive() {
    setError(null);
    try {
      const payload = await api(base, "PATCH", { isActive: !question.is_active });
      onUpdate({ ...(payload.question as QuestionRow), options: question.options });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update question");
    }
  }
  /**
   * The one control that puts a question in front of the public.
   *
   * It is a separate button from Save on purpose. Publishing is not an edit —
   * it is the moment wording written by somebody else, possibly by the Planner
   * Agent, becomes a question your agency is asking residents. Folding it into
   * Save would make it something that happens while doing something else.
   */
  async function togglePublished() {
    setError(null);
    try {
      const payload = await api(base, "PATCH", { status: isDraft(question) ? "published" : "draft" });
      onUpdate({ ...(payload.question as QuestionRow), options: question.options });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update question");
    }
  }
  async function del() {
    setError(null);
    try {
      await api(base, "DELETE");
      onRemove(question.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete question");
    }
  }

  return (
    <div className="module-record-row">
      <div className="flex items-start justify-between gap-3">
        <button type="button" className="flex flex-1 items-start gap-2 text-left" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? <ChevronDown className="mt-1 h-4 w-4 shrink-0" /> : <ChevronRight className="mt-1 h-4 w-4 shrink-0" />}
          <span className="flex-1">
            <span className="module-record-kicker">
              <StatusBadge tone="info">{def.label}</StatusBadge>
              {question.required ? <StatusBadge tone="warning">Required</StatusBadge> : null}
              {!question.is_active ? <StatusBadge tone="neutral">Archived</StatusBadge> : null}
              {isDraft(question) ? <StatusBadge tone="warning">Draft — not public</StatusBadge> : null}
            </span>
            <span className="mt-1 block font-medium text-foreground">{question.prompt}</span>
          </span>
        </button>
      </div>

      {open ? (
        <div className="mt-4 space-y-4 border-t border-border/60 pt-4">
          <label className="flex flex-col gap-1">
            <span className={LABEL_CLASS}>Prompt</span>
            <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={2} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={LABEL_CLASS}>Help text</span>
            <Input value={helpText} onChange={(e) => setHelpText(e.target.value)} placeholder="Optional guidance shown under the question" />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} /> Required
          </label>
          <ConfigEditor type={question.question_type} config={config} onChange={setConfig} />
          <ConditionEditor earlier={earlier} config={config} onChange={setConfig} />
          {def.usesOptions ? <OptionManager campaignId={campaignId} question={question} onChange={(options) => onUpdate({ ...question, options })} /> : null}
          {error ? <p className={ERROR_CLASS}>{error}</p> : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={() => void save()} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save
            </Button>
            <Button
              type="button"
              variant={isDraft(question) ? "default" : "outline"}
              size="sm"
              onClick={() => void togglePublished()}
            >
              {isDraft(question) ? "Publish to the public survey" : "Unpublish"}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => void toggleArchive()}>
              {question.is_active ? "Archive" : "Restore"}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => void del()}>
              <Trash2 className="h-4 w-4" /> Delete
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function EngagementSurveyBuilder({
  campaignId,
  categories,
  initialQuestions,
}: {
  campaignId: string;
  categories: Category[];
  initialQuestions: QuestionRow[];
}) {
  const [questions, setQuestions] = useState<QuestionRow[]>(initialQuestions);
  const [type, setType] = useState<SurveyQuestionType>("single_choice");
  const [prompt, setPrompt] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [required, setRequired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addQuestion(e: React.FormEvent) {
    e.preventDefault();
    if (!prompt.trim()) return;
    setError(null);
    setBusy(true);
    try {
      const payload = await api(`/api/engagement/campaigns/${campaignId}/survey/questions`, "POST", {
        questionType: type,
        prompt: prompt.trim(),
        required,
        sortOrder: questions.length,
        categoryId: categoryId || undefined,
      });
      setQuestions((prev) => [...prev, { ...(payload.question as QuestionRow), options: [] }]);
      setPrompt("");
      setRequired(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add question");
    } finally {
      setBusy(false);
    }
  }

  // "Live" is what a participant is actually asked: active AND published. The
  // count in the header used to say "active", which after drafts exist would
  // include questions nobody outside this workspace can see.
  const liveCount = questions.filter((q) => q.is_active && !isDraft(q)).length;
  const draftCount = questions.filter((q) => isDraft(q)).length;

  return (
    <article className="module-section-surface">
      <div className="module-section-header">
        <div className="module-section-heading">
          <p className="module-section-label">Survey builder</p>
          <h2 className="module-section-title">Survey &amp; form questions</h2>
          <p className="module-section-description">
            Build a structured survey participants answer alongside map comments. {liveCount} question
            {liveCount === 1 ? "" : "s"} on the public survey
            {draftCount > 0
              ? `, and ${draftCount} draft${draftCount === 1 ? "" : "s"} nobody outside this workspace can see`
              : ""}
            .
          </p>
        </div>
      </div>

      <div className="mt-5 space-y-3">
        {questions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No questions yet. Add your first below.</p>
        ) : (
          questions.map((question, index) => (
            <QuestionCard
              key={question.id}
              campaignId={campaignId}
              question={question}
              // Only questions a respondent reaches FIRST can gate this one —
              // and only ones a respondent reaches AT ALL, so a draft is not
              // offered as something to condition on. Publishing re-validates
              // the graph server-side, which is what catches a draft that was
              // gated on another draft before either went live.
              earlier={questions.slice(0, index).filter((q) => q.is_active && !isDraft(q))}
              onUpdate={(next) => setQuestions((prev) => prev.map((q) => (q.id === next.id ? next : q)))}
              onRemove={(id) => setQuestions((prev) => prev.filter((q) => q.id !== id))}
            />
          ))
        )}
      </div>

      <form onSubmit={addQuestion} className="mt-6 space-y-3 border-t border-border/60 pt-5">
        <p className={LABEL_CLASS}>Add a question</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">Type</span>
            <select className={SELECT_CLASS} value={type} onChange={(e) => setType(e.target.value as SurveyQuestionType)}>
              {SURVEY_QUESTION_TYPES_LIST.map((t) => (
                <option key={t} value={t}>{SURVEY_QUESTION_TYPES[t].label}</option>
              ))}
            </select>
          </label>
          {categories.length > 0 ? (
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">Section (optional)</span>
              <select className={SELECT_CLASS} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">No section</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
        <label className="flex flex-col gap-1">
          <span className={LABEL_CLASS}>Prompt</span>
          <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={2} placeholder="What would you like to ask?" />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} /> Required
        </label>
        {error ? <p className={ERROR_CLASS}>{error}</p> : null}
        <Button type="submit" disabled={busy || !prompt.trim()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add question
        </Button>
        {SURVEY_QUESTION_TYPES[type].usesOptions ? (
          <p className="text-xs text-muted-foreground">After adding, open the question to configure its options.</p>
        ) : null}
      </form>
    </article>
  );
}
