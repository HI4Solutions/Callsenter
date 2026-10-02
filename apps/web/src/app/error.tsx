"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section className="max-w-2xl">
      <h1 className="text-4xl font-extrabold tracking-tight">Noe gikk galt</h1>
      <p className="mt-5 text-lg text-muted">Vi klarte ikke å vise siden. Prøv igjen om litt.</p>
      <button
        type="button"
        onClick={reset}
        className="mt-8 inline-flex min-h-11 items-center rounded-lg bg-brand px-5 font-semibold text-on-brand"
      >
        Prøv igjen
      </button>
    </section>
  );
}
