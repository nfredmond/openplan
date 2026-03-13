import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OpenPlan",
  description: "Planning OS for agencies, transportation commissions, and consultants",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
