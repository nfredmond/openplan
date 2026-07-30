"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * WHERE AN AGENCY RECORDS HOW ELSE A RESIDENT CAN TAKE PART.
 *
 * The portal is a map, a form and a comment feed, and each has people it does
 * not work for. For a consultation run by a public body, a resident who could
 * not take part is not a usability statistic — it is the consultation failing to
 * hear from someone it was required to reach, and the only thing that reliably
 * fixes it is a person at the agency they can contact.
 *
 * OPENPLAN WRITES NONE OF THIS. The duty to offer another way to take part sits
 * with the body running the consultation, so every field here starts empty and
 * nothing is pre-filled with a suggestion. A default would put words in a public
 * body's mouth about its own legal obligation, and an agency that later
 * discovered OpenPlan had promised an accommodation on their behalf would be
 * right to be angry about it.
 *
 * IT WARNS RATHER THAN BLOCKS. A live portal with nothing recorded here is a
 * real gap and is said plainly, at the moment it can still be fixed. It is not
 * enforced, because OpenPlan cannot know what a given agency has arranged
 * off-platform — a phone number on the printed flyer is a real accommodation
 * this form has never heard of. Refusing to publish would be OpenPlan claiming
 * to know more about an agency's outreach than the agency does.
 */
export function CampaignAccessibilityEditor({
  campaignId,
  portalIsLive,
  initial,
}: {
  campaignId: string;
  /** A published, open portal is where an unrecorded contact actually costs someone. */
  portalIsLive: boolean;
  initial: {
    contactLabel: string | null;
    contactEmail: string | null;
    contactPhone: string | null;
    alternateFormats: string | null;
  };
}) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const nothingRecorded =
    !values.contactLabel && !values.contactEmail && !values.contactPhone && !values.alternateFormats;

  function field(key: keyof typeof values) {
    return {
      value: values[key] ?? "",
      onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        setValues((current) => ({ ...current, [key]: event.target.value }));
        setSaved(false);
      },
    };
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const response = await fetch(`/api/engagement/campaigns/${campaignId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accessibilityContactLabel: values.contactLabel ?? "",
          accessibilityContactEmail: values.contactEmail ?? "",
          accessibilityContactPhone: values.contactPhone ?? "",
          accessibilityAlternateFormats: values.alternateFormats ?? "",
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "Could not save these details.");
        return;
      }
      setSaved(true);
      // The public portal renders from a server component, so the change is not
      // visible to a reload of this page alone.
      router.refresh();
    } catch {
      setError("Could not reach OpenPlan. Nothing was saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-4">
      {nothingRecorded && portalIsLive ? (
        <p
          role="status"
          className="rounded-md border border-amber-300/70 bg-amber-50/70 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200"
        >
          This campaign&apos;s public portal is open and nothing here is recorded, so a resident who
          cannot use the page has no way to ask for another one. Anything you enter appears on the
          portal in the resident&apos;s language.
        </p>
      ) : null}

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-foreground">Who to contact</span>
        <span className="text-xs text-muted-foreground">
          In your agency&apos;s own words — &ldquo;ADA Coordinator&rdquo;, &ldquo;Community Engagement
          Team&rdquo;, a named officer. OpenPlan does not choose this for you.
        </span>
        <input maxLength={200} className={FIELD} {...field("contactLabel")} />
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-foreground">Email</span>
          <input type="email" maxLength={320} className={FIELD} {...field("contactEmail")} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-foreground">Phone</span>
          <input type="tel" maxLength={80} className={FIELD} {...field("contactPhone")} />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-foreground">Other ways to take part</span>
        <span className="text-xs text-muted-foreground">
          Paper copies, a phone line, an interpreter, a staffed meeting — whatever you actually offer.
          This text is translated alongside the rest of the campaign.
        </span>
        <textarea rows={3} maxLength={2000} className={FIELD} {...field("alternateFormats")} />
      </label>

      {error ? (
        <p role="alert" className="text-sm text-amber-800 dark:text-amber-200">
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-foreground px-3 py-1.5 text-sm font-semibold text-background disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {saved ? (
          <span role="status" className="text-sm text-muted-foreground">
            Saved. This is now on the public portal.
          </span>
        ) : null}
      </div>
    </form>
  );
}

const FIELD = "w-full rounded-md border border-border/70 bg-background px-2 py-1.5 text-sm text-foreground";
