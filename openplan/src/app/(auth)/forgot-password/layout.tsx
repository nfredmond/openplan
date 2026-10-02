import type { Metadata } from "next";

/** The page is a client component, so its tab title is declared here. */
export const metadata: Metadata = { title: "Reset your password" };

export default function ForgotPasswordLayout({ children }: { children: React.ReactNode }) {
  return children;
}
