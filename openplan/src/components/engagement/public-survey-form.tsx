"use client";

import { useRef, useState, type FormEvent } from "react";
import { CheckCircle2, Loader2, Send, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { EngagementGeometry } from "@/lib/engagement/geometry";
import {
  SURVEY_QUESTION_TYPES,
  budgetConfigSchema,
  fileUploadConfigSchema,
  freeTextConfigSchema,
  likertConfigSchema,
  mapPointConfigSchema,
  multipleChoiceConfigSchema,
  rankingConfigSchema,
  ratingConfigSchema,
  singleChoiceConfigSchema,
  type SurveyQuestionType,
} from "@/lib/engagement/survey";
import { GeometryPickerMap, type EngagementDrawMode } from "./geometry-picker-map";

// ── Serializable participant-facing question shape (options folded in) ────────
export type PortalSurveyOption = { id: string; label: string; value: string | null };
export type PortalSurveyQuestion = {
  id: string;
  questionType: SurveyQuestionType;
  prompt: string;
  helpText: string | null;
  required: boolean;
  config: unknown; // raw config_json — re-parsed defensively per widget
  options: PortalSurveyOption[];
};

const SELECT_CLASS =
  "flex h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none focus-visible:border-primary/50 focus-visible:ring-3 focus-visible:ring-primary/20";

// Sentinel option_id used when a single/multiple-choice "Other" free-text is
// chosen. The submit route drops it (storing only other_text) so it is never
// tallied as a real option — see validateSurveyAnswer's single_choice branch.
const OTHER_SENTINEL = "__other__";

// GeoJSON geometry type → GeometryPickerMap draw mode.
const GEO_TYPE_TO_MODE: Record<"Point" | "LineString" | "Polygon", EngagementDrawMode> = {
  Point: "point",
  LineString: "line",
  Polygon: "area",
};

function cfgOf<T>(schema: { safeParse: (v: unknown) => { success: boolean; data?: T } }, raw: unknown): T {
  const parsed = schema.safeParse(raw ?? {});
  if (parsed.success && parsed.data !== undefined) return parsed.data;
  const withDefaults = schema.safeParse({});
  return (withDefaults.success ? withDefaults.data : ({} as T)) as T;
}

type WidgetProps<T = unknown> = {
  question: PortalSurveyQuestion;
  onChange: (answer: T | undefined) => void;
};

// ── single_choice ─────────────────────────────────────────────────────────────
function SingleChoiceWidget({ question, onChange }: WidgetProps) {
  const cfg = cfgOf<{ allow_other?: boolean }>(singleChoiceConfigSchema, question.config);
  const [selection, setSelection] = useState<string>("");
  const [otherText, setOtherText] = useState("");

  function emit(nextSelection: string, nextOther: string) {
    if (!nextSelection) return onChange(undefined);
    if (nextSelection === OTHER_SENTINEL) {
      return onChange(nextOther.trim() ? { option_id: OTHER_SENTINEL, other_text: nextOther } : undefined);
    }
    onChange({ option_id: nextSelection });
  }

  return (
    <div className="space-y-2">
      {question.options.map((option) => (
        <label key={option.id} className="flex cursor-pointer items-center gap-2.5 text-sm text-foreground">
          <input
            type="radio"
            name={question.id}
            className="h-4 w-4"
            checked={selection === option.id}
            onChange={() => {
              setSelection(option.id);
              emit(option.id, otherText);
            }}
          />
          <span>{option.label}</span>
        </label>
      ))}
      {cfg.allow_other ? (
        <div className="space-y-2">
          <label className="flex cursor-pointer items-center gap-2.5 text-sm text-foreground">
            <input
              type="radio"
              name={question.id}
              className="h-4 w-4"
              checked={selection === OTHER_SENTINEL}
              onChange={() => {
                setSelection(OTHER_SENTINEL);
                emit(OTHER_SENTINEL, otherText);
              }}
            />
            <span>Other</span>
          </label>
          {selection === OTHER_SENTINEL ? (
            <Input
              value={otherText}
              placeholder="Please specify"
              maxLength={500}
              onChange={(event) => {
                setOtherText(event.target.value);
                emit(OTHER_SENTINEL, event.target.value);
              }}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ── multiple_choice ───────────────────────────────────────────────────────────
function MultipleChoiceWidget({ question, onChange }: WidgetProps) {
  const cfg = cfgOf<{ allow_other?: boolean; min_select?: number; max_select?: number }>(
    multipleChoiceConfigSchema,
    question.config
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [otherChecked, setOtherChecked] = useState(false);
  const [otherText, setOtherText] = useState("");

  function emit(nextSelected: Set<string>, nextOtherChecked: boolean, nextOther: string) {
    const optionIds = [...nextSelected];
    const other = nextOtherChecked && nextOther.trim() ? nextOther : "";
    if (optionIds.length === 0 && !other) return onChange(undefined);
    onChange(other ? { option_ids: optionIds, other_text: other } : { option_ids: optionIds });
  }

  const hint =
    cfg.min_select !== undefined || cfg.max_select !== undefined
      ? `Select ${cfg.min_select !== undefined ? `at least ${cfg.min_select}` : ""}${
          cfg.min_select !== undefined && cfg.max_select !== undefined ? ", " : ""
        }${cfg.max_select !== undefined ? `at most ${cfg.max_select}` : ""}.`
      : null;

  return (
    <div className="space-y-2">
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {question.options.map((option) => (
        <label key={option.id} className="flex cursor-pointer items-center gap-2.5 text-sm text-foreground">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={selected.has(option.id)}
            onChange={(event) => {
              const next = new Set(selected);
              if (event.target.checked) next.add(option.id);
              else next.delete(option.id);
              setSelected(next);
              emit(next, otherChecked, otherText);
            }}
          />
          <span>{option.label}</span>
        </label>
      ))}
      {cfg.allow_other ? (
        <div className="space-y-2">
          <label className="flex cursor-pointer items-center gap-2.5 text-sm text-foreground">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={otherChecked}
              onChange={(event) => {
                setOtherChecked(event.target.checked);
                emit(selected, event.target.checked, otherText);
              }}
            />
            <span>Other</span>
          </label>
          {otherChecked ? (
            <Input
              value={otherText}
              placeholder="Please specify"
              maxLength={500}
              onChange={(event) => {
                setOtherText(event.target.value);
                emit(selected, otherChecked, event.target.value);
              }}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ── likert ────────────────────────────────────────────────────────────────────
function LikertWidget({ question, onChange }: WidgetProps) {
  const cfg = cfgOf<{ scale: 5 | 7; labels?: string[] }>(likertConfigSchema, question.config);
  const [value, setValue] = useState<number | null>(null);
  const points = Array.from({ length: cfg.scale }, (_, i) => i + 1);

  return (
    <div className="flex flex-wrap gap-2">
      {points.map((point) => {
        const label = cfg.labels?.[point - 1];
        const active = value === point;
        return (
          <button
            key={point}
            type="button"
            aria-pressed={active}
            onClick={() => {
              setValue(point);
              onChange({ value: point });
            }}
            className={cn(
              "flex min-h-11 min-w-[3.25rem] flex-col items-center justify-center gap-0.5 rounded-lg border px-3 py-2 text-sm font-semibold transition",
              active
                ? "border-[color:var(--pine)] bg-[color:var(--pine)]/10 text-foreground"
                : "border-border text-muted-foreground hover:border-[color:var(--pine)] hover:text-foreground"
            )}
          >
            <span>{point}</span>
            {label ? <span className="max-w-[7rem] text-center text-[0.65rem] font-medium leading-tight">{label}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

// ── rating ──────────────────────────────────────────────────────────────────
function RatingWidget({ question, onChange }: WidgetProps) {
  const cfg = cfgOf<{ max: number; allow_half?: boolean; icon?: "star" | "number" }>(ratingConfigSchema, question.config);
  const [value, setValue] = useState<number | null>(null);

  // Half-steps or a numeric icon render as a plain value picker (a star strip
  // cannot express half selections accessibly). Values start at 1 — the server
  // rejects any rating < 1 (VALUE_OUT_OF_RANGE), so 0.5 must never be offered.
  if (cfg.allow_half || cfg.icon === "number") {
    const steps: number[] = [];
    for (let v = 1; v <= cfg.max; v += cfg.allow_half ? 0.5 : 1) steps.push(v);
    return (
      <select
        className={SELECT_CLASS}
        value={value === null ? "" : String(value)}
        onChange={(event) => {
          const next = event.target.value === "" ? null : Number(event.target.value);
          setValue(next);
          onChange(next === null ? undefined : { value: next });
        }}
      >
        <option value="">Not rated</option>
        {steps.map((step) => (
          <option key={step} value={step}>
            {step} of {cfg.max}
          </option>
        ))}
      </select>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      {Array.from({ length: cfg.max }, (_, i) => i + 1).map((star) => {
        const active = value !== null && star <= value;
        return (
          <button
            key={star}
            type="button"
            aria-label={`${star} of ${cfg.max}`}
            aria-pressed={active}
            onClick={() => {
              const next = value === star ? null : star;
              setValue(next);
              onChange(next === null ? undefined : { value: next });
            }}
            className="rounded p-1 text-muted-foreground transition hover:text-amber-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            <Star className={cn("h-6 w-6", active ? "fill-amber-400 text-amber-400" : "")} />
          </button>
        );
      })}
      {value !== null ? (
        <span className="ml-2 text-sm text-muted-foreground">
          {value} of {cfg.max}
        </span>
      ) : null}
    </div>
  );
}

// ── ranking ──────────────────────────────────────────────────────────────────
function RankingWidget({ question, onChange }: WidgetProps) {
  const cfg = cfgOf<{ max_ranked?: number; require_full: boolean }>(rankingConfigSchema, question.config);
  const [ranks, setRanks] = useState<Record<string, number>>({});
  const rankCap = cfg.max_ranked ?? question.options.length;
  const maxRank = Math.min(rankCap, question.options.length);

  function emit(nextRanks: Record<string, number>) {
    const ordered = question.options
      .filter((option) => nextRanks[option.id] !== undefined && nextRanks[option.id] > 0)
      .sort((left, right) => nextRanks[left.id] - nextRanks[right.id])
      .map((option) => option.id);
    onChange(ordered.length ? { ranking: ordered } : undefined);
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {cfg.require_full ? "Rank every option." : `Rank up to ${rankCap} option${rankCap === 1 ? "" : "s"} (leave the rest unranked).`}
      </p>
      {question.options.map((option) => {
        const current = ranks[option.id];
        // Ranks already taken by OTHER options are hidden so two options can
        // never share a position — a tie would otherwise be emitted as a false
        // strict order (stable-sort tiebreak) and pass server validation.
        const takenByOthers = new Set(
          question.options
            .filter((other) => other.id !== option.id)
            .map((other) => ranks[other.id])
            .filter((rank): rank is number => rank !== undefined)
        );
        return (
          <div key={option.id} className="flex items-center justify-between gap-3">
            <span className="text-sm text-foreground">{option.label}</span>
            <select
              className="h-9 w-28 rounded-lg border border-input bg-background px-2.5 text-sm shadow-xs outline-none focus-visible:border-primary/50 focus-visible:ring-3 focus-visible:ring-primary/20"
              value={current ? String(current) : ""}
              onChange={(event) => {
                const next = { ...ranks };
                if (event.target.value === "") delete next[option.id];
                else next[option.id] = Number(event.target.value);
                setRanks(next);
                emit(next);
              }}
            >
              <option value="">—</option>
              {Array.from({ length: maxRank }, (_, i) => i + 1)
                .filter((rank) => rank === current || !takenByOthers.has(rank))
                .map((rank) => (
                  <option key={rank} value={rank}>
                    {rank}
                  </option>
                ))}
            </select>
          </div>
        );
      })}
    </div>
  );
}

// ── map_point ────────────────────────────────────────────────────────────────
function MapPointWidget({ question, onChange }: WidgetProps) {
  const cfg = cfgOf<{
    geometry_types: ("Point" | "LineString" | "Polygon")[];
    guidance?: string;
    center?: [number, number];
    zoom?: number;
  }>(mapPointConfigSchema, question.config);
  const [geometry, setGeometry] = useState<EngagementGeometry | null>(null);
  const [note, setNote] = useState("");

  const allowedModes = cfg.geometry_types.map((type) => GEO_TYPE_TO_MODE[type]);

  function emit(nextGeometry: EngagementGeometry | null, nextNote: string) {
    if (!nextGeometry) return onChange(undefined);
    onChange(nextNote.trim() ? { geometry: nextGeometry, note: nextNote } : { geometry: nextGeometry });
  }

  return (
    <div className="space-y-2">
      {cfg.guidance ? <p className="text-xs text-muted-foreground">{cfg.guidance}</p> : null}
      <div className="public-map-frame public-map-frame--editor">
        <GeometryPickerMap
          onGeometryChange={(next) => {
            setGeometry(next);
            emit(next, note);
          }}
          initialMode={allowedModes[0]}
          allowedModes={allowedModes}
          initialCenter={cfg.center}
          initialZoom={cfg.zoom}
        />
      </div>
      <Input
        value={note}
        placeholder="Add a short note about this location (optional)"
        maxLength={500}
        onChange={(event) => {
          setNote(event.target.value);
          emit(geometry, event.target.value);
        }}
      />
    </div>
  );
}

// ── budget_allocation ─────────────────────────────────────────────────────────
function BudgetWidget({ question, onChange }: WidgetProps) {
  const cfg = cfgOf<{ total: number; unit: "usd" | "points" | "percent"; must_allocate_all: boolean }>(
    budgetConfigSchema,
    question.config
  );
  const [amounts, setAmounts] = useState<Record<string, string>>({});

  const unitLabel = cfg.unit === "usd" ? "$" : cfg.unit === "percent" ? "%" : "pts";
  const sum = question.options.reduce((total, option) => total + (Number(amounts[option.id]) || 0), 0);
  const remaining = (cfg.total ?? 0) - sum;

  function emit(nextAmounts: Record<string, string>) {
    const allocations = question.options
      .map((option) => ({ option_id: option.id, amount: Number(nextAmounts[option.id]) || 0 }))
      .filter((allocation) => allocation.amount > 0);
    onChange(allocations.length ? { allocations } : undefined);
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Allocate {cfg.unit === "usd" ? "$" : ""}
        {(cfg.total ?? 0).toLocaleString()}
        {cfg.unit === "percent" ? "%" : cfg.unit === "points" ? " points" : ""} across the options
        {cfg.must_allocate_all ? " (allocate the full amount)" : ""}.
      </p>
      {question.options.map((option) => (
        <div key={option.id} className="flex items-center justify-between gap-3">
          <span className="text-sm text-foreground">{option.label}</span>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">{unitLabel}</span>
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              className="h-9 w-28"
              value={amounts[option.id] ?? ""}
              onChange={(event) => {
                const next = { ...amounts, [option.id]: event.target.value };
                setAmounts(next);
                emit(next);
              }}
            />
          </div>
        </div>
      ))}
      <p className={cn("text-xs", remaining < 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}>
        Allocated {sum.toLocaleString()} of {(cfg.total ?? 0).toLocaleString()} — {remaining.toLocaleString()} remaining.
      </p>
    </div>
  );
}

// ── free_text ────────────────────────────────────────────────────────────────
function FreeTextWidget({ question, onChange }: WidgetProps) {
  const cfg = cfgOf<{ max_length: number; min_length?: number; multiline: boolean }>(freeTextConfigSchema, question.config);
  const [text, setText] = useState("");

  function emit(next: string) {
    onChange(next.trim() ? { text: next } : undefined);
  }

  return (
    <div className="space-y-1">
      {cfg.multiline ? (
        <Textarea
          value={text}
          rows={4}
          maxLength={cfg.max_length}
          placeholder="Type your response"
          onChange={(event) => {
            setText(event.target.value);
            emit(event.target.value);
          }}
        />
      ) : (
        <Input
          value={text}
          maxLength={cfg.max_length}
          placeholder="Type your response"
          onChange={(event) => {
            setText(event.target.value);
            emit(event.target.value);
          }}
        />
      )}
      <p className="text-right text-xs text-muted-foreground">
        {text.length}/{cfg.max_length}
        {cfg.min_length ? ` · min ${cfg.min_length}` : ""}
      </p>
    </div>
  );
}

// ── file_upload ──────────────────────────────────────────────────────────────
type UploadedFile = { path: string; mime: string; size: number; original_name?: string };

function FileUploadWidget({ question, shareToken, onChange }: WidgetProps & { shareToken: string }) {
  const cfg = cfgOf<{ max_files: number; max_size_bytes: number; accept: string[] }>(fileUploadConfigSchema, question.config);
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function emit(next: UploadedFile[]) {
    onChange(next.length ? { files: next } : undefined);
  }

  async function handleFile(file: File | null) {
    setUploadError(null);
    if (!file) return;
    if (files.length >= cfg.max_files) {
      setUploadError(`Attach at most ${cfg.max_files} file${cfg.max_files === 1 ? "" : "s"}.`);
      return;
    }
    if (!cfg.accept.includes(file.type)) {
      setUploadError("Unsupported file type.");
      return;
    }
    if (file.size > cfg.max_size_bytes) {
      setUploadError("File exceeds the size limit.");
      return;
    }

    setUploading(true);
    try {
      const response = await fetch(`/api/engage/${shareToken}/photo-upload`, {
        method: "POST",
        headers: { "content-type": file.type },
        body: file,
      });
      const payload = (await response.json()) as { error?: string; photoPath?: string };
      if (!response.ok || !payload.photoPath) {
        throw new Error(payload.error || "Upload failed");
      }
      const next = [...files, { path: payload.photoPath, mime: file.type, size: file.size, original_name: file.name }];
      setFiles(next);
      emit(next);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function removeFile(path: string) {
    const next = files.filter((file) => file.path !== path);
    setFiles(next);
    emit(next);
  }

  return (
    <div className="space-y-2">
      {files.map((file) => (
        <div key={file.path} className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2 text-sm">
          <span className="truncate text-foreground">{file.original_name ?? file.path.split("/").pop()}</span>
          <button
            type="button"
            onClick={() => removeFile(file.path)}
            className="shrink-0 text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Remove
          </button>
        </div>
      ))}
      {files.length < cfg.max_files ? (
        <label className="flex cursor-pointer items-center gap-3">
          <input
            ref={inputRef}
            type="file"
            accept={cfg.accept.join(",")}
            disabled={uploading}
            className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-lg file:border file:border-border file:bg-background file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground hover:file:border-[color:var(--pine)]"
            onChange={(event) => void handleFile(event.target.files?.[0] ?? null)}
          />
          {uploading ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" /> : null}
        </label>
      ) : null}
      {uploadError ? <p className="text-xs text-destructive">{uploadError}</p> : null}
      <p className="text-xs text-muted-foreground">
        Up to {cfg.max_files} file{cfg.max_files === 1 ? "" : "s"} · JPEG, PNG, or WebP · max {Math.round(cfg.max_size_bytes / 1024 / 1024)} MB each.
      </p>
    </div>
  );
}

function QuestionField({
  question,
  shareToken,
  error,
  onChange,
}: {
  question: PortalSurveyQuestion;
  shareToken: string;
  error?: string;
  onChange: (answer: unknown) => void;
}) {
  const def = SURVEY_QUESTION_TYPES[question.questionType];

  function renderWidget() {
    switch (question.questionType) {
      case "single_choice":
        return <SingleChoiceWidget question={question} onChange={onChange} />;
      case "multiple_choice":
        return <MultipleChoiceWidget question={question} onChange={onChange} />;
      case "likert":
        return <LikertWidget question={question} onChange={onChange} />;
      case "rating":
        return <RatingWidget question={question} onChange={onChange} />;
      case "ranking":
        return <RankingWidget question={question} onChange={onChange} />;
      case "map_point":
        return <MapPointWidget question={question} onChange={onChange} />;
      case "budget_allocation":
        return <BudgetWidget question={question} onChange={onChange} />;
      case "free_text":
        return <FreeTextWidget question={question} onChange={onChange} />;
      case "file_upload":
        return <FileUploadWidget question={question} shareToken={shareToken} onChange={onChange} />;
      default:
        return null;
    }
  }

  return (
    <fieldset className="rounded-xl border border-border/60 p-4">
      <legend className="px-1 text-sm font-semibold text-foreground">
        {question.prompt}
        {question.required ? <span className="ml-1 text-red-600 dark:text-red-400">*</span> : null}
      </legend>
      {question.helpText ? <p className="mb-3 text-xs text-muted-foreground">{question.helpText}</p> : null}
      <div className="mt-1">{renderWidget()}</div>
      {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
      <p className="sr-only">{def?.label}</p>
    </fieldset>
  );
}

/**
 * Participant survey renderer. Collects one answer per question (each widget
 * emits the canonical answer_json shape that the submit route re-validates via
 * validateSurveyAnswer), then POSTs the whole response to the confined survey
 * submit path. Mirrors the comment SubmissionForm's honeypot + banner posture.
 */
export function PublicSurveyForm({
  shareToken,
  questions,
}: {
  shareToken: string;
  questions: PortalSurveyQuestion[];
}) {
  // Answers keyed by questionId; undefined = unanswered (skipped on submit).
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [submittedBy, setSubmittedBy] = useState("");
  const [website, setWebsite] = useState(""); // honeypot
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  // Remounts every widget on "submit another" so local widget state resets.
  const [formNonce, setFormNonce] = useState(0);

  function setAnswer(questionId: string, answer: unknown) {
    setAnswers((previous) => {
      if (answer === undefined) {
        const next = { ...previous };
        delete next[questionId];
        return next;
      }
      return { ...previous, [questionId]: answer };
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});

    const payloadAnswers = Object.entries(answers)
      .filter(([, answer]) => answer !== undefined)
      .map(([questionId, answer]) => ({ questionId, answer }));

    if (payloadAnswers.length === 0) {
      setError("Please answer at least one question.");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/engage/${shareToken}/survey/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          answers: payloadAnswers,
          submittedBy: submittedBy || undefined,
          website,
        }),
      });
      const payload = (await response.json()) as { error?: string; questionId?: string };
      if (!response.ok) {
        if (payload.questionId) {
          setFieldErrors({ [payload.questionId]: payload.error || "Please review this answer." });
        }
        throw new Error(payload.error || "Submission failed");
      }
      setSubmitted(true);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Submission failed");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="public-success-state">
        <CheckCircle2 className="mx-auto h-9 w-9 text-[color:var(--pine)]" />
        <h3 className="mt-4 text-xl font-semibold text-foreground">Your survey response has been received</h3>
        <div className="mt-3 space-y-2 text-sm text-muted-foreground">
          <p>Your response has been received by the project team.</p>
          <p>It will be reviewed before it is used in engagement summaries or project reporting.</p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="mt-5"
          onClick={() => {
            setSubmitted(false);
            setAnswers({});
            setSubmittedBy("");
            setWebsite("");
            setError(null);
            setFieldErrors({});
            setFormNonce((nonce) => nonce + 1);
          }}
        >
          Submit another response
        </Button>
      </div>
    );
  }

  return (
    <form className="public-form-shell" onSubmit={handleSubmit}>
      <div key={formNonce} className="space-y-4">
        {questions.map((question) => (
          <QuestionField
            key={question.id}
            question={question}
            shareToken={shareToken}
            error={fieldErrors[question.id]}
            onChange={(answer) => setAnswer(question.id, answer)}
          />
        ))}

        <div className="space-y-1.5">
          <label htmlFor="survey-submitted-by" className="text-sm font-medium text-foreground">
            Your name (optional)
          </label>
          <Input
            id="survey-submitted-by"
            value={submittedBy}
            maxLength={200}
            placeholder="Leave blank to respond anonymously"
            onChange={(event) => setSubmittedBy(event.target.value)}
          />
        </div>
      </div>

      {/* Honeypot — hidden from real users; bots fill it in. */}
      <div className="absolute -left-[9999px] opacity-0" aria-hidden="true">
        <label htmlFor="survey-website">Website</label>
        <input
          id="survey-website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(event) => setWebsite(event.target.value)}
        />
      </div>

      {error ? (
        <p className="mb-4 mt-4 rounded-xl border border-red-300/80 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </p>
      ) : null}

      <div className="mt-5 flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Responses are reviewed by the project team before they inform summaries or reporting.
        </p>
        <Button type="submit" disabled={isSubmitting} className="min-w-[13rem] justify-center">
          {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Submit survey
        </Button>
      </div>
    </form>
  );
}
