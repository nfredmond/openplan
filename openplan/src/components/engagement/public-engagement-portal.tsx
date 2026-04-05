"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, Loader2, MapPinned, MessageSquare, Send, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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

function SubmissionForm({
  shareToken,
  categories,
}: {
  shareToken: string;
  categories: CategoryOption[];
}) {
  const [categoryId, setCategoryId] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [submittedBy, setSubmittedBy] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  // Honeypot field — hidden from users, bots fill it
  const [website, setWebsite] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
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
      <div className="rounded-2xl border border-[color:var(--pine)]/30 bg-[color:var(--pine)]/5 p-6 text-center">
        <CheckCircle2 className="mx-auto mb-3 h-8 w-8 text-[color:var(--pine)]" />
        <h3 className="text-lg font-semibold">Your input has been received</h3>
        <div className="mt-3 space-y-2 text-sm text-muted-foreground">
          <p>Your submission has been received by the project team.</p>
          <p>
            It may be reviewed, categorized, and included in engagement summaries or project reporting.
          </p>
          <p>Direct follow-up is not guaranteed unless the team chooses to reach back out.</p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="mt-4"
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
    <form className="space-y-6" onSubmit={handleSubmit}>
      <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4 text-sm text-foreground space-y-2">
        <h3 className="font-semibold text-primary flex items-center gap-1.5 mb-2">
          <Info className="h-4 w-4" />
          Before you submit
        </h3>
        <p><strong>What we&apos;re looking for:</strong> Clear, specific observations or ideas connected to this project. We read every submission.</p>
        <p><strong>What&apos;s optional:</strong> Pinning a location on the map, picking a category, or adding your name. Your main note is what matters most.</p>
        <p><strong>What happens next:</strong> Submissions are reviewed by the project team for inclusion in public engagement reports and technical summaries.</p>
      </div>

      <section className="space-y-3 rounded-2xl border border-border/60 bg-background/70 p-4">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Your input (required)
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Share a specific issue, opportunity, or idea related to this campaign. A short clear note is enough.
          </p>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="public-body" className="text-sm font-medium">
            What would you like us to know? <span className="text-xs text-muted-foreground">(required)</span>
          </label>
          <Textarea
            id="public-body"
            rows={6}
            placeholder="Tell us what you noticed, where you are seeing it, and why it matters."
            value={body}
            onChange={(e) => setBody(e.target.value)}
            required
            maxLength={4000}
          />
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>This is the only required field in this form.</span>
            <span>{body.length}/4000 characters</span>
          </div>
        </div>
      </section>

      <section className="space-y-4 rounded-2xl border border-border/60 bg-background/70 p-4">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Helpful context (optional)
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            These details help the team review and organize your input, but they are not required unless noted.
          </p>
        </div>

        {categories.length > 0 && (
          <div className="space-y-1.5">
            <label htmlFor="public-category" className="text-sm font-medium">
              Topic <span className="text-xs text-muted-foreground">(optional)</span>
            </label>
            <select
              id="public-category"
              className="flex h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none focus-visible:border-primary/50 focus-visible:ring-3 focus-visible:ring-primary/20"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
            >
              <option value="">Select a topic</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="space-y-1.5">
          <label htmlFor="public-title" className="text-sm font-medium">
            Subject <span className="text-xs text-muted-foreground">(optional)</span>
          </label>
          <Input
            id="public-title"
            placeholder="Brief summary of your input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={160}
          />
        </div>

        <div className="space-y-1.5 pt-2">
          <label className="text-sm font-medium">
            Location pin <span className="text-xs text-muted-foreground">(optional)</span>
          </label>
          <p className="text-xs text-muted-foreground mb-2">
            Click on the map to drop a pin if your input is about a specific spot.
          </p>
          <LocationPickerMap
            latitude={latitude}
            longitude={longitude}
            onLocationChange={(lat, lng) => {
              setLatitude(lat);
              setLongitude(lng);
            }}
          />
        </div>
      </section>

      <section className="space-y-4 rounded-2xl border border-border/60 bg-background/70 p-4">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Follow-up (optional)
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Add your name if you want the project team to know who sent this input.
          </p>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="public-name" className="text-sm font-medium">
            Your name <span className="text-xs text-muted-foreground">(optional)</span>
          </label>
          <Input
            id="public-name"
            placeholder="Name or alias"
            value={submittedBy}
            onChange={(e) => setSubmittedBy(e.target.value)}
            maxLength={200}
          />
        </div>
      </section>

      {/* Honeypot: hidden from real users */}
      <div className="absolute -left-[9999px] opacity-0" aria-hidden="true">
        <label htmlFor="public-website">Website</label>
        <input
          id="public-website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
        />
      </div>

      {error && (
        <p className="rounded-xl border border-red-300/80 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </p>
      )}

      <div className="rounded-2xl border border-border/60 bg-muted/40 p-4 text-sm text-muted-foreground">
        <h3 className="font-semibold text-foreground">Before you submit</h3>
        <ul className="mt-2 space-y-1.5">
          <li>• Submissions may be reviewed before they appear in campaign summaries or public-facing materials.</li>
          <li>• Input may be categorized and included in engagement summaries or project reporting.</li>
          <li>• Direct follow-up is not guaranteed unless the project team chooses to contact you.</li>
        </ul>
      </div>

      <Button type="submit" disabled={isSubmitting} className="w-full sm:w-auto">
        {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        Submit feedback
      </Button>
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
    for (const c of categories) {
      map.set(c.id, c.label);
    }
    return map;
  }, [categories]);

  const engagementGuidance = getEngagementGuidance(engagementType);

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_1fr]">
      {/* Left: submission form or closed notice */}
      <div>
        <div className="mb-4 flex gap-2">
          {acceptingSubmissions && (
            <button
              type="button"
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                activeTab === "submit"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
              onClick={() => setActiveTab("submit")}
            >
              <Send className="mr-1.5 inline h-3.5 w-3.5" />
              Share your input
            </button>
          )}
          <button
            type="button"
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
              activeTab === "feedback"
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
            onClick={() => setActiveTab("feedback")}
          >
            <MessageSquare className="mr-1.5 inline h-3.5 w-3.5" />
            Community feedback ({approvedItems.length})
          </button>
        </div>

        {activeTab === "submit" && acceptingSubmissions && (
          <div className="rounded-2xl border border-border/70 bg-card p-6">
            <h2 className="mb-1 text-lg font-semibold">Share your input</h2>
            <p className="text-sm text-muted-foreground">
              Share a specific observation, issue, or idea related to this campaign. A short clear note is enough.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-border/60 bg-background/70 p-3">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">What helps most</p>
                <p className="mt-1 text-sm">{engagementGuidance.helpfulInput}</p>
              </div>
              <div className="rounded-xl border border-border/60 bg-background/70 p-3">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Time</p>
                <p className="mt-1 text-sm">Takes about 2–3 minutes. One main response is required.</p>
              </div>
              <div className="rounded-xl border border-border/60 bg-background/70 p-3">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">What happens next</p>
                <p className="mt-1 text-sm">The project team reviews submissions before using them in summaries or reporting.</p>
              </div>
            </div>
            <div className="mt-5">
              <SubmissionForm shareToken={shareToken} categories={categories} />
            </div>
          </div>
        )}

        {activeTab === "submit" && !acceptingSubmissions && (
          <div className="rounded-2xl border border-border/70 bg-card p-6 text-center">
            <MessageSquare className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <h2 className="text-lg font-semibold">Submissions closed</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              This engagement campaign is no longer accepting new submissions. You can still view approved community feedback.
            </p>
          </div>
        )}

        {activeTab === "feedback" && (
          <div>
            <LocationDisplayMap items={approvedItems.map(i => ({ id: i.id, latitude: i.latitude, longitude: i.longitude, title: i.title, body: i.body }))} />
            <div className="space-y-3">
              {approvedItems.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border/70 bg-card/60 p-6 text-center text-sm text-muted-foreground">
                No community feedback has been published for this campaign yet.
              </div>
            ) : (
              approvedItems.map((item) => (
                <div key={item.id} className="rounded-2xl border border-border/70 bg-card p-4">
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {item.categoryId && categoryMap.has(item.categoryId) && (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary font-medium">
                        {categoryMap.get(item.categoryId)}
                      </span>
                    )}
                    {item.latitude !== null && item.longitude !== null && (
                      <span className="inline-flex items-center gap-1">
                        <MapPinned className="h-3 w-3" />
                        Located
                      </span>
                    )}
                    <span>{fmtDate(item.createdAt)}</span>
                    {item.submittedBy && <span>by {item.submittedBy}</span>}
                  </div>
                  {item.title && <h3 className="mb-1 text-sm font-semibold">{item.title}</h3>}
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">{item.body}</p>
                </div>
              ))
            )}
            </div>
          </div>
        )}
      </div>

      {/* Right: topic guide */}
      <div>
        {categories.length > 0 && (
          <div className="rounded-2xl border border-border/70 bg-card p-6">
            <h2 className="mb-4 text-lg font-semibold">Feedback topics</h2>
            <div className="space-y-3">
              {categories.map((c) => (
                <div key={c.id} className="rounded-xl border border-border/50 bg-background/50 p-3">
                  <h3 className="text-sm font-semibold">{c.label}</h3>
                  {c.description && (
                    <p className="mt-1 text-xs text-muted-foreground">{c.description}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-4 rounded-2xl border border-border/70 bg-card p-6">
          <h2 className="mb-2 text-lg font-semibold">About this engagement</h2>
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>
              <span className="font-medium text-foreground">{engagementGuidance.modeLabel}.</span> This public engagement portal is managed through OpenPlan.
              All submissions are reviewed by the project team before they appear publicly.
            </p>
            {projectContext ? (
              <div className="rounded-xl border border-border/60 bg-background/70 p-3">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Linked project</p>
                <p className="mt-1 text-sm font-medium text-foreground">{projectContext.name}</p>
                {projectContext.summary ? <p className="mt-1 text-sm text-muted-foreground">{projectContext.summary}</p> : null}
              </div>
            ) : null}
            <p>
              Your feedback helps inform planning decisions and can be carried into engagement summaries, project reporting,
              and other traceable planning materials.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
