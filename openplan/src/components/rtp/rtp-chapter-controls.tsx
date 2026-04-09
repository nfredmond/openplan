"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { RTP_CHAPTER_STATUS_OPTIONS } from "@/lib/rtp/catalog";

type Chapter = {
  id: string;
  title: string;
  status: string;
  guidance: string | null;
  summary: string | null;
  contentMarkdown: string | null;
};

type Props = {
  rtpCycleId: string;
  chapter: Chapter;
};

export function RtpChapterControls({ rtpCycleId, chapter }: Props) {
  const router = useRouter();
  const [title, setTitle] = useState(chapter.title);
  const [status, setStatus] = useState(chapter.status);
  const [guidance, setGuidance] = useState(chapter.guidance ?? "");
  const [summary, setSummary] = useState(chapter.summary ?? "");
  const [contentMarkdown, setContentMarkdown] = useState(chapter.contentMarkdown ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSaving(true);

    try {
      const response = await fetch(`/api/rtp-cycles/${rtpCycleId}/chapters/${chapter.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title,
          status,
          guidance: guidance.trim() ? guidance.trim() : null,
          summary: summary.trim() ? summary.trim() : null,
          contentMarkdown: contentMarkdown.trim() ? contentMarkdown.trim() : null,
        }),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to update RTP chapter");
      }

      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to update RTP chapter");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <article className="module-section-surface">
      <div className="module-section-header">
        <div className="module-section-heading">
          <p className="module-section-label">Chapter controls</p>
          <h2 className="module-section-title">Edit chapter workflow</h2>
          <p className="module-section-description">
            Move this section from shell to working draft with explicit status, summary, and editorial guidance.
          </p>
        </div>
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-500/12 text-sky-700 dark:text-sky-300">
          <Settings2 className="h-5 w-5" />
        </span>
      </div>

      <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-1.5">
          <label htmlFor={`rtp-chapter-title-${chapter.id}`} className="text-[0.82rem] font-semibold">
            Chapter title
          </label>
          <Input id={`rtp-chapter-title-${chapter.id}`} value={title} onChange={(event) => setTitle(event.target.value)} required />
        </div>

        <div className="space-y-1.5">
          <label htmlFor={`rtp-chapter-status-${chapter.id}`} className="text-[0.82rem] font-semibold">
            Chapter status
          </label>
          <select
            id={`rtp-chapter-status-${chapter.id}`}
            className="flex h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none focus-visible:border-[color:var(--focus-ring-light)] focus-visible:ring-3 focus-visible:ring-[color:var(--focus-ring-light)]/35"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            {RTP_CHAPTER_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label htmlFor={`rtp-chapter-summary-${chapter.id}`} className="text-[0.82rem] font-semibold">
            Working summary
          </label>
          <Textarea
            id={`rtp-chapter-summary-${chapter.id}`}
            rows={5}
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            placeholder="Summarize what this RTP section needs to say, what evidence it depends on, and what still needs to be resolved."
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor={`rtp-chapter-content-${chapter.id}`} className="text-[0.82rem] font-semibold">
            Draft section content
          </label>
          <Textarea
            id={`rtp-chapter-content-${chapter.id}`}
            rows={10}
            value={contentMarkdown}
            onChange={(event) => setContentMarkdown(event.target.value)}
            placeholder="Write the actual draft narrative for this RTP section here. Plain text or markdown-style structure is fine for now."
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor={`rtp-chapter-guidance-${chapter.id}`} className="text-[0.82rem] font-semibold">
            Editorial guidance
          </label>
          <Textarea
            id={`rtp-chapter-guidance-${chapter.id}`}
            rows={4}
            value={guidance}
            onChange={(event) => setGuidance(event.target.value)}
            placeholder="Capture section-specific writing or evidence guidance."
          />
        </div>

        {error ? (
          <p className="rounded-2xl border border-red-300/80 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
            {error}
          </p>
        ) : null}

        <Button type="submit" disabled={isSaving}>
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save chapter draft
        </Button>
      </form>
    </article>
  );
}
