import { buildIdentity } from "@/lib/runtime/app-version";

/**
 * THE ONE PLACE A RUNNING INSTANCE SAYS WHAT IT IS.
 *
 * Deliberately always rendered, and deliberately not part of
 * `DeploymentHealthPanel` — that panel returns null when nothing is wrong,
 * which is exactly the deployment whose version somebody will eventually need.
 * A healthy instance that cannot name itself is the common case, not the rare
 * one.
 *
 * Shown to every member rather than only to managers. The person who hits a bug
 * is whoever hits it, and asking them to find an admin before they can report
 * which version they were using loses the report.
 *
 * It is quiet on purpose. This is reference information a person goes looking
 * for once, not something to spend dashboard attention on.
 */
export function BuildIdentityLine() {
  const identity = buildIdentity();

  return (
    <p className="mt-8 text-center text-xs text-muted-foreground" data-testid="build-identity">
      <span>{identity.label}</span>
      {identity.commit ? null : (
        <>
          {" "}
          <span className="opacity-80">
            (set <code>OPENPLAN_COMMIT_SHA</code> at build time to record it)
          </span>
        </>
      )}
    </p>
  );
}
