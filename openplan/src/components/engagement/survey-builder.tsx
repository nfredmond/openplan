"use client";

import { useState } from "react";
import { Loader2, Plus, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/ui/status-badge";
import { SURVEY_QUESTION_TYPES, SURVEY_QUESTION_TYPES_LIST, type SurveyQuestionType } from "@/lib/engagement/survey";

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
  sort_order: number;
  config_json: Record<string, unknown>;
  options?: OptionRow[];
};
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

function QuestionCard({ campaignId, question, onUpdate, onRemove }: { campaignId: string; question: QuestionRow; onUpdate: (q: QuestionRow) => void; onRemove: (id: string) => void }) {
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
          {def.usesOptions ? <OptionManager campaignId={campaignId} question={question} onChange={(options) => onUpdate({ ...question, options })} /> : null}
          {error ? <p className={ERROR_CLASS}>{error}</p> : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={() => void save()} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save
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

  const activeCount = questions.filter((q) => q.is_active).length;

  return (
    <article className="module-section-surface">
      <div className="module-section-header">
        <div className="module-section-heading">
          <p className="module-section-label">Survey builder</p>
          <h2 className="module-section-title">Survey &amp; form questions</h2>
          <p className="module-section-description">
            Build a structured survey participants answer alongside map comments. {activeCount} active question{activeCount === 1 ? "" : "s"}.
          </p>
        </div>
      </div>

      <div className="mt-5 space-y-3">
        {questions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No questions yet. Add your first below.</p>
        ) : (
          questions.map((question) => (
            <QuestionCard
              key={question.id}
              campaignId={campaignId}
              question={question}
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
