import type { Metadata, Viewport } from "next";
import { DM_Serif_Display, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

import { OfflineBanner } from "@/components/OfflineBanner";
import { QueueReplayProvider } from "@/components/QueueReplayProvider";
import { Toaster } from "@/components/ui/sonner";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

const dmSerifDisplay = DM_Serif_Display({
  variable: "--font-dm-serif",
  subsets: ["latin"],
  weight: "400",
});

export const metadata: Metadata = {
  title: "Newborn Tracker",
  description:
    "Track your newborn's feeds, diapers, and weight — and know on glance if today's intake is on target.",
};

export const viewport: Viewport = {
  themeColor: "#0A3824",
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable} ${dmSerifDisplay.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col bg-background pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]">
        {/* Mounted at the ROOT (not (app)/layout.tsx as the plan's file list
            says): the dashboard lives at app root, outside the (app) group,
            and offline awareness must cover the QuickLogBar there too. */}
        <OfflineBanner />
        <QueueReplayProvider />
        {children}
        <Toaster position="top-center" />
      </body>
    </html>
  );
}
