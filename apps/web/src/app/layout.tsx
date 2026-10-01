import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "@fontsource-variable/schibsted-grotesk";
import "./globals.css";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { themeInitScript } from "@/lib/theme";

export const metadata: Metadata = {
  title: { default: "VeriQall", template: "%s · VeriQall" },
  description: "Dokumentert og verifisert telefonsalg for callsentre.",
  icons: { icon: "/brand/favicon.svg" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafc" },
    { media: "(prefers-color-scheme: dark)", color: "#10122a" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // data-theme settes av skriptet under før første maling, derfor suppressHydrationWarning.
    <html lang="nb" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-dvh antialiased">
        <header className="border-b border-line bg-surface">
          <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
            <Link href="/" aria-label="VeriQall, til forsiden" className="flex items-center">
              <Logo height={32} />
            </Link>
            <ThemeToggle />
          </div>
        </header>
        <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 sm:py-16">{children}</main>
      </body>
    </html>
  );
}
