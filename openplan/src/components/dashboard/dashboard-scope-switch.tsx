import Link from "next/link";

export type DashboardScope = "workspace" | "mine";

export function normalizeDashboardScope(value: string | string[] | undefined): DashboardScope {
  return value === "mine" ? "mine" : "workspace";
}

const OPTIONS: Array<{ scope: DashboardScope; label: string }> = [
  { scope: "workspace", label: "Whole workspace" },
  { scope: "mine", label: "Assigned to me" },
];

/**
 * Whose work the dashboard lists. The choice is in the URL, so a supervisor
 * can send the view to someone. Workspace-wide deadlines (grants, awards,
 * invoices, plan reviews) have no assignee and show in both.
 */
export function DashboardScopeSwitch({ scope }: { scope: DashboardScope }) {
  return (
    <nav aria-label="Whose work to show" className="dashboard-scope">
      {OPTIONS.map((option) => {
        const current = option.scope === scope;
        return (
          <Link
            key={option.scope}
            href={option.scope === "workspace" ? "/dashboard" : "/dashboard?scope=mine"}
            aria-current={current ? "page" : undefined}
            className="dashboard-scope-option"
            data-current={current ? "true" : undefined}
          >
            {option.label}
          </Link>
        );
      })}
    </nav>
  );
}
