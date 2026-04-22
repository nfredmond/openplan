import { redirect } from "next/navigation";
import { CartographicShell } from "@/components/cartographic/cartographic-shell";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  return <CartographicShell>{children}</CartographicShell>;
}
