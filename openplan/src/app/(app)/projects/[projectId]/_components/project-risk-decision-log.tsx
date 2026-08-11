import { AlertTriangle, MessagesSquare, Scale, Siren } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { RecordStatusAdvanceButton } from "@/components/projects/record-status-advance-button";
import {
  RecordAssigneeChip,
  type ProjectAssigneeRoster,
} from "@/components/projects/record-assignee";
import { RecordAssigneeControl } from "@/components/projects/record-assignee-control";
import {
  fmtDateTime,
  titleize,
  toneForDecision,
  toneForRiskSeverity,
} from "./_helpers";
import type {
  DecisionRow,
  IssueRow,
  MeetingRow,
  RiskRow,
} from "./_types";

type ProjectRiskAndDecisionLogProps = {
  /**
   * Required, not optional, on purpose: the risk and issue status controls
   * PATCH `/api/projects/{projectId}/records/{recordId}`, so without it they
   * cannot render — and an optional prop the page forgot to pass is exactly how
   * a finished capability ships that no planner can reach. Making it required
   * puts that mistake in front of the compiler instead of in front of a planner.
   */
  projectId: string;
  /**
   * The PROJECT's workspace, for the issue lane's reassignment picker. Required
   * for the same reason `projectId` is — a roster cannot be loaded without it,
   * and an optional prop the page forgot to pass would render a picker that
   * silently never works.
   */
  workspaceId: string;
  /**
   * Whether this member may change records. Required, not optional: see the
   * delivery board's prop of the same name for why a default in either
   * direction is a defect.
   */
  canWrite: boolean;
  risks: RiskRow[] | null;
  issues: IssueRow[] | null;
  decisions: DecisionRow[] | null;
  meetings: MeetingRow[] | null;
  /**
   * Whether each lane's query FAILED, as opposed to returning nothing.
   *
   * Without these four the panel cannot tell the two apart — an empty array and
   * a broken read look identical here — so "No risks recorded yet." was printed
   * over projects whose risk register the database had simply refused to hand
   * over. A read that failed may not be rendered as an answer.
   */
  risksReadFailed?: boolean;
  issuesReadFailed?: boolean;
  decisionsReadFailed?: boolean;
  meetingsReadFailed?: boolean;
  /**
   * The workspace roster, or an explicit failure, for the issue lane's
   * assignee. Required for the same reason `projectId` is: an optional prop the
   * page forgot to pass would render assigned issues as owned by nobody, and
   * nothing would fail. Risks, decisions and meetings carry no assignee — they
   * have no due date, so a personal queue could never surface them and an
   * assignee column on them would be an unread promise.
   */
  assigneeRoster: ProjectAssigneeRoster;
};

/** The one sentence every unreadable lane shows, in the lane's own words. */
function readFailureCopy(label: string): string {
  return `${label} could not be read, so this panel is unavailable rather than empty — this is not a finding that none are recorded. Reload; if it persists, the page banner above carries the database's message for an operator.`;
}

