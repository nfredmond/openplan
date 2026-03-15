import { TopNav } from "@/components/top-nav";

export default function PublicLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <TopNav />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6 lg:px-8">{children}</main>
      <footer className="border-t border-border/50 py-6 text-center text-[0.72rem] uppercase tracking-[0.16em] text-muted-foreground/60">
        OpenPlan · Nat Ford Planning
      </footer>
    </div>
  );
}
