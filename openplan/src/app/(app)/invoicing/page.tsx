import Link from "next/link";
import { redirect } from "next/navigation";
import { WorkspaceMembershipRequired } from "@/components/workspaces/workspace-membership-required";
import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";
import { createClient } from "@/lib/supabase/server";
import {
  CURRENT_WORKSPACE_MEMBERSHIP_SELECT,
  resolveWorkspaceMembershipSelection,
  type WorkspaceMembershipRow,
  unwrapWorkspaceRecord,
} from "@/lib/workspaces/current";
import { InvoicingCashStrip } from "./_components/invoicing-cash-strip";
import {
  buildInvoicingDirectionHref,
  formatWorkspaceIdSnippet,
  insetClass,
  normalizeInvoicingDirection,
  noticeClass,
  panelClass,
  titleCase,
  type InvoicingDirection,
} from "./_components/invoicing-page-helpers";
import { ReceivablesLane } from "./_components/receivables-lane";
import { ReimbursementLane } from "./_components/reimbursement-lane";

const DIRECTION_TABS: Array<{ value: InvoicingDirection; label: string }> = [
  { value: "reimbursement", label: "Funder reimbursements" },
  { value: "receivables", label: "Client receivables" },
];

const DIRECTION_DESCRIPTIONS: Record<InvoicingDirection, string> = {
  reimbursement:
    "Reimbursement invoices this agency submits against its funding awards — the draw cycle from draft through submitted, approved for payment, and paid. Reads are workspace-wide; writes are owner/admin only. Nothing here bills you: OpenPlan is free and open source.",
  receivables:
    "Invoices this workspace sends its own clients — the receivable cycle from draft through sent and paid, backed by engagements, rate tables, and the time ledger. Reads are workspace-wide; writes are owner/admin only. Nothing here bills you: OpenPlan is free and open source.",
};

export default async function InvoicingPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedParams = (await searchParams) ?? {};
  const requestedWorkspaceId = typeof resolvedParams.workspaceId === "string" ? resolvedParams.workspaceId : null;
  const direction = normalizeInvoicingDirection(resolvedParams.direction);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  const { data: memberships } = await supabase
    .from("workspace_members")
    .select(CURRENT_WORKSPACE_MEMBERSHIP_SELECT)
    .eq("user_id", user.id);

  const selection = resolveWorkspaceMembershipSelection(memberships as WorkspaceMembershipRow[] | null, {
    requestedWorkspaceId,
    requireExplicitSelectionForMultiWorkspace: true,
  });

  if (!selection.memberships.length) {
    return (
      <WorkspaceMembershipRequired
        moduleLabel="Invoicing"
        title="Invoicing needs a provisioned workspace"
        description="Reimbursement invoices are workspace records. You are signed in, but no workspace membership was found for this account, so there is no invoice register to show yet."
        primaryHref="/projects"
        primaryLabel="Create or open project workspace"
      />
    );
  }

  if (selection.invalidWorkspaceId || selection.requiresExplicitSelection || !selection.membership || !selection.workspace) {
    return (
      <section className="space-y-6">
        <header className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px] xl:items-end">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Invoicing</p>
            <h1 className="text-3xl font-semibold tracking-tight">Choose a workspace</h1>
            <p className="text-sm text-muted-foreground sm:text-base">
              Invoice registers are workspace-specific. This account has access to multiple workspaces, so pick the one whose reimbursement invoices you want to review.
            </p>
          </div>
          <div className={`${insetClass()} px-4 py-4 text-sm text-muted-foreground`}>
            Opening the right workspace keeps invoice review, award linkage, and retention posture attached to the correct ledger.
          </div>
        </header>

        {selection.invalidWorkspaceId ? (
          <article className={noticeClass("warning")}>
            The requested workspace was not found for this account. Choose one of your accessible workspaces below.
          </article>
        ) : null}

        <article className={panelClass()}>
          <div className="border-b border-border/60 pb-4">
            <h2 className="text-lg font-semibold tracking-tight">Available workspaces</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Opening the right workspace prevents reviewing or relinking invoices against the wrong ledger.
            </p>
          </div>

          <ul className="mt-4 space-y-3">
            {selection.memberships.map((membershipOption) => {
              const workspaceOption = unwrapWorkspaceRecord(membershipOption.workspaces);
              return (
                <li key={membershipOption.workspace_id} className="grid gap-3 border border-border/60 bg-background/70 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-semibold tracking-tight text-foreground">{workspaceOption?.name ?? "Workspace"}</h3>
                    </div>
                    <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                      Workspace ID {formatWorkspaceIdSnippet(membershipOption.workspace_id)} · Role {membershipOption.role}
                    </p>
                  </div>

                  <Link
                    href={`/invoicing?workspaceId=${membershipOption.workspace_id}`}
                    className="text-sm font-semibold text-foreground transition hover:text-primary"
                  >
                    Open invoicing
                  </Link>
                </li>
              );
            })}
          </ul>
        </article>
      </section>
    );
  }

  const membership = selection.membership;
  const workspace = selection.workspace;
  const workspaceId = membership.workspace_id;
  const canWriteInvoices = canAccessWorkspaceAction("invoices.write", membership.role);

  return (
    <section className="space-y-6">
      <header className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px] xl:items-end">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Invoicing</p>
          <h1 className="text-3xl font-semibold tracking-tight">{workspace.name ?? "Workspace"} invoicing</h1>
          <p className="text-sm text-muted-foreground sm:text-base">{DIRECTION_DESCRIPTIONS[direction]}</p>
        </div>

        <div className={`${insetClass()} grid gap-px bg-border/80`}>
          <div className="bg-background/70 px-4 py-3 text-sm">
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Role</p>
            <p className="mt-1 font-semibold text-foreground">{titleCase(membership.role)}</p>
          </div>
          <div className="bg-background/70 px-4 py-3 text-sm">
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Workspace ID</p>
            <p className="mt-1 font-semibold text-foreground">{formatWorkspaceIdSnippet(workspaceId)}</p>
          </div>
        </div>
      </header>

      <InvoicingCashStrip workspaceId={workspaceId} />

      <nav aria-label="Invoicing direction" className="flex flex-wrap items-center gap-2 border-b border-border/60 pb-3">
        {DIRECTION_TABS.map((tab) => {
          const active = direction === tab.value;
          return (
            <Link
              key={tab.value}
              href={buildInvoicingDirectionHref(resolvedParams, tab.value)}
              aria-current={active ? "page" : undefined}
              className={active ? "openplan-inline-label" : "openplan-inline-label openplan-inline-label-muted"}
            >
              {tab.label}
            </Link>
          );
        })}
        <span className="text-xs text-muted-foreground">
          {direction === "reimbursement"
            ? "Money this workspace claims from its funders."
            : "Money this workspace bills its own clients."}
        </span>
      </nav>

      {direction === "receivables" ? (
        <ReceivablesLane workspaceId={workspaceId} canWriteInvoices={canWriteInvoices} />
      ) : (
        <ReimbursementLane workspaceId={workspaceId} canWriteInvoices={canWriteInvoices} resolvedParams={resolvedParams} />
      )}
    </section>
  );
}
