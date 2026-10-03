import { LOCALES } from "@veriqall/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import "@fontsource-variable/schibsted-grotesk";
import "./globals.css";
import { AccountMenu } from "@/components/account-menu";
import { Announcements } from "@/components/announcements";
import { FormatLocale } from "@/components/format-locale";
import { Logo } from "@/components/logo";
import { SITE_URL } from "@/lib/site";
import { THEME_COLORS, themeInitScript } from "@/lib/theme";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("shell");
  return {
    metadataBase: new URL(SITE_URL),
    title: { default: "VeriQall", template: "%s · VeriQall" },
    description: t("description"),
    icons: { icon: "/brand/favicon.svg", apple: "/brand/apple-touch-icon.png" },
    // The app is behind login; nothing here is meant for search engines.
    robots: { index: false, follow: false },
  };
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();
  const t = await getTranslations("shell");
  return (
    // data-theme and theme-color are set by the script below before first paint,
    // hence suppressHydrationWarning.
    <html lang={LOCALES[locale].tag} suppressHydrationWarning>
      <head>
        <meta name="theme-color" content={THEME_COLORS.light} />
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-dvh antialiased">
        <NextIntlClientProvider>
          <FormatLocale />
          <header className="sticky top-0 z-30 border-b border-line bg-surface print:hidden">
            <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-2 sm:px-6">
              <Link
                href="/"
                aria-label={t("home")}
                className="flex items-center"
              >
                <Logo height={32} />
              </Link>
              <AccountMenu />
            </div>
          </header>
          <Announcements />
          <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 sm:py-16 print:max-w-none print:p-0">
            {children}
          </main>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
