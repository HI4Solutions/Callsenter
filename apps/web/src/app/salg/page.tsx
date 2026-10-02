"use client";

import { SALE_STATUS_KEYS, SALE_STATUSES } from "@veriqall/shared";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Card } from "@/components/admin/card";
import { ErrorMessage, Field, inputClass, primaryButton, secondaryButton } from "@/components/admin/field";
import { SaleList } from "@/components/work/sale-list";
import { NoAccess, useWorkMe } from "@/components/work/work-shell";
import { orgFetch } from "@/lib/org";
import { canSeeSales, type Customer, formatPrice, type ProductSummary, type SaleSummary } from "@/lib/work";

export default function SalesPage() {
  const me = useWorkMe();
  const permissions = me?.permissions ?? [];
  const canManage = permissions.includes("sales.manage");
  // From the customer page: /salg?kunde=<id> opens a new sale for that customer.
  const [preselected] = useState(() => (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("kunde")));
  const [creating, setCreating] = useState(Boolean(preselected));
  const [status, setStatus] = useState("");
  const [mine, setMine] = useState(false);
  const [query, setQuery] = useState("");
  const [sales, setSales] = useState<SaleSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const visible = canSeeSales(permissions);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (mine) params.set("mine", "1");
    if (query.trim()) params.set("q", query.trim());
    const timer = setTimeout(() => {
      orgFetch<SaleSummary[]>(`/sales${params.size ? `?${params}` : ""}`)
        .then((rows) => {
          if (cancelled) return;
          setSales(rows);
          setError(null);
        })
        .catch((e: Error) => !cancelled && setError(e.message));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [status, mine, query, visible]);

  if (!visible) return <NoAccess text="Du har ikke tilgang til salg i dette callsenteret." />;

  return (
    <section className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Salg</h1>
          <p className="mt-2 text-muted">Hvert salg peker på produktmalen som gjaldt da det ble gjort.</p>
        </div>
        {canManage && !creating && (
          <button type="button" className={primaryButton} onClick={() => setCreating(true)}>
            Nytt salg
          </button>
        )}
      </div>

      {creating && <NewSale customerId={preselected} canPickCustomer={permissions.includes("customers.read")} onCancel={() => setCreating(false)} />}

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <Field label="Søk">
          <input
            type="search"
            className={`${inputClass} w-full sm:w-64`}
            placeholder="Kunde eller produkt"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </Field>
        <Field label="Status">
          <select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Alle</option>
            {SALE_STATUS_KEYS.map((s) => (
              <option key={s} value={s}>
                {SALE_STATUSES[s]}
              </option>
            ))}
          </select>
        </Field>
        <label className="inline-flex min-h-11 items-center gap-2">
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />
          Bare mine
        </label>
      </div>

      <ErrorMessage message={error} />
      {!sales ? (
        !error && <p className="text-muted">Laster …</p>
      ) : sales.length === 0 ? (
        <p className="text-muted">{status || mine || query.trim() ? "Ingen salg passer filteret." : "Ingen salg ennå."}</p>
      ) : (
        <SaleList sales={sales} />
      )}
      {sales?.length === 200 && <p className="text-sm text-muted">Viser de 200 siste. Bruk filteret for å finne eldre salg.</p>}
    </section>
  );
}

function NewSale({ customerId, canPickCustomer, onCancel }: { customerId: string | null; canPickCustomer: boolean; onCancel: () => void }) {
  const router = useRouter();
  const [customer, setCustomer] = useState<Pick<Customer, "id" | "name"> | null>(null);
  const [search, setSearch] = useState("");
  const [matches, setMatches] = useState<Customer[]>([]);
  const [products, setProducts] = useState<ProductSummary[] | null>(null);
  const [productId, setProductId] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    orgFetch<ProductSummary[]>("/products")
      .then((rows) => !cancelled && setProducts(rows.filter((p) => p.publishedVersion !== null)))
      .catch((e: Error) => !cancelled && setError(e.message));
    if (customerId && canPickCustomer) {
      orgFetch<Customer>(`/customers/${encodeURIComponent(customerId)}`)
        .then((c) => !cancelled && setCustomer(c))
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [customerId, canPickCustomer]);

  useEffect(() => {
    if (!canPickCustomer || customer || !search.trim()) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      orgFetch<Customer[]>(`/customers?q=${encodeURIComponent(search.trim())}`)
        .then((rows) => !cancelled && setMatches(rows.slice(0, 8)))
        .catch((e: Error) => !cancelled && setError(e.message));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search, customer, canPickCustomer]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { id } = await orgFetch<{ id: string }>("/sales", {
        method: "POST",
        body: { customerId: customer?.id, productId, note: note.trim() || null },
      });
      router.push(`/salg/${id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const product = products?.find((p) => p.id === productId);
  return (
    <Card title="Nytt salg">
      {!canPickCustomer ? (
        <p>Du trenger tilgang til kunder for å registrere salg.</p>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          {customer ? (
            <div className="flex flex-wrap items-center gap-3">
              <span>
                <span className="text-sm font-semibold">Kunde: </span>
                {customer.name}
              </span>
              <button type="button" className={secondaryButton} onClick={() => setCustomer(null)}>
                Bytt kunde
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <Field label="Kunde" hint="Søk på navn, telefon, e-post eller org.nr. Finnes ikke kunden, opprett den under Kunder først.">
                <input type="search" className={`${inputClass} sm:max-w-md`} value={search} onChange={(e) => setSearch(e.target.value)} />
              </Field>
              {search.trim() && matches.length > 0 && (
                <ul className="flex flex-col gap-1 sm:max-w-md">
                  {matches.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        className="flex min-h-11 w-full items-center rounded-lg border border-line px-3 text-left hover:bg-bg"
                        onClick={() => setCustomer(c)}
                      >
                        {c.name}
                        {c.city && <span className="ml-2 text-sm text-muted">{c.city}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <Field label="Produkt" hint={product ? `${formatPrice(product)}, mal versjon ${product.publishedVersion}` : undefined}>
            <select required className={`${inputClass} sm:max-w-md`} value={productId} onChange={(e) => setProductId(e.target.value)}>
              <option value="">{products === null ? "Laster …" : products.length ? "Velg produkt" : "Ingen publiserte produkter"}</option>
              {products?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Notat" hint="Valgfritt.">
            <textarea rows={2} maxLength={2000} className={`${inputClass} py-2`} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <ErrorMessage message={error} />
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={busy || !customer || !productId} className={primaryButton}>
              Registrer salg
            </button>
            <button type="button" className={secondaryButton} onClick={onCancel}>
              Avbryt
            </button>
          </div>
        </form>
      )}
    </Card>
  );
}
