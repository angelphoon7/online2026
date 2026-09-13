import type { Metadata } from "next";
import "./globals.css";
import { Geist, Alfa_Slab_One } from "next/font/google";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});
const alfaSlabOne = Alfa_Slab_One({weight:'400',subsets:['latin'],variable:'--font-hero'});

export const metadata: Metadata = {
  title: "RESHUFFLE — Sign the outcome",
  description: "Multi-party conditional exchange for event tickets. Sign the outcome you would accept.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn("h-full antialiased", "font-sans", geist.variable, alfaSlabOne.variable)}>
      {/* Grammarly adds attributes to body before hydration. Keep this escape
          hatch on body only; descendants still report hydration mismatches. */}
      <body className="min-h-full flex flex-col" suppressHydrationWarning>{children}</body>
    </html>
  );
}
