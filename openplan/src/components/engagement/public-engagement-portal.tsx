"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { CheckCircle2, ClipboardCheck, ClipboardList, Info, Loader2, MapPinned, MessageSquare, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  engagementGeometryTypeLabel,
  readStoredEngagementGeometry,
  type EngagementGeometry,
} from "@/lib/engagement/geometry";
import { ENGAGEMENT_PHOTO_MAX_BYTES } from "@/lib/engagement/photo";
import {
  AGE_BANDS,
  HOUSEHOLD_TENURE,
  LANGUAGES,
  RACE_ETHNICITY,
  demographicLabel,
} from "@/lib/engagement/demographics";
import {
  TRANSLATION_LANGUAGES,
  TRANSLATION_LANGUAGE_LABELS,
  type TranslationLanguage,
} from "@/lib/engagement/translation";
import { GeometryPickerMap } from "./geometry-picker-map";
import { LocationDisplayMap } from "./location-display-map";
import { PublicSurveyForm, type PortalSurveyQuestion } from "./public-survey-form";
import { PublicCloseLoop, type PublicCloseLoopEntry } from "./public-close-loop";
import { PublicSubscribeForm } from "./public-subscribe-form";

const PUBLIC_SELECT_CLASS =
  "flex h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none focus-visible:border-primary/50 focus-visible:ring-3 focus-visible:ring-primary/20";

type CategoryOption = {
  id: string;
  label: string;
  description: string | null;
  color?: string | null;
};

type ApprovedItem = {
  id: string;
  categoryId: string | null;
  title: string | null;
  body: string;
  submittedBy: string | null;
  latitude: number | null;
  longitude: number | null;
  geometry?: unknown;
  votesCount?: number;
  parentItemId?: string | null;
  photoUrl?: string | null;
  createdAt: string;
};

export type ApprovedItemGrouping = {
  topLevel: ApprovedItem[];
  repliesByParent: Map<string, ApprovedItem[]>;
};

/**
 * E6 — split approved items into top-level comments and the replies nested under
 * them. A reply whose parent is not itself an approved top-level item (e.g. the
 * parent was un-approved after the reply cleared moderation) is dropped from the
 * public view rather than shown stripped of its context. Replies read oldest-
 * first so a thread flows chronologically. Preserves the caller's ordering of
 * top-level items (the loader sorts newest-first).
 */
export function groupApprovedItems(items: ApprovedItem[]): ApprovedItemGrouping {
  const topLevel = items.filter((item) => !item.parentItemId);
  const topLevelIds = new Set(topLevel.map((item) => item.id));
  const repliesByParent = new Map<string, ApprovedItem[]>();
  for (const item of items) {
    const parentId = item.parentItemId;
    if (!parentId || !topLevelIds.has(parentId)) continue; // top-level or orphaned
    const bucket = repliesByParent.get(parentId);
    if (bucket) bucket.push(item);
    else repliesByParent.set(parentId, [item]);
  }
  for (const bucket of repliesByParent.values()) {
    bucket.sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());
  }
  return { topLevel, repliesByParent };
}

function replyPreviewLabel(item: ApprovedItem): string {
  const source = item.title?.trim() || item.body.trim();
  return source.length > 60 ? `${source.slice(0, 60)}…` : source;
}

const PHOTO_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"];

function fmtDate(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString();
}

function getEngagementGuidance(engagementType: string): { helpfulInput: string; modeLabel: string } {
  switch (engagementType) {
    case "map_feedback":
      return {
        helpfulInput: "A specific location-based concern, opportunity, or idea tied to this project.",
        modeLabel: "Map-based community input",
      };
    case "meeting_intake":
      return {
        helpfulInput: "A specific issue, question, or idea that should be carried forward from this discussion.",
        modeLabel: "Meeting intake",
      };
    case "comment_collection":
    default:
      return {
        helpfulInput: "A specific concern, opportunity, or idea tied to this project.",
        modeLabel: "Community feedback collection",
      };
  }
}

function getItemLocationLabel(item: ApprovedItem): string | null {
  const geometry = readStoredEngagementGeometry(item.geometry ?? null);
  if (geometry) {
    if (geometry.type === "Point") return "Located";
    return `${engagementGeometryTypeLabel(geometry.type)} drawn`;
  }
  if (item.latitude !== null && item.longitude !== null) return "Located";
  return null;
}

function PortalTabButton({
  active,
  icon,
  label,
  count,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex min-h-11 items-center gap-2 border-b-2 px-1 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:ring-offset-2",
        active
          ? "border-[color:var(--pine)] text-foreground"
          : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
      )}
    >
      {icon}
      <span>{label}</span>
      {typeof count === "number" ? <span className="text-xs font-semibold text-muted-foreground">({count})</span> : null}
    </button>
  );
}

