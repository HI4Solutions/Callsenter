"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Card } from "@/components/admin/card";
import { ErrorMessage, Field, inputClass, primaryButton, secondaryButton } from "@/components/admin/field";
import { useWorkMe } from "@/components/work/work-shell";
import { orgFetch } from "@/lib/org";
import { formatPrice, months, type ProductSummary } from "@/lib/work";

export default function ProductsPage() {
  const me = useWorkMe();
  const router = useRouter();
  const canManage = me?.permissions.includes("products.manage") ?? false;
  const [archived, setArchived] = useState(false);
  const [products, setProducts] = useState<ProductSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    orgFetch<ProductSummary[]>(`/products${archived ? "?archived=1" : ""}`)
      .then((rows) => {
        if (cancelled) return;
        setProducts(rows);
        setError(null);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [archived]);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { id } = await orgFetch<{ id: string }>("/products", { method: "POST", body: { name, description: description || null } });
      // Stays busy until the product page has loaded, so a second click cannot create it twice.
      router.push(`/produkter/${id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  // Sellers only see products they can sell; managers also see drafts in progress.
  const shown = products?.filter((p) => canManage || p.publishedVersion !== null);

  return (
    <section className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Produkter</h1>
          <p className="mt-2 text-muted">Hver produktmal har pris, vilkår og det selgeren må si. AI-kontrollen sjekker samtalene mot gjeldende versjon.</p>
        </div>
        {canManage && !creating && (
          <button type="button" className={primaryButton} onClick={() => setCreating(true)}>
            Nytt produkt
          </button>
        )}
      </div>

      {creating && (
        <Card title="Nytt produkt">
          <form onSubmit={create} className="flex flex-col gap-4">
            <Field label="Navn">
              <input required maxLength={200} className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Beskrivelse" hint="Valgfritt. Kort om hva produktet er.">
              <textarea rows={2} maxLength={2000} className={`${inputClass} py-2`} value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
            <div className="flex gap-2">
              <button type="submit" disabled={busy} className={primaryButton}>
                Opprett og fyll ut mal
              </button>
              <button type="button" className={secondaryButton} onClick={() => setCreating(false)}>
                Avbryt
              </button>
            </div>
          </form>
        </Card>
      )}

      {canManage && (
        <label className="inline-flex min-h-11 items-center gap-2 self-start">
          <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
          Vis arkiverte
        </label>
      )}
      <ErrorMessage message={error} />
      {!shown ? (
        !error && <p className="text-muted">Laster …</p>
      ) : shown.length === 0 ? (
        <p className="text-muted">Ingen produkter ennå.</p>
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
          {shown.map((p) => (
            <li key={p.id}>
              <Link href={`/produkter/${p.id}`} className="flex flex-col gap-1 p-4 hover:bg-bg sm:flex-row sm:items-center sm:justify-between">
                <span>
                  <span className="font-semibold">{p.name}</span>
                  {p.archivedAt && <span className="ml-2 text-sm text-muted">Arkivert</span>}
                </span>
                <span className="text-sm text-muted">
                  {p.publishedVersion !== null
                    ? `${formatPrice(p)} · ${p.bindingMonths ? `binding ${months(p.bindingMonths)}` : "ingen binding"} · versjon ${p.publishedVersion}`
                    : "Ikke publisert"}
                  {canManage && p.draftVersion !== null && ` · utkast til versjon ${p.draftVersion}`}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
