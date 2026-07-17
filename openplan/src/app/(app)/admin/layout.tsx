import { notFound } from "next/navigation";
import { canReviewAccessRequests } from "@/lib/access-requests";
import { createClient } from "@/lib/supabase/server";

// The /admin surface is the platform-operator console (watchboard, smoke
// evidence, pilot-readiness export, access-request triage). Every self-signed-up
// user is an owner of their own workspace, so workspace role cannot gate it —
// only the operator email allowlist can.
export default async function AdminLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!canReviewAccessRequests(user?.email)) {
    notFound();
  }

  return <>{children}</>;
}
