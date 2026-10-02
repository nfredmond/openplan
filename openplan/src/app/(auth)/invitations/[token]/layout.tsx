import type { Metadata } from "next";

/** The page is a client component, so its tab title is declared here. */
export const metadata: Metadata = { title: "Accept an invitation" };

export default function InvitationsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