export function ProjectRiskAndDecisionLog({
  projectId,
  workspaceId,
  canWrite,
  risks,
  issues,
  decisions,
  meetings,
  risksReadFailed = false,
  issuesReadFailed = false,
  decisionsReadFailed = false,
  meetingsReadFailed = false,
  assigneeRoster,
}: ProjectRiskAndDecisionLogProps) {
  return (
    <>
      <div className="grid gap-6 xl:grid-cols-2">
        <article id="project-risks" className="module-section-surface scroll-mt-24">
          <div className="module-section-header">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-amber-500/10 text-amber-700 dark:text-amber-300">
                <AlertTriangle className="h-5 w-5" />
              </span>
              <div className="module-section-heading">
                <p className="module-section-label">Risks</p>
                <h2 className="module-section-title">Threats and mitigations</h2>
              </div>
            </div>
          </div>
          {risksReadFailed ? (
            <div className="module-empty-state mt-5 text-sm">{readFailureCopy("Project risks")}</div>
          ) : !risks || risks.length === 0 ? (
            <div className="module-empty-state mt-5 text-sm">No risks recorded yet.</div>
          ) : (
            <div className="mt-5 module-record-list">
              {risks.map((risk) => (
                <div key={risk.id} className="module-record-row">
                  <div className="module-record-main">
                    <div className="module-record-kicker">
                      <StatusBadge tone={toneForRiskSeverity(risk.severity)}>{titleize(risk.severity)}</StatusBadge>
                      <StatusBadge tone="neutral">{titleize(risk.status)}</StatusBadge>
                    </div>
                    <div className="space-y-1.5">
                      <h3 className="module-record-title">{risk.title}</h3>
                      <p className="module-record-summary">{risk.description || "No description yet."}</p>
                    </div>
                    {risk.mitigation ? (
                      <p className="mt-1.5 text-[0.73rem] text-muted-foreground">{risk.mitigation}</p>
                    ) : null}
                    <div className="mt-3">
                      <RecordStatusAdvanceButton
                        projectId={projectId}
                        recordId={risk.id}
                        recordType="risk"
                        currentStatus={risk.status}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>

        <article id="project-issues" className="module-section-surface scroll-mt-24">
          <div className="module-section-header">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-rose-500/10 text-rose-700 dark:text-rose-300">
                <Siren className="h-5 w-5" />
              </span>
              <div className="module-section-heading">
                <p className="module-section-label">Issues</p>
                <h2 className="module-section-title">Active blockers</h2>
              </div>
            </div>
          </div>
          {issuesReadFailed ? (
            <div className="module-empty-state mt-5 text-sm">{readFailureCopy("Project issues")}</div>
          ) : !issues || issues.length === 0 ? (
            <div className="module-empty-state mt-5 text-sm">No issues logged yet.</div>
          ) : (
            <div className="mt-5 module-record-list">
              {issues.map((issue) => (
                <div key={issue.id} className="module-record-row">
                  <div className="module-record-main">
                    <div className="module-record-kicker">
                      <StatusBadge tone={toneForRiskSeverity(issue.severity)}>{titleize(issue.severity)}</StatusBadge>
                      <StatusBadge tone="neutral">{titleize(issue.status)}</StatusBadge>
                      {issue.owner_label ? <StatusBadge tone="neutral">{issue.owner_label}</StatusBadge> : null}
                      {/* The teammate lane, beside the free-text owner above —
                          both render, neither stands in for the other. */}
                      <RecordAssigneeChip roster={assigneeRoster} assigneeUserId={issue.assignee_user_id} />
                    </div>
                    <div className="space-y-1.5">
                      <h3 className="module-record-title">{issue.title}</h3>
                      <p className="module-record-summary">{issue.description || "No description yet."}</p>
                    </div>
                    <div className="mt-3">
                      <RecordStatusAdvanceButton
                        projectId={projectId}
                        recordId={issue.id}
                        recordType="issue"
                        currentStatus={issue.status}
                      />
                    </div>
                    {/* Reassign or unassign — the chip above only READS. Risks
                        get no such control: they carry no assignee column. */}
                    <RecordAssigneeControl
                      projectId={projectId}
                      workspaceId={workspaceId}
                      recordId={issue.id}
                      recordType="issue"
                      currentAssigneeUserId={issue.assignee_user_id}
                      canWrite={canWrite}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <article id="project-decisions" className="module-section-surface scroll-mt-24">
          <div className="module-section-header">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-violet-500/10 text-violet-700 dark:text-violet-300">
                <Scale className="h-5 w-5" />
              </span>
              <div className="module-section-heading">
                <p className="module-section-label">Decisions</p>
                <h2 className="module-section-title">Why the project moved this way</h2>
              </div>
            </div>
          </div>
          {decisionsReadFailed ? (
            <div className="module-empty-state mt-5 text-sm">{readFailureCopy("Project decisions")}</div>
          ) : !decisions || decisions.length === 0 ? (
            <div className="module-empty-state mt-5 text-sm">No decisions logged yet.</div>
          ) : (
            <div className="mt-5 module-record-list">
              {decisions.map((decision) => (
                <div key={decision.id} className="module-record-row">
                  <div className="module-record-main">
                    <div className="module-record-kicker">
                      <StatusBadge tone={toneForDecision(decision.status)}>{titleize(decision.status)}</StatusBadge>
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <h3 className="module-record-title">{decision.title}</h3>
                        {decision.decided_at ? <p className="module-record-stamp">{fmtDateTime(decision.decided_at)}</p> : null}
                      </div>
                      <p className="module-record-summary">{decision.rationale}</p>
                    </div>
                    {decision.impact_summary ? (
                      <p className="mt-1.5 text-[0.73rem] text-muted-foreground">{decision.impact_summary}</p>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>

        <article id="project-meetings" className="module-section-surface scroll-mt-24">
          <div className="module-section-header">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-sky-500/10 text-sky-700 dark:text-sky-300">
                <MessagesSquare className="h-5 w-5" />
              </span>
              <div className="module-section-heading">
                <p className="module-section-label">Meetings</p>
                <h2 className="module-section-title">Notes and coordination history</h2>
              </div>
            </div>
          </div>
          {meetingsReadFailed ? (
            <div className="module-empty-state mt-5 text-sm">{readFailureCopy("Project meetings")}</div>
          ) : !meetings || meetings.length === 0 ? (
            <div className="module-empty-state mt-5 text-sm">No meetings logged yet.</div>
          ) : (
            <div className="mt-5 module-record-list">
              {meetings.map((meeting) => (
                <div key={meeting.id} className="module-record-row">
                  <div className="module-record-main">
                    <div className="module-record-kicker">
                      <StatusBadge tone="info">Meeting</StatusBadge>
                      {meeting.attendees_summary ? <StatusBadge tone="neutral">Attendees logged</StatusBadge> : null}
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <h3 className="module-record-title">{meeting.title}</h3>
                        {meeting.meeting_at ? <p className="module-record-stamp">{fmtDateTime(meeting.meeting_at)}</p> : null}
                      </div>
                      {meeting.attendees_summary ? (
                        <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Attendees: {meeting.attendees_summary}</p>
                      ) : null}
                      <p className="module-record-summary">{meeting.notes || "No notes yet."}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>
      </div>
    </>
  );
}
