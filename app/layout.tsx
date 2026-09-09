import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RESHUFFLE — A market for outcomes, not listings",
  description: "Multi-party conditional exchange for event tickets. Sign the outcome you would accept.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
