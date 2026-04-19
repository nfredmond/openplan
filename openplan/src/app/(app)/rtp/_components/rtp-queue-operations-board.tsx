import Link from "next/link";
import { ArrowRight, Compass, FolderKanban } from "lucide-react";
import { RtpCycleCreator } from "@/components/rtp/rtp-cycle-creator";
import { RtpRegistryPacketBulkActions } from "@/components/rtp/rtp-registry-packet-bulk-actions";
import { RtpRegistryPacketBulkGenerateActions } from "@/components/rtp/rtp-registry-packet-bulk-generate-actions";
import { RtpRegistryPacketBulkRefreshActions } from "@/components/rtp/rtp-registry-packet-bulk-refresh-actions";
import { RtpRegistryPacketQueueCommandBoard } from "@/components/rtp/rtp-registry-packet-queue-command-board";
import type { PacketAttentionCounts } from "./_types";

type Props = {
  packetAttentionCounts: PacketAttentionCounts;
  resetCycleIds: string[];
  missingCycleIds: string[];
  generateFirstReportIds: string[];
  refreshReportIds: string[];
  generateReportIds: string[];
  refreshOnlyReportIds: string[];
};

export function RtpQueueOperationsBoard({
  packetAttentionCounts,
  resetCycleIds,
  missingCycleIds,
  generateFirstReportIds,
  refreshReportIds,
  generateReportIds,
  refreshOnlyReportIds,
}: Props) {
  const showCommandBoard =
    packetAttentionCounts.reset > 0 ||
    packetAttentionCounts.generate > 0 ||
    packetAttentionCounts.refresh > 0 ||
    packetAttentionCounts.missing > 0;

  return (
    <>
      {showCommandBoard ? (
        <RtpRegistryPacketQueueCommandBoard
          resetCycleIds={resetCycleIds}
          missingCycleIds={missingCycleIds}
          generateFirstReportIds={generateFirstReportIds}
          refreshReportIds={refreshReportIds}
          resetCount={packetAttentionCounts.reset}
          missingCount={packetAttentionCounts.missing}
        />
      ) : null}

      {packetAttentionCounts.reset > 0 ? (
        <RtpRegistryPacketBulkActions
          cycleIds={resetCycleIds}
          cycleCount={packetAttentionCounts.reset}
        />
      ) : null}

      {packetAttentionCounts.generate > 0 ? (
        <RtpRegistryPacketBulkGenerateActions
          reportIds={generateReportIds}
          reportCount={packetAttentionCounts.generate}
        />
      ) : null}

      {packetAttentionCounts.refresh > 0 ? (
        <RtpRegistryPacketBulkRefreshActions
          reportIds={refreshOnlyReportIds}
          reportCount={packetAttentionCounts.refresh}
        />
      ) : null}

      <RtpCycleCreator />

      <article className="module-section-surface">
        <div className="module-section-header">
          <div className="module-section-heading">
            <p className="module-section-label">Next slice</p>
            <h2 className="module-section-title">What comes next</h2>
            <p className="module-section-description">
              The cycle now carries portfolio links and a first chapter shell. The next slice can move from structure into editable RTP content.
            </p>
          </div>
          <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-sky-500/12 text-sky-700 dark:text-sky-300">
            <Compass className="h-5 w-5" />
          </span>
        </div>

        <div className="module-operator-list mt-1">
          <div className="module-operator-item">Add chapter editing so policy, action, and financial sections can move from shell to working draft.</div>
          <div className="module-operator-item">Keep constrained, illustrative, and candidate project posture visible from the same cycle.</div>
          <div className="module-operator-item">Extend engagement campaigns so whole-plan, chapter, and project comments can point back to the same cycle.</div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="module-metric-card">
            <p className="module-metric-label">Next domain</p>
            <p className="module-metric-value text-sm">Editable chapter workflow</p>
            <p className="mt-1 text-xs text-muted-foreground">Section summaries, chapter status, and chapter-specific evidence posture.</p>
          </div>
          <div className="module-metric-card">
            <p className="module-metric-label">Next output</p>
            <p className="module-metric-value text-sm">Comment-ready digital RTP</p>
            <p className="mt-1 text-xs text-muted-foreground">A narrative surface that can carry chapter-level comments and board packet exports.</p>
          </div>
        </div>

        <Link href="/projects" className="module-inline-action mt-4">
          Review linked project control room posture
          <ArrowRight className="h-4 w-4" />
        </Link>
        <Link href="/plans" className="module-inline-action mt-3">
          Review existing plan records
          <FolderKanban className="h-4 w-4" />
        </Link>
      </article>
    </>
  );
}
