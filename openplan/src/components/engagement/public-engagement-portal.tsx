"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, Loader2, MapPinned, MessageSquare, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

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
        <h3 className="text-lg font-semibold">Thank you for your feedback</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Your submission has been received and will be reviewed by the project team.
        </p>
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
          }}
        >
          Submit another response
        </Button>
      </div>
    );
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      {categories.length > 0 && (
        <div className="space-y-1.5">
          <label htmlFor="public-category" className="text-sm font-medium">
            Topic
          </label>
          <select
            id="public-category"
            className="flex h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none focus-visible:border-primary/50 focus-visible:ring-3 focus-visible:ring-primary/20"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            <option value="">Select a topic (optional)</option>
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
          placeholder="Brief summary of your feedback"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={160}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="public-body" className="text-sm font-medium">
          Your feedback <span className="text-xs text-destructive">*</span>
        </label>
        <Textarea
          id="public-body"
          rows={5}
          placeholder="Share your thoughts, concerns, or suggestions about this project..."
          value={body}
          onChange={(e) => setBody(e.target.value)}
          required
          maxLength={4000}
        />
        <p className="text-xs text-muted-foreground">{body.length}/4000 characters</p>
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

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="public-lat" className="text-sm font-medium">
            Latitude <span className="text-xs text-muted-foreground">(optional)</span>
          </label>
          <Input
            id="public-lat"
            inputMode="decimal"
            placeholder="e.g. 39.2190"
            value={latitude}
            onChange={(e) => setLatitude(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="public-lng" className="text-sm font-medium">
            Longitude <span className="text-xs text-muted-foreground">(optional)</span>
          </label>
          <Input
            id="public-lng"
            inputMode="decimal"
            placeholder="e.g. -121.0560"
            value={longitude}
            onChange={(e) => setLongitude(e.target.value)}
          />
        </div>
      </div>

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
}: {
  shareToken: string;
  acceptingSubmissions: boolean;
  categories: CategoryOption[];
  approvedItems: ApprovedItem[];
  engagementType: string;
}) {
  const [activeTab, setActiveTab] = useState<"submit" | "feedback">(acceptingSubmissions ? "submit" : "feedback");

  const categoryMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of categories) {
      map.set(c.id, c.label);
    }
    return map;
  }, [categories]);

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
            <h2 className="mb-1 text-lg font-semibold">Share your feedback</h2>
            <p className="mb-5 text-sm text-muted-foreground">
              Your input helps shape this project. All submissions are reviewed by the project team before publication.
            </p>
            <SubmissionForm shareToken={shareToken} categories={categories} />
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
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>
              This is a public engagement portal managed through OpenPlan. All submissions are reviewed
              by the project team before they appear publicly.
            </p>
            <p>
              Your feedback helps inform planning decisions and ensures community voices are part of the process.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