function SubmissionForm({
  shareToken,
  categories,
  helpfulInput,
  demographicsEnabled,
  parentItemId = null,
  replyingToLabel = null,
  onCancelReply,
}: {
  shareToken: string;
  categories: CategoryOption[];
  helpfulInput: string;
  demographicsEnabled: boolean;
  parentItemId?: string | null;
  replyingToLabel?: string | null;
  onCancelReply?: () => void;
}) {
  const [categoryId, setCategoryId] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [submittedBy, setSubmittedBy] = useState("");
  const [geometry, setGeometry] = useState<EngagementGeometry | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [website, setWebsite] = useState("");
  // E5a — optional self-reported demographics (only when the campaign opts in).
  const [ageBand, setAgeBand] = useState("");
  const [zip5, setZip5] = useState("");
  const [primaryLanguage, setPrimaryLanguage] = useState("");
  const [raceEthnicity, setRaceEthnicity] = useState<string[]>([]);
  const [householdTenure, setHouseholdTenure] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
    };
  }, [photoPreviewUrl]);

  function clearPhoto() {
    setPhotoFile(null);
    setPhotoError(null);
    setPhotoPreviewUrl((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return null;
    });
    if (photoInputRef.current) photoInputRef.current.value = "";
  }

  function handlePhotoChange(file: File | null) {
    setPhotoError(null);

    if (!file) {
      clearPhoto();
      return;
    }

    if (!PHOTO_CONTENT_TYPES.includes(file.type)) {
      clearPhoto();
      setPhotoError("Please choose a JPEG, PNG, or WebP image.");
      return;
    }

    if (file.size > ENGAGEMENT_PHOTO_MAX_BYTES) {
      clearPhoto();
      setPhotoError("Photo is too large. The limit is 5 MB.");
      return;
    }

    setPhotoFile(file);
    setPhotoPreviewUrl((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return URL.createObjectURL(file);
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      // Two-step photo flow: upload the raw image first, then reference the
      // returned storage path in the submission payload.
      let photoPath: string | undefined;
      if (photoFile) {
        const uploadResponse = await fetch(`/api/engage/${shareToken}/photo-upload`, {
          method: "POST",
          headers: { "content-type": photoFile.type },
          body: photoFile,
        });
        const uploadPayload = (await uploadResponse.json()) as { error?: string; photoPath?: string };
        if (!uploadResponse.ok || !uploadPayload.photoPath) {
          throw new Error(uploadPayload.error || "Photo upload failed");
        }
        photoPath = uploadPayload.photoPath;
      }

      const response = await fetch(`/api/engage/${shareToken}/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          categoryId: categoryId || undefined,
          parentItemId: parentItemId || undefined,
          title: title || undefined,
          body,
          submittedBy: submittedBy || undefined,
          geometry: geometry ?? undefined,
          photoPath,
          website,
          demographics: demographicsEnabled
            ? {
                ageBand: ageBand || undefined,
                zip5: /^\d{5}$/.test(zip5) ? zip5 : undefined,
                primaryLanguage: primaryLanguage || undefined,
                raceEthnicity: raceEthnicity.length ? raceEthnicity : undefined,
                householdTenure: householdTenure || undefined,
                consented: true,
              }
            : undefined,
        }),
      });

      const payload = (await response.json()) as { error?: string; message?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Submission failed");
      }

      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="public-success-state">
        <CheckCircle2 className="mx-auto h-9 w-9 text-[color:var(--pine)]" />
        <h3 className="mt-4 text-xl font-semibold text-foreground">Your input has been received</h3>
        <div className="mt-3 space-y-2 text-sm text-muted-foreground">
          <p>Your submission has been received by the project team.</p>
          <p>It may be reviewed, categorized, and included in engagement summaries or project reporting.</p>
          <p>Direct follow-up is not guaranteed unless the team chooses to reach back out.</p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="mt-5"
          onClick={() => {
            setSubmitted(false);
            setCategoryId("");
            setTitle("");
            setBody("");
            setSubmittedBy("");
            setGeometry(null);
            clearPhoto();
            setWebsite("");
            setAgeBand("");
            setZip5("");
            setPrimaryLanguage("");
            setRaceEthnicity([]);
            setHouseholdTenure("");
            setError(null);
            onCancelReply?.();
          }}
        >
          Share another response
        </Button>
      </div>
    );
  }

  return (
    <form className="public-form-shell" onSubmit={handleSubmit}>
      {replyingToLabel ? (
        <div className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-[color:var(--pine)]/40 bg-[color:var(--pine)]/5 px-3.5 py-2.5">
          <p className="text-sm text-foreground">
            <span className="font-semibold">Replying to:</span>{" "}
            <span className="text-muted-foreground">{replyingToLabel}</span>
          </p>
          {onCancelReply ? (
            <button
              type="button"
              onClick={onCancelReply}
              className="shrink-0 text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              Cancel reply
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="public-form-grid">
        <div className="divide-y divide-border/60">
          <section className="public-form-section">
            <div className="public-form-heading">
              <h3 className="public-section-label">Your input (required)</h3>
              <p className="text-sm text-muted-foreground">
                Share a specific issue, opportunity, or idea related to this campaign. A short clear note is enough.
              </p>
            </div>

            <div className="mt-4 space-y-1.5">
              <label htmlFor="public-body" className="text-sm font-medium">
                What would you like us to know? <span className="text-xs text-muted-foreground">(required)</span>
              </label>
              <Textarea
                id="public-body"
                rows={6}
                placeholder="Tell us what you noticed, where you are seeing it, and why it matters."
                value={body}
                onChange={(event) => setBody(event.target.value)}
                required
                maxLength={4000}
              />
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>This is the only required field in this form.</span>
                <span>{body.length}/4000 characters</span>
              </div>
            </div>
          </section>

          <section className="public-form-section">
            <div className="public-form-heading">
              <h3 className="public-section-label">Helpful context (optional)</h3>
              <p className="text-sm text-muted-foreground">
                These details help the team review and organize your input, but they are not required unless noted.
              </p>
            </div>

            <div className="mt-4 grid gap-4">
              {categories.length > 0 ? (
                <div className="space-y-1.5">
                  <label htmlFor="public-category" className="text-sm font-medium">
                    Topic <span className="text-xs text-muted-foreground">(optional)</span>
                  </label>
                  <select
                    id="public-category"
                    className="flex h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none focus-visible:border-primary/50 focus-visible:ring-3 focus-visible:ring-primary/20"
                    value={categoryId}
                    onChange={(event) => setCategoryId(event.target.value)}
                  >
                    <option value="">Select a topic</option>
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.label}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              <div className="space-y-1.5">
                <label htmlFor="public-title" className="text-sm font-medium">
                  Subject <span className="text-xs text-muted-foreground">(optional)</span>
                </label>
                <Input
                  id="public-title"
                  placeholder="Brief summary of your input"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  maxLength={160}
                />
              </div>

              <div className="space-y-2 pt-1">
                <label className="text-sm font-medium">
                  Map location <span className="text-xs text-muted-foreground">(optional)</span>
                </label>
                <p className="text-xs text-muted-foreground">
                  Drop a pin, trace a street or route as a line, or outline an area if your input is about a specific place.
                </p>
                <div className="public-map-frame public-map-frame--editor">
                  <GeometryPickerMap onGeometryChange={setGeometry} />
                </div>
                {geometry ? (
                  <p className="text-xs text-muted-foreground">
                    Attached map shape: {engagementGeometryTypeLabel(geometry.type)}
                  </p>
                ) : null}
              </div>

              <div className="space-y-1.5 pt-1">
                <label htmlFor="public-photo" className="text-sm font-medium">
                  Photo <span className="text-xs text-muted-foreground">(optional)</span>
                </label>
                <p className="text-xs text-muted-foreground">Attach one JPEG, PNG, or WebP photo up to 5 MB.</p>
                <input
                  id="public-photo"
                  ref={photoInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-lg file:border file:border-border file:bg-background file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-foreground hover:file:border-primary/50"
                  onChange={(event) => handlePhotoChange(event.target.files?.[0] ?? null)}
                />
                {photoError ? <p className="text-xs text-destructive">{photoError}</p> : null}
                {photoPreviewUrl ? (
                  <div className="flex items-center gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
                    <img
                      src={photoPreviewUrl}
                      alt="Preview of the attached photo"
                      className="h-24 w-24 rounded-lg border border-border object-cover"
                    />
                    <button
                      type="button"
                      className="text-xs font-medium text-destructive hover:underline"
                      onClick={clearPhoto}
                    >
                      Remove photo
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </section>

          <section className="public-form-section">
            <div className="public-form-heading">
              <h3 className="public-section-label">Follow-up (optional)</h3>
              <p className="text-sm text-muted-foreground">Add your name if you want the project team to know who sent this input.</p>
            </div>

            <div className="mt-4 space-y-1.5">
              <label htmlFor="public-name" className="text-sm font-medium">
                Your name <span className="text-xs text-muted-foreground">(optional)</span>
              </label>
              <Input
                id="public-name"
                placeholder="Name or alias"
                value={submittedBy}
                onChange={(event) => setSubmittedBy(event.target.value)}
                maxLength={200}
              />
            </div>
          </section>

          {demographicsEnabled ? (
            <section className="public-form-section">
              <div className="public-form-heading">
                <h3 className="public-section-label">About you (optional)</h3>
                <p className="text-sm text-muted-foreground">
                  A few optional questions help the team check whether outreach is reaching the whole
                  community. Every field is optional, shown only in aggregate (small groups are never
                  displayed), and never published alongside your comment.
                </p>
              </div>

              <div className="mt-4 grid gap-4">
                <div className="space-y-1.5">
                  <label htmlFor="demo-age" className="text-sm font-medium">
                    Age range <span className="text-xs text-muted-foreground">(optional)</span>
                  </label>
                  <select id="demo-age" className={PUBLIC_SELECT_CLASS} value={ageBand} onChange={(event) => setAgeBand(event.target.value)}>
                    <option value="">Prefer not to say</option>
                    {AGE_BANDS.filter((band) => band !== "prefer_not_to_say").map((band) => (
                      <option key={band} value={band}>
                        {demographicLabel(band)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="demo-zip" className="text-sm font-medium">
                    ZIP code <span className="text-xs text-muted-foreground">(optional)</span>
                  </label>
                  <Input
                    id="demo-zip"
                    inputMode="numeric"
                    placeholder="e.g. 95945"
                    value={zip5}
                    onChange={(event) => setZip5(event.target.value.replace(/\D/g, "").slice(0, 5))}
                    maxLength={5}
                  />
                  <p className="text-xs text-muted-foreground">Only the first 3 digits are ever stored.</p>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="demo-language" className="text-sm font-medium">
                    Primary language <span className="text-xs text-muted-foreground">(optional)</span>
                  </label>
                  <select id="demo-language" className={PUBLIC_SELECT_CLASS} value={primaryLanguage} onChange={(event) => setPrimaryLanguage(event.target.value)}>
                    <option value="">Prefer not to say</option>
                    {LANGUAGES.filter((language) => language !== "prefer_not_to_say").map((language) => (
                      <option key={language} value={language}>
                        {demographicLabel(language)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="demo-tenure" className="text-sm font-medium">
                    Do you rent or own your home? <span className="text-xs text-muted-foreground">(optional)</span>
                  </label>
                  <select id="demo-tenure" className={PUBLIC_SELECT_CLASS} value={householdTenure} onChange={(event) => setHouseholdTenure(event.target.value)}>
                    <option value="">Prefer not to say</option>
                    {HOUSEHOLD_TENURE.filter((tenure) => tenure !== "prefer_not_to_say").map((tenure) => (
                      <option key={tenure} value={tenure}>
                        {demographicLabel(tenure)}
                      </option>
                    ))}
                  </select>
                </div>

                <fieldset className="space-y-1.5">
                  <legend className="text-sm font-medium">
                    Race / ethnicity <span className="text-xs text-muted-foreground">(optional, select any)</span>
                  </legend>
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {RACE_ETHNICITY.filter((race) => race !== "prefer_not_to_say").map((race) => (
                      <label key={race} className="flex items-center gap-2 text-sm text-muted-foreground">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-input"
                          checked={raceEthnicity.includes(race)}
                          onChange={(event) =>
                            setRaceEthnicity((previous) =>
                              event.target.checked ? [...previous, race] : previous.filter((value) => value !== race)
                            )
                          }
                        />
                        {demographicLabel(race)}
                      </label>
                    ))}
                  </div>
                </fieldset>
              </div>
            </section>
          ) : null}
        </div>

        <aside className="public-form-rail">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Info className="h-4 w-4 text-[color:var(--accent)]" />
              Before you submit
            </h3>
            <ul className="public-bullet-list public-bullet-list--compact mt-3 text-sm text-muted-foreground">
              <li>
                <strong className="text-foreground">What helps most:</strong> {helpfulInput}
              </li>
              <li>Expect a short response flow with one required note and a few optional context fields.</li>
              <li>Input may be categorized and included in engagement summaries or project reporting.</li>
              <li>Direct follow-up is not guaranteed unless the project team chooses to contact you.</li>
            </ul>
          </div>

          <div className="public-note-block">
            <p className="public-section-label">Optional fields</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Picking a topic, marking a place as a point, line, or area, attaching a photo, or sharing your name can help the team review context, but the main note matters most.
            </p>
          </div>
        </aside>
      </div>

      <div className="public-form-footer">
        {error ? (
          <p className="mb-4 rounded-xl border border-red-300/80 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
            {error}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">Your submission goes to the project team for review before any public publication.</p>
          <Button type="submit" disabled={isSubmitting} className="min-w-[13rem] justify-center">
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Submit feedback
          </Button>
        </div>
      </div>

      <div className="absolute -left-[9999px] opacity-0" aria-hidden="true">
        <label htmlFor="public-website">Website</label>
        <input
          id="public-website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(event) => setWebsite(event.target.value)}
        />
      </div>
    </form>
  );
}

export function PublicEngagementPortal({
  shareToken,
  acceptingSubmissions,
  categories,
  approvedItems,
  engagementType,
  demographicsEnabled = false,
  projectContext,
  surveyQuestions = [],
  closeLoopEntries = [],
  emailUpdatesAvailable = false,
}: {
  shareToken: string;
  acceptingSubmissions: boolean;
  categories: CategoryOption[];
  approvedItems: ApprovedItem[];
  engagementType: string;
  demographicsEnabled?: boolean;
  projectContext?: {
    name: string;
    summary: string | null;
  } | null;
  surveyQuestions?: PortalSurveyQuestion[];
  closeLoopEntries?: PublicCloseLoopEntry[];
  emailUpdatesAvailable?: boolean;
}) {
  const hasSurvey = surveyQuestions.length > 0;
  const hasCloseLoop = closeLoopEntries.length > 0;
  const [activeTab, setActiveTab] = useState<"submit" | "feedback" | "survey" | "closeloop">(
    acceptingSubmissions ? "submit" : "feedback"
  );
  const [sortOrder, setSortOrder] = useState<"newest" | "most_supported">("newest");
  const [supportedItemIds, setSupportedItemIds] = useState<Set<string>>(new Set());
  const [voteCounts, setVoteCounts] = useState<Record<string, number>>({});
  // E6 — the top-level comment the participant is replying to (null = a new
  // top-level submission). Set from a "Reply" button in the feed.
  const [replyTarget, setReplyTarget] = useState<{ id: string; label: string } | null>(null);
  // E8 — per-comment machine translation (null language = show original).
  const [translations, setTranslations] = useState<
    Record<string, { language: TranslationLanguage; text: string | null; status: "loading" | "done" | "unavailable" }>
  >({});

  const supportedStorageKey = `openplan-engagement-supported-${shareToken}`;

  // localStorage memory of supported items is a soft client hint only — the
  // server-side unique constraint is the real idempotency guard.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(supportedStorageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        setSupportedItemIds(new Set(parsed.filter((value): value is string => typeof value === "string")));
      }
    } catch {
      // Ignore unreadable local storage.
    }
  }, [supportedStorageKey]);

  const categoryMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const category of categories) {
      map.set(category.id, category.label);
    }
    return map;
  }, [categories]);

  const categoryColorMap = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const category of categories) {
      map.set(category.id, category.color ?? null);
    }
    return map;
  }, [categories]);

  const displayedVotes = (item: ApprovedItem): number => voteCounts[item.id] ?? item.votesCount ?? 0;

  // E6 — the feed is threaded: top-level comments with their approved replies
  // nested underneath. Sorting, the map, and counts operate on top-level items.
  const { topLevel, repliesByParent } = useMemo(() => groupApprovedItems(approvedItems), [approvedItems]);
  // Count only the replies actually rendered (orphans whose parent was later
  // un-approved are dropped by groupApprovedItems), so the label can't overstate.
  const replyCount = useMemo(
    () => [...repliesByParent.values()].reduce((sum, bucket) => sum + bucket.length, 0),
    [repliesByParent]
  );

  function startReply(item: ApprovedItem) {
    setReplyTarget({ id: item.id, label: replyPreviewLabel(item) });
    setActiveTab("submit");
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function translateComment(itemId: string, language: TranslationLanguage) {
    setTranslations((previous) => ({ ...previous, [itemId]: { language, text: null, status: "loading" } }));
    try {
      const response = await fetch(`/api/engage/${shareToken}/items/${itemId}/translate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ language }),
      });
      const payload = (await response.json()) as { translated?: string | null; source?: string };
      if (!response.ok || payload.source === "unavailable" || typeof payload.translated !== "string") {
        setTranslations((previous) => ({ ...previous, [itemId]: { language, text: null, status: "unavailable" } }));
        return;
      }
      setTranslations((previous) => ({ ...previous, [itemId]: { language, text: payload.translated as string, status: "done" } }));
    } catch {
      setTranslations((previous) => ({ ...previous, [itemId]: { language, text: null, status: "unavailable" } }));
    }
  }

  function clearTranslation(itemId: string) {
    setTranslations((previous) => {
      const next = { ...previous };
      delete next[itemId];
      return next;
    });
  }

  const sortedItems = useMemo(() => {
    if (sortOrder === "newest") return topLevel;
    return [...topLevel].sort((left, right) => {
      const voteDelta =
        (voteCounts[right.id] ?? right.votesCount ?? 0) - (voteCounts[left.id] ?? left.votesCount ?? 0);
      if (voteDelta !== 0) return voteDelta;
      return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
    });
  }, [topLevel, sortOrder, voteCounts]);

  function persistSupported(next: Set<string>) {
    setSupportedItemIds(next);
    try {
      window.localStorage.setItem(supportedStorageKey, JSON.stringify([...next]));
    } catch {
      // Ignore unwritable local storage.
    }
  }

  async function supportItem(itemId: string): Promise<number | null> {
    if (supportedItemIds.has(itemId)) return null;

    const baseCount = voteCounts[itemId] ?? approvedItems.find((item) => item.id === itemId)?.votesCount ?? 0;

    // Optimistic update; the server response (including alreadyVoted replays)
    // settles the final count.
    persistSupported(new Set([...supportedItemIds, itemId]));
    setVoteCounts((previous) => ({ ...previous, [itemId]: baseCount + 1 }));

    try {
      const response = await fetch(`/api/engage/${shareToken}/items/${itemId}/vote`, { method: "POST" });
      const payload = (await response.json()) as { error?: string; votesCount?: number };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to record support");
      }
      const confirmed = typeof payload.votesCount === "number" ? payload.votesCount : baseCount + 1;
      setVoteCounts((previous) => ({ ...previous, [itemId]: confirmed }));
      return confirmed;
    } catch {
      setVoteCounts((previous) => ({ ...previous, [itemId]: baseCount }));
      const reverted = new Set(supportedItemIds);
      reverted.delete(itemId);
      persistSupported(reverted);
      return null;
    }
  }

  const engagementGuidance = getEngagementGuidance(engagementType);

  function renderComment(item: ApprovedItem, options: { isReply: boolean }) {
    const locationLabel = getItemLocationLabel(item);
    const supported = supportedItemIds.has(item.id);
    const replies = options.isReply ? [] : repliesByParent.get(item.id) ?? [];
    const translation = translations[item.id];

    return (
      <article
        key={item.id}
        className={`public-ledger-row public-ledger-row--feedback${options.isReply ? " public-ledger-row--reply" : ""}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="public-ledger-body">
            <div className="public-ledger-meta-row text-xs text-muted-foreground">
              {options.isReply ? <span className="public-inline-label">Reply</span> : null}
              {item.categoryId && categoryMap.has(item.categoryId) ? <span className="public-inline-label">{categoryMap.get(item.categoryId)}</span> : null}
              {locationLabel ? (
                <span className="inline-flex items-center gap-1">
                  <MapPinned className="h-3 w-3" />
                  {locationLabel}
                </span>
              ) : null}
              <span>{fmtDate(item.createdAt)}</span>
              {item.submittedBy ? <span>by {item.submittedBy}</span> : null}
            </div>
            {item.title ? <h3 className="public-ledger-title">{item.title}</h3> : null}
            <p className="public-ledger-copy whitespace-pre-wrap text-sm leading-relaxed text-foreground">{item.body}</p>
            {item.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- short-TTL signed URL from a private bucket
              <img
                src={item.photoUrl}
                alt="Photo attached to this community comment"
                className="mt-3 max-h-56 w-auto max-w-full rounded-lg border border-border/70"
              />
            ) : null}
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <label className="inline-flex items-center gap-1.5 text-muted-foreground">
                Translate
                <select
                  aria-label="Translate this comment"
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:border-primary/50 focus-visible:ring-3 focus-visible:ring-primary/20"
                  value={translation?.language ?? ""}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (!value) clearTranslation(item.id);
                    else void translateComment(item.id, value as TranslationLanguage);
                  }}
                >
                  <option value="">Original</option>
                  {TRANSLATION_LANGUAGES.map((language) => (
                    <option key={language} value={language}>
                      {TRANSLATION_LANGUAGE_LABELS[language]}
                    </option>
                  ))}
                </select>
              </label>
              {translation?.status === "loading" ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" /> : null}
            </div>
            {translation?.status === "done" && translation.text ? (
              <div className="mt-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{translation.text}</p>
                <p className="mt-1.5 text-[0.7rem] text-muted-foreground">
                  Machine translation — the original comment above is the authoritative record.
                </p>
              </div>
            ) : null}
            {translation?.status === "unavailable" ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Translation is unavailable right now. The original comment is shown above.
              </p>
            ) : null}
            {!options.isReply && acceptingSubmissions ? (
              <button
                type="button"
                onClick={() => startReply(item)}
                className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground transition hover:text-[color:var(--pine)]"
              >
                <MessageSquare className="h-3.5 w-3.5" /> Reply
              </button>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => void supportItem(item.id)}
            disabled={supported}
            aria-pressed={supported}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold text-foreground transition hover:border-[color:var(--pine)] hover:text-[color:var(--pine)] disabled:cursor-default disabled:opacity-70"
          >
            ▲ {supported ? "Supported" : "Support"} · {displayedVotes(item)}
          </button>
        </div>
        {replies.length > 0 ? (
          <div className="mt-3 space-y-2 border-l-2 border-border/50 pl-4">
            {replies.map((reply) => renderComment(reply, { isReply: true }))}
          </div>
        ) : null}
      </article>
    );
  }

  return (
    <div className="public-content-grid public-content-grid--portal">
      <div className="public-surface">
        <div className="public-section-header border-b border-border/60 pb-4">
          <div>
            <p className="public-section-label">Public participation</p>
            <h2 className="public-section-title">
              {activeTab === "submit"
                ? "Share your input"
                : activeTab === "survey"
                  ? "Survey"
                  : activeTab === "closeloop"
                    ? "You said / We did"
                    : "Community feedback"}
            </h2>
          </div>
          <p className="public-section-description max-w-2xl">
            {activeTab === "submit"
              ? "Share a specific observation, issue, or idea related to this campaign. A short clear note is enough."
              : activeTab === "survey"
                ? "Answer the project team's survey questions. Your responses are reviewed before they inform summaries or reporting."
                : activeTab === "closeloop"
                  ? "What the project team heard from the community, and how they responded."
                  : "Review approved community feedback that has already cleared project-team moderation for this campaign."}
          </p>
        </div>

        <div className="public-tab-strip">
          {acceptingSubmissions ? (
            <PortalTabButton
              active={activeTab === "submit"}
              icon={<Send className="h-3.5 w-3.5" />}
              label="Share your input"
              onClick={() => setActiveTab("submit")}
            />
          ) : null}
          {hasSurvey ? (
            <PortalTabButton
              active={activeTab === "survey"}
              icon={<ClipboardList className="h-3.5 w-3.5" />}
              label="Survey"
              count={surveyQuestions.length}
              onClick={() => setActiveTab("survey")}
            />
          ) : null}
          {hasCloseLoop ? (
            <PortalTabButton
              active={activeTab === "closeloop"}
              icon={<ClipboardCheck className="h-3.5 w-3.5" />}
              label="You said / We did"
              count={closeLoopEntries.length}
              onClick={() => setActiveTab("closeloop")}
            />
          ) : null}
          <PortalTabButton
            active={activeTab === "feedback"}
            icon={<MessageSquare className="h-3.5 w-3.5" />}
            label="Community feedback"
            count={topLevel.length}
            onClick={() => setActiveTab("feedback")}
          />
        </div>

        <div className="mt-5 space-y-5">
          {activeTab === "submit" && acceptingSubmissions ? (
            <>
              <div className="public-fact-grid public-fact-grid--three public-fact-grid--compact">
                <div className="public-fact">
                  <p className="public-fact-label">What helps most</p>
                  <p className="public-fact-detail text-foreground">{engagementGuidance.helpfulInput}</p>
                </div>
                <div className="public-fact">
                  <p className="public-fact-label">Time</p>
                  <p className="public-fact-detail text-foreground">Takes about 2–3 minutes. One main response is required.</p>
                </div>
                <div className="public-fact">
                  <p className="public-fact-label">What happens next</p>
                  <p className="public-fact-detail text-foreground">The project team reviews submissions before using them in summaries or reporting.</p>
                </div>
              </div>

              <SubmissionForm
                shareToken={shareToken}
                categories={categories}
                helpfulInput={engagementGuidance.helpfulInput}
                demographicsEnabled={demographicsEnabled}
                parentItemId={replyTarget?.id ?? null}
                replyingToLabel={replyTarget?.label ?? null}
                onCancelReply={replyTarget ? () => setReplyTarget(null) : undefined}
              />
            </>
          ) : null}

          {activeTab === "submit" && !acceptingSubmissions ? (
            <div className="public-success-state">
              <MessageSquare className="mx-auto h-8 w-8 text-muted-foreground" />
              <h3 className="mt-4 text-lg font-semibold text-foreground">Submissions closed</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                This engagement campaign is no longer accepting new submissions. You can still view approved community feedback.
              </p>
            </div>
          ) : null}

          {activeTab === "survey" && hasSurvey ? (
            acceptingSubmissions ? (
              <PublicSurveyForm shareToken={shareToken} questions={surveyQuestions} />
            ) : (
              <div className="public-success-state">
                <ClipboardList className="mx-auto h-8 w-8 text-muted-foreground" />
                <h3 className="mt-4 text-lg font-semibold text-foreground">Survey closed</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  This engagement campaign is no longer accepting survey responses.
                </p>
              </div>
            )
          ) : null}

          {activeTab === "closeloop" && hasCloseLoop ? <PublicCloseLoop entries={closeLoopEntries} /> : null}

          {activeTab === "feedback" ? (
            <>
              <div className="public-map-frame public-map-frame--display">
                <LocationDisplayMap
                  items={topLevel.map((item) => ({
                    id: item.id,
                    latitude: item.latitude,
                    longitude: item.longitude,
                    title: item.title,
                    body: item.body,
                    geometry: item.geometry,
                    votesCount: displayedVotes(item),
                    color: item.categoryId ? categoryColorMap.get(item.categoryId) ?? null : null,
                  }))}
                  onSupport={supportItem}
                  hasVoted={(itemId) => supportedItemIds.has(itemId)}
                />
              </div>

              {topLevel.length === 0 ? (
                <div className="public-success-state text-sm text-muted-foreground">
                  No community feedback has been published for this campaign yet.
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs text-muted-foreground">
                      {topLevel.length} published comment{topLevel.length === 1 ? "" : "s"}
                      {replyCount > 0 ? ` · ${replyCount} repl${replyCount === 1 ? "y" : "ies"}` : ""}
                    </p>
                    <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                      Sort by
                      <select
                        className="h-9 rounded-lg border border-input bg-background px-2.5 text-xs shadow-xs outline-none focus-visible:border-primary/50 focus-visible:ring-3 focus-visible:ring-primary/20"
                        value={sortOrder}
                        onChange={(event) => setSortOrder(event.target.value as "newest" | "most_supported")}
                      >
                        <option value="newest">Newest</option>
                        <option value="most_supported">Most supported</option>
                      </select>
                    </label>
                  </div>

                  <div className="public-ledger">
                    {sortedItems.map((item) => renderComment(item, { isReply: false }))}
                  </div>
                </>
              )}
            </>
          ) : null}
        </div>
      </div>

      <div className="space-y-5">
        {emailUpdatesAvailable ? (
          <article className="public-surface">
            <PublicSubscribeForm shareToken={shareToken} />
          </article>
        ) : null}
        {categories.length > 0 ? (
          <article className="public-surface">
            <div className="public-section-header">
              <div>
                <p className="public-section-label">Feedback topics</p>
                <h2 className="public-section-title">How the project team organizes input</h2>
              </div>
            </div>
            <div className="public-ledger">
              {categories.map((category) => (
                <div key={category.id} className="public-ledger-row">
                  <div className="public-ledger-body">
                    <h3 className="public-ledger-title">{category.label}</h3>
                    {category.description ? <p className="public-ledger-copy">{category.description}</p> : null}
                  </div>
                </div>
              ))}
            </div>
          </article>
        ) : null}

        <article className="public-rail">
          <div className="flex items-center gap-3">
            <span className="public-rail-icon">
              <Info className="h-5 w-5 text-sky-200" />
            </span>
            <div>
              <p className="public-rail-kicker">About this engagement</p>
              <h2 className="public-rail-title">{engagementGuidance.modeLabel}</h2>
            </div>
          </div>
          <p className="public-rail-copy">
            This public engagement portal is managed through OpenPlan. All submissions are reviewed by the project team before they appear publicly.
          </p>
          {projectContext ? (
            <div className="public-rail-context">
              <p className="public-rail-kicker">Linked project</p>
              <p className="mt-2 text-base font-semibold text-white">{projectContext.name}</p>
              {projectContext.summary ? <p className="mt-2 text-sm text-slate-300/84">{projectContext.summary}</p> : null}
            </div>
          ) : null}
          <div className="public-rail-list">
            <div className="public-rail-item">Your feedback helps inform planning decisions and can be carried into engagement summaries, project reporting, and other traceable planning materials.</div>
            <div className="public-rail-item">Published feedback is curated from approved submissions so the public page stays useful as a planning record.</div>
          </div>
        </article>
      </div>
    </div>
  );
}
