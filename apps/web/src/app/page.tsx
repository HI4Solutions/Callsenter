import Link from "next/link";

export default function Home() {
  return (
    <section className="max-w-2xl">
      <p className="mb-3 text-sm font-medium uppercase tracking-wide text-muted">Under utvikling</p>
      <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">Verifisert telefonsalg</h1>
      <p className="mt-5 text-lg text-muted">
        VeriQall tar opp og transkriberer salgssamtaler, sjekker dem mot produktmalen og samler alt som
        dokumentasjon for oppfølging, klager og coaching.
      </p>
      <Link
        href="/design"
        className="mt-8 inline-flex min-h-11 items-center rounded-lg bg-brand px-5 font-semibold text-on-brand"
      >
        Se designsystemet
      </Link>
    </section>
  );
}
