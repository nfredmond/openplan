"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ClipboardCheck, Loader2, MessagesSquare, Scale, Siren } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

type ProjectRecordComposerProps = {
  projectId: string;
};

function FormError({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p className="rounded-2xl border border-red-300/80 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
      {error}
    </p>
  );
}

export function ProjectRecordComposer({ projectId }: ProjectRecordComposerProps) {
  const router = useRouter();

  const [deliverableTitle, setDeliverableTitle] = useState("");
  const [deliverableSummary, setDeliverableSummary] = useState("");
  const [deliverableOwner, setDeliverableOwner] = useState("");
  const [deliverableDueDate, setDeliverableDueDate] = useState("");
  const [deliverableStatus, setDeliverableStatus] = useState("not_started");
  const [deliverableError, setDeliverableError] = useState<string | null>(null);
  const [deliverableSaving, setDeliverableSaving] = useState(false);

  const [riskTitle, setRiskTitle] = useState("");
  const [riskDescription, setRiskDescription] = useState("");
  const [riskSeverity, setRiskSeverity] = useState("medium");
  const [riskStatus, setRiskStatus] = useState("open");
  const [riskMitigation, setRiskMitigation] = useState("");
  const [riskError, setRiskError] = useState<string | null>(null);
  const [riskSaving, setRiskSaving] = useState(false);

  const [issueTitle, setIssueTitle] = useState("");
  const [issueDescription, setIssueDescription] = useState("");
  const [issueSeverity, setIssueSeverity] = useState("medium");
  const [issueStatus, setIssueStatus] = useState("open");
  const [issueOwner, setIssueOwner] = useState("");
  const [issueError, setIssueError] = useState<string | null>(null);
  const [issueSaving, setIssueSaving] = useState(false);

  const [decisionTitle, setDecisionTitle] = useState("");
  const [decisionRationale, setDecisionRationale] = useState("");
  const [decisionStatus, setDecisionStatus] = useState("proposed");
  const [decisionImpact, setDecisionImpact] = useState("");
  const [decisionAt, setDecisionAt] = useState("");
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [decisionSaving, setDecisionSaving] = useState(false);

  const [meetingTitle, setMeetingTitle] = useState("");
  const [meetingNotes, setMeetingNotes] = useState("");
  const [meetingAt, setMeetingAt] = useState("");
  const [meetingAttendees, setMeetingAttendees] = useState("");
  const [meetingError, setMeetingError] = useState<string | null>(null);
  const [meetingSaving, setMeetingSaving] = useState(false);

  async function submitRecord(payload: Record<string, unknown>) {
    const response = await fetch(`/api/projects/${projectId}/records`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = (await response.json()) as { error?: string; details?: string };

    if (!response.ok) {
      throw new Error(data.details || data.error || "Failed to save record");
    }

    router.refresh();
  }

  async function handleDeliverableSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDeliverableError(null);
    setDeliverableSaving(true);
    try {
      await submitRecord({
        recordType: "deliverable",
        title: deliverableTitle,
        summary: deliverableSummary,
        ownerLabel: deliverableOwner,
        dueDate: deliverableDueDate,
        status: deliverableStatus,
      });
      setDeliverableTitle("");
      setDeliverableSummary("");
      setDeliverableOwner("");
      setDeliverableDueDate("");
      setDeliverableStatus("not_started");
    } catch (error) {
      setDeliverableError(error instanceof Error ? error.message : "Failed to save deliverable");
    } finally {
      setDeliverableSaving(false);
    }
  }

  async function handleRiskSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRiskError(null);
    setRiskSaving(true);
    try {
      await submitRecord({
        recordType: "risk",
        title: riskTitle,
        description: riskDescription,
        severity: riskSeverity,
        status: riskStatus,
        mitigation: riskMitigation,
      });
      setRiskTitle("");
      setRiskDescription("");
      setRiskSeverity("medium");
      setRiskStatus("open");
      setRiskMitigation("");
    } catch (error) {
      setRiskError(error instanceof Error ? error.message : "Failed to save risk");
    } finally {
      setRiskSaving(false);
    }
  }

  async function handleIssueSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIssueError(null);
    setIssueSaving(true);
    try {
      await submitRecord({
        recordType: "issue",
        title: issueTitle,
        description: issueDescription,
        severity: issueSeverity,
        status: issueStatus,
        ownerLabel: issueOwner,
      });
      setIssueTitle("");
      setIssueDescription("");
      setIssueSeverity("medium");
      setIssueStatus("open");
      setIssueOwner("");
    } catch (error) {
      setIssueError(error instanceof Error ? error.message : "Failed to save issue");
    } finally {
      setIssueSaving(false);
    }
  }

  async function handleDecisionSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDecisionError(null);
    setDecisionSaving(true);
    try {
      await submitRecord({
        recordType: "decision",
        title: decisionTitle,
        rationale: decisionRationale,
        status: decisionStatus,
        impactSummary: decisionImpact,
        decidedAt: decisionAt ? new Date(decisionAt).toISOString() : undefined,
      });
      setDecisionTitle("");
      setDecisionRationale("");
      setDecisionStatus("proposed");
      setDecisionImpact("");
      setDecisionAt("");
    } catch (error) {
      setDecisionError(error instanceof Error ? error.message : "Failed to save decision");
    } finally {
      setDecisionSaving(false);
    }
  }

  async function handleMeetingSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMeetingError(null);
    setMeetingSaving(true);
    try {
      await submitRecord({
        recordType: "meeting",
        title: meetingTitle,
        notes: meetingNotes,
        meetingAt: meetingAt ? new Date(meetingAt).toISOString() : undefined,
        attendeesSummary: meetingAttendees,
      });
      setMeetingTitle("");
      setMeetingNotes("");
      setMeetingAt("");
      setMeetingAttendees("");
    } catch (error) {
      setMeetingError(error instanceof Error ? error.message : "Failed to save meeting");
    } finally {
      setMeetingSaving(false);
    }
  }

  return (
    <article className="module-section-surface">
      <div className="module-section-heading">
        <p className="module-section-label">Create records</p>
        <h2 className="module-section-title">Add deliverables, risks, issues, decisions, and meetings</h2>
        <p className="module-section-description">
          This control layer turns each project into an active operating workspace instead of a passive record.
        </p>
      </div>

      <Tabs defaultValue="deliverable" className="mt-5">
        <TabsList variant="line" className="module-tabs-list">
          <TabsTrigger value="deliverable" className="module-tab-trigger">
            <ClipboardCheck className="h-4 w-4" />
            Deliverable
          </TabsTrigger>
          <TabsTrigger value="risk" className="module-tab-trigger">
            <AlertTriangle className="h-4 w-4" />
            Risk
          </TabsTrigger>
          <TabsTrigger value="issue" className="module-tab-trigger">
            <Siren className="h-4 w-4" />
            Issue
          </TabsTrigger>
          <TabsTrigger value="decision" className="module-tab-trigger">
            <Scale className="h-4 w-4" />
            Decision
          </TabsTrigger>
          <TabsTrigger value="meeting" className="module-tab-trigger">
            <MessagesSquare className="h-4 w-4" />
            Meeting
          </TabsTrigger>
        </TabsList>

        <TabsContent value="deliverable" className="pt-4">
          <form className="space-y-4" onSubmit={handleDeliverableSubmit}>
            <div className="space-y-2">
              <label htmlFor="deliverable-title" className="text-sm font-medium">
                Deliverable title
              </label>
              <Input
                id="deliverable-title"
                value={deliverableTitle}
                onChange={(e) => setDeliverableTitle(e.target.value)}
                placeholder="Draft board-ready safety memo"
                required
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="deliverable-summary" className="text-sm font-medium">
                Summary
              </label>
              <Textarea
                id="deliverable-summary"
                value={deliverableSummary}
                onChange={(e) => setDeliverableSummary(e.target.value)}
                rows={4}
                placeholder="What needs to be delivered, for whom, and at what quality bar?"
              />
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <label htmlFor="deliverable-owner" className="text-sm font-medium">
                  Owner
                </label>
                <Input
                  id="deliverable-owner"
                  value={deliverableOwner}
                  onChange={(e) => setDeliverableOwner(e.target.value)}
                  placeholder="Elena / Owen / Consultant"
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="deliverable-due" className="text-sm font-medium">
                  Due date
                </label>
                <Input id="deliverable-due" type="date" value={deliverableDueDate} onChange={(e) => setDeliverableDueDate(e.target.value)} />
              </div>
              <div className="space-y-2">
                <label htmlFor="deliverable-status" className="text-sm font-medium">
                  Status
                </label>
                <select
                  id="deliverable-status"
                  className="module-select"
                  value={deliverableStatus}
                  onChange={(e) => setDeliverableStatus(e.target.value)}
                >
                  <option value="not_started">Not started</option>
                  <option value="in_progress">In progress</option>
                  <option value="blocked">Blocked</option>
                  <option value="complete">Complete</option>
                </select>
              </div>
            </div>
            <FormError error={deliverableError} />
            <Button type="submit" disabled={deliverableSaving}>
              {deliverableSaving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Saving deliverable…
                </>
              ) : (
                "Add deliverable"
              )}
            </Button>
          </form>
        </TabsContent>

        <TabsContent value="risk" className="pt-4">
          <form className="space-y-4" onSubmit={handleRiskSubmit}>
            <div className="space-y-2">
              <label htmlFor="risk-title" className="text-sm font-medium">
                Risk title
              </label>
              <Input
                id="risk-title"
                value={riskTitle}
                onChange={(e) => setRiskTitle(e.target.value)}
                placeholder="Schedule compression may weaken review quality"
                required
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="risk-description" className="text-sm font-medium">
                Description
              </label>
              <Textarea
                id="risk-description"
                value={riskDescription}
                onChange={(e) => setRiskDescription(e.target.value)}
                rows={4}
                placeholder="Describe the risk and what could go wrong if it is ignored."
              />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label htmlFor="risk-severity" className="text-sm font-medium">
                  Severity
                </label>
                <select id="risk-severity" className="module-select" value={riskSeverity} onChange={(e) => setRiskSeverity(e.target.value)}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </div>
              <div className="space-y-2">
                <label htmlFor="risk-status" className="text-sm font-medium">
                  Status
                </label>
                <select id="risk-status" className="module-select" value={riskStatus} onChange={(e) => setRiskStatus(e.target.value)}>
                  <option value="open">Open</option>
                  <option value="watch">Watch</option>
                  <option value="mitigated">Mitigated</option>
                  <option value="closed">Closed</option>
                </select>
              </div>
            </div>
            <div className="space-y-2">
              <label htmlFor="risk-mitigation" className="text-sm font-medium">
                Mitigation
              </label>
              <Textarea
                id="risk-mitigation"
                value={riskMitigation}
                onChange={(e) => setRiskMitigation(e.target.value)}
                rows={4}
                placeholder="What is the mitigation path, owner, or contingency?"
              />
            </div>
            <FormError error={riskError} />
            <Button type="submit" disabled={riskSaving}>
              {riskSaving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Saving risk…
                </>
              ) : (
                "Add risk"
              )}
            </Button>
          </form>
        </TabsContent>

        <TabsContent value="issue" className="pt-4">
          <form className="space-y-4" onSubmit={handleIssueSubmit}>
            <div className="space-y-2">
              <label htmlFor="issue-title" className="text-sm font-medium">
                Issue title
              </label>
              <Input
                id="issue-title"
                value={issueTitle}
                onChange={(e) => setIssueTitle(e.target.value)}
                placeholder="Traffic count package still missing"
                required
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="issue-description" className="text-sm font-medium">
                Description
              </label>
              <Textarea
                id="issue-description"
                value={issueDescription}
                onChange={(e) => setIssueDescription(e.target.value)}
                rows={4}
                placeholder="Describe the active blocker or operational problem."
              />
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <label htmlFor="issue-severity" className="text-sm font-medium">
                  Severity
                </label>
                <select id="issue-severity" className="module-select" value={issueSeverity} onChange={(e) => setIssueSeverity(e.target.value)}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </div>
              <div className="space-y-2">
                <label htmlFor="issue-status" className="text-sm font-medium">
                  Status
                </label>
                <select id="issue-status" className="module-select" value={issueStatus} onChange={(e) => setIssueStatus(e.target.value)}>
                  <option value="open">Open</option>
                  <option value="in_progress">In progress</option>
                  <option value="blocked">Blocked</option>
                  <option value="resolved">Resolved</option>
                </select>
              </div>
              <div className="space-y-2">
                <label htmlFor="issue-owner" className="text-sm font-medium">
                  Owner
                </label>
                <Input
                  id="issue-owner"
                  value={issueOwner}
                  onChange={(e) => setIssueOwner(e.target.value)}
                  placeholder="Priya / Consultant"
                />
              </div>
            </div>
            <FormError error={issueError} />
            <Button type="submit" disabled={issueSaving}>
              {issueSaving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Saving issue…
                </>
              ) : (
                "Add issue"
              )}
            </Button>
          </form>
        </TabsContent>

        <TabsContent value="decision" className="pt-4">
          <form className="space-y-4" onSubmit={handleDecisionSubmit}>
            <div className="space-y-2">
              <label htmlFor="decision-title" className="text-sm font-medium">
                Decision title
              </label>
              <Input
                id="decision-title"
                value={decisionTitle}
                onChange={(e) => setDecisionTitle(e.target.value)}
                placeholder="Use VMT-first narrative for public packet"
                required
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="decision-rationale" className="text-sm font-medium">
                Rationale
              </label>
              <Textarea
                id="decision-rationale"
                value={decisionRationale}
                onChange={(e) => setDecisionRationale(e.target.value)}
                rows={4}
                placeholder="Why was this decision made, on what basis, and with what tradeoffs?"
                required
              />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label htmlFor="decision-status" className="text-sm font-medium">
                  Decision state
                </label>
                <select id="decision-status" className="module-select" value={decisionStatus} onChange={(e) => setDecisionStatus(e.target.value)}>
                  <option value="proposed">Proposed</option>
                  <option value="approved">Approved</option>
                  <option value="rejected">Rejected</option>
                </select>
              </div>
              <div className="space-y-2">
                <label htmlFor="decision-date" className="text-sm font-medium">
                  Decision date
                </label>
                <Input id="decision-date" type="datetime-local" value={decisionAt} onChange={(e) => setDecisionAt(e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <label htmlFor="decision-impact" className="text-sm font-medium">
                Impact summary
              </label>
              <Textarea
                id="decision-impact"
                value={decisionImpact}
                onChange={(e) => setDecisionImpact(e.target.value)}
                rows={4}
                placeholder="What downstream scope, quality, schedule, or policy effects does this decision create?"
              />
            </div>
            <FormError error={decisionError} />
            <Button type="submit" disabled={decisionSaving}>
              {decisionSaving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Saving decision…
                </>
              ) : (
                "Add decision"
              )}
            </Button>
          </form>
        </TabsContent>

        <TabsContent value="meeting" className="pt-4">
          <form className="space-y-4" onSubmit={handleMeetingSubmit}>
            <div className="space-y-2">
              <label htmlFor="meeting-title" className="text-sm font-medium">
                Meeting title
              </label>
              <Input
                id="meeting-title"
                value={meetingTitle}
                onChange={(e) => setMeetingTitle(e.target.value)}
                placeholder="Weekly project sync"
                required
              />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label htmlFor="meeting-at" className="text-sm font-medium">
                  Meeting time
                </label>
                <Input id="meeting-at" type="datetime-local" value={meetingAt} onChange={(e) => setMeetingAt(e.target.value)} />
              </div>
              <div className="space-y-2">
                <label htmlFor="meeting-attendees" className="text-sm font-medium">
                  Attendees
                </label>
                <Input
                  id="meeting-attendees"
                  value={meetingAttendees}
                  onChange={(e) => setMeetingAttendees(e.target.value)}
                  placeholder="Nathaniel, Elena, Owen"
                />
              </div>
            </div>
            <div className="space-y-2">
              <label htmlFor="meeting-notes" className="text-sm font-medium">
                Notes
              </label>
              <Textarea
                id="meeting-notes"
                value={meetingNotes}
                onChange={(e) => setMeetingNotes(e.target.value)}
                rows={5}
                placeholder="Key points, action items, and open questions."
              />
            </div>
            <FormError error={meetingError} />
            <Button type="submit" disabled={meetingSaving}>
              {meetingSaving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Saving meeting…
                </>
              ) : (
                "Add meeting"
              )}
            </Button>
          </form>
        </TabsContent>
      </Tabs>
    </article>
  );
}
