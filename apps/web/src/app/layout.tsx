import type { Metadata } from "next";
import Link from "next/link";
import "@fontsource-variable/schibsted-grotesk";
import "./globals.css";
import { AccountMenu } from "@/components/account-menu";
import { Announcements } from "@/components/announcements";
import { Logo } from "@/components/logo";
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
        <header className="border-b border-line bg-surface print:hidden">
          <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-2 sm:px-6">
            <Link href="/" aria-label="VeriQall, til forsiden" className="flex items-center">
              <Logo height={32} />
            </Link>
            <AccountMenu />
          </div>
        </header>
        <Announcements />
        <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 sm:py-16 print:max-w-none print:p-0">{children}</main>
      </body>
    </html>
  );
}
