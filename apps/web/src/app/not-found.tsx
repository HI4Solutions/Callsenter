import Link from "next/link";

export default function NotFound() {
  return (
    <section className="max-w-2xl">
      <p className="mb-3 text-sm font-medium uppercase tracking-wide text-muted">404</p>
      <h1 className="text-4xl font-extrabold tracking-tight">Fant ikke siden</h1>
      <p className="mt-5 text-lg text-muted">Siden finnes ikke, eller den er flyttet.</p>
      <Link href="/" className="mt-8 inline-flex min-h-11 items-center rounded-lg bg-brand px-5 font-semibold text-on-brand">
        Til forsiden
      </Link>
    </section>
  );
}
