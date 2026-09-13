import type { Metadata } from "next";
import "./globals.css";
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
  title: "RESHUFFLE — Sign the outcome",
  description: "Multi-party conditional exchange for event tickets. Sign the outcome you would accept.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn("h-full antialiased", "font-sans", geist.variable)}>
      {/* Grammarly adds attributes to body before hydration. Keep this escape
          hatch on body only; descendants still report hydration mismatches. */}
      <body className="min-h-full flex flex-col" suppressHydrationWarning>{children}</body>
    </html>
  );
}
