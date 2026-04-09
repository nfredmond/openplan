"use client";

import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { CheckCircle2, Info, Loader2, MapPinned, MessageSquare, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { LocationPickerMap } from "./location-picker-map";
import { LocationDisplayMap } from "./location-display-map";

type CategoryOption = {
  id: string;
  label: string;
  description: string | null;
};

type ApprovedItem = {
  id: string;
  categoryId: string | null;
  title: string | null;
  body: string;
  submittedBy: string | null;
  latitude: number | null;
  longitude: number | null;
  createdAt: string;
};

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
}: {
  shareToken: string;
  categories: CategoryOption[];
  helpfulInput: string;
}) {
  const [categoryId, setCategoryId] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [submittedBy, setSubmittedBy] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [website, setWebsite] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const parsedLat = latitude.trim() ? Number(latitude) : undefined;
    const parsedLng = longitude.trim() ? Number(longitude) : undefined;

    if ((latitude.trim() && Number.isNaN(parsedLat)) || (longitude.trim() && Number.isNaN(parsedLng))) {
      setError("Please enter valid coordinates.");
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/engage/${shareToken}/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          categoryId: categoryId || undefined,
          title: title || undefined,
          body,
          submittedBy: submittedBy || undefined,
          latitude: parsedLat,
          longitude: parsedLng,
          website,
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
            setLatitude("");
            setLongitude("");
            setWebsite("");
            setError(null);
          }}
        >
          Share another response
        </Button>
      </div>
    );
  }

  return (
    <form className="public-form-shell" onSubmit={handleSubmit}>
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
                  Location pin <span className="text-xs text-muted-foreground">(optional)</span>
                </label>
                <p className="text-xs text-muted-foreground">Click on the map to drop a pin if your input is about a specific spot.</p>
                <div className="public-map-frame public-map-frame--editor">
                  <LocationPickerMap
                    latitude={latitude}
                    longitude={longitude}
                    onLocationChange={(lat, lng) => {
                      setLatitude(lat);
                      setLongitude(lng);
                    }}
                  />
                </div>
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
              Picking a topic, adding a pin, or sharing your name can help the team review context, but the main note matters most.
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
  projectContext,
}: {
  shareToken: string;
  acceptingSubmissions: boolean;
  categories: CategoryOption[];
  approvedItems: ApprovedItem[];
  engagementType: string;
  projectContext?: {
    name: string;
    summary: string | null;
  } | null;
}) {
  const [activeTab, setActiveTab] = useState<"submit" | "feedback">(acceptingSubmissions ? "submit" : "feedback");

  const categoryMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const category of categories) {
      map.set(category.id, category.label);
    }
    return map;
  }, [categories]);

  const engagementGuidance = getEngagementGuidance(engagementType);

  return (
    <div className="public-content-grid public-content-grid--portal">
      <div className="public-surface">
        <div className="public-section-header border-b border-border/60 pb-4">
          <div>
            <p className="public-section-label">Public participation</p>
            <h2 className="public-section-title">{activeTab === "submit" ? "Share your input" : "Community feedback"}</h2>
          </div>
          <p className="public-section-description max-w-2xl">
            {activeTab === "submit"
              ? "Share a specific observation, issue, or idea related to this campaign. A short clear note is enough."
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
          <PortalTabButton
            active={activeTab === "feedback"}
            icon={<MessageSquare className="h-3.5 w-3.5" />}
            label="Community feedback"
            count={approvedItems.length}
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
                  <p className="public-fact-detail text-foreground">Takes about 2 to 3 minutes. One main response is required.</p>
                </div>
                <div className="public-fact">
                  <p className="public-fact-label">What happens next</p>
                  <p className="public-fact-detail text-foreground">The project team reviews submissions before using them in summaries or reporting.</p>
                </div>
              </div>

              <SubmissionForm shareToken={shareToken} categories={categories} helpfulInput={engagementGuidance.helpfulInput} />
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

          {activeTab === "feedback" ? (
            <>
              <div className="public-map-frame public-map-frame--display">
                <LocationDisplayMap
                  items={approvedItems.map((item) => ({
                    id: item.id,
                    latitude: item.latitude,
                    longitude: item.longitude,
                    title: item.title,
                    body: item.body,
                  }))}
                />
              </div>

              {approvedItems.length === 0 ? (
                <div className="public-success-state text-sm text-muted-foreground">
                  No community feedback has been published for this campaign yet.
                </div>
              ) : (
                <div className="public-ledger">
                  {approvedItems.map((item) => (
                    <article key={item.id} className="public-ledger-row public-ledger-row--feedback">
                      <div className="public-ledger-body">
                        <div className="public-ledger-meta-row text-xs text-muted-foreground">
                          {item.categoryId && categoryMap.has(item.categoryId) ? <span className="public-inline-label">{categoryMap.get(item.categoryId)}</span> : null}
                          {item.latitude !== null && item.longitude !== null ? (
                            <span className="inline-flex items-center gap-1">
                              <MapPinned className="h-3 w-3" />
                              Located
                            </span>
                          ) : null}
                          <span>{fmtDate(item.createdAt)}</span>
                          {item.submittedBy ? <span>by {item.submittedBy}</span> : null}
                        </div>
                        {item.title ? <h3 className="public-ledger-title">{item.title}</h3> : null}
                        <p className="public-ledger-copy whitespace-pre-wrap text-sm leading-relaxed text-foreground">{item.body}</p>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </>
          ) : null}
        </div>
      </div>

      <div className="space-y-5">
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
