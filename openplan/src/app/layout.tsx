import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OpenPlan",
  description: "Transportation planning workspace for agencies and consultants",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <div className="min-h-screen bg-background text-foreground">
          {children}
        </div>
      </body>
    </html>
  );
}
