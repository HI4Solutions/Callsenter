"use client";

import "./globals.css";

// Replaces the root layout when it fails, so it brings its own <html> and <body>.
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="nb">
      <body className="min-h-dvh px-4 py-16 sm:px-6">
        <main className="mx-auto max-w-2xl">
          <h1 className="text-4xl font-extrabold tracking-tight">Noe gikk galt</h1>
          <p className="mt-5 text-lg text-muted">Vi klarte ikke å laste VeriQall. Prøv igjen om litt.</p>
          <button
            type="button"
            onClick={reset}
            className="mt-8 inline-flex min-h-11 items-center rounded-lg bg-brand px-5 font-semibold text-on-brand"
          >
            Prøv igjen
          </button>
        </main>
      </body>
    </html>
  );
}
