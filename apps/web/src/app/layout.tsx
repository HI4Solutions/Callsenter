import type { Metadata } from "next";
import Link from "next/link";
import "@fontsource-variable/schibsted-grotesk";
import "./globals.css";
import { AccountMenu } from "@/components/account-menu";
import { Announcements } from "@/components/announcements";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { THEME_COLORS, themeInitScript } from "@/lib/theme";

export const metadata: Metadata = {
  title: { default: "VeriQall", template: "%s · VeriQall" },
  description: "Dokumentert og verifisert telefonsalg for callsentre.",
  icons: { icon: "/brand/favicon.svg", apple: "/brand/apple-touch-icon.png" },
  // The app is behind login; nothing here is meant for search engines.
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // data-theme and theme-color are set by the script below before first paint,
    // hence suppressHydrationWarning.
    <html lang="nb" suppressHydrationWarning>
      <head>
        <meta name="theme-color" content={THEME_COLORS.light} />
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-dvh antialiased">
        <header className="border-b border-line bg-surface">
          <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
            <Link href="/" aria-label="VeriQall, til forsiden" className="flex items-center">
              <Logo height={32} />
            </Link>
            <div className="flex flex-wrap items-center gap-2">
              <AccountMenu />
              <ThemeToggle />
            </div>
          </div>
        </header>
        <Announcements />
        <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 sm:py-16">{children}</main>
      </body>
    </html>
  );
}
