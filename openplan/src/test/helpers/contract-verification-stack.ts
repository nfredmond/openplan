/** Limit live contract fixtures to explicitly named disposable databases, including the shared OWP integration stack. */
export function requireContractVerificationStack(container: string, githubActions = process.env.GITHUB_ACTIONS) {
 const named = ["supabase_db_m11-contract-verification", "supabase_db_m11-contract-verification-upgrade", "supabase_db_m2d3-reimbursement-verification"];
 if (!named.includes(container) && !/^supabase_db_openplan-restore-target-[1-9][0-9]*$/.test(container) && !(githubActions === "true" && container === "supabase_db_openplan")) throw new Error("Select an explicitly named disposable contract verification stack");
}
