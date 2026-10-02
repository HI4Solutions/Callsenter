"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Card } from "@/components/admin/card";
import { ErrorMessage, Field, inputClass, primaryButton } from "@/components/admin/field";
import { CustomerForm } from "@/components/work/customer-form";
import { NoAccess, useWorkMe } from "@/components/work/work-shell";
import { orgFetch } from "@/lib/org";
import { type Customer, CUSTOMER_KIND, formatOrgNumber, formatPhone } from "@/lib/work";

export default function CustomersPage() {
  const me = useWorkMe();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [archived, setArchived] = useState(false);
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const canRead = me?.permissions.includes("customers.read") ?? false;
  const canManage = me?.permissions.includes("customers.manage") ?? false;

  // The search runs in the database; wait for a pause in typing.
  useEffect(() => {
    if (!canRead) return;
    let cancelled = false;
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (archived) params.set("archived", "1");
    const timer = setTimeout(() => {
      orgFetch<Customer[]>(`/customers${params.size ? `?${params}` : ""}`)
        .then((rows) => {
          if (cancelled) return;
          setCustomers(rows);
          setError(null);
        })
        .catch((e: Error) => !cancelled && setError(e.message));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, archived, canRead]);

  if (!canRead) return <NoAccess text="Du har ikke tilgang til kunder i dette callsenteret." />;

  return (
    <section className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Kunder</h1>
          <p className="mt-2 text-muted">Privatpersoner og bedrifter callsenteret selger til.</p>
        </div>
        {canManage && !creating && (
          <button type="button" className={primaryButton} onClick={() => setCreating(true)}>
            Ny kunde
          </button>
        )}
      </div>

      {creating && (
        <Card title="Ny kunde">
          <CustomerForm
            submitLabel="Opprett kunde"
            onCancel={() => setCreating(false)}
            onSubmit={async (body) => {
              const { id } = await orgFetch<{ id: string }>("/customers", { method: "POST", body });
              router.push(`/kunder/${id}`);
            }}
          />
        </Card>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <Field label="Søk">
          <input
            type="search"
            className={`${inputClass} w-full sm:w-80`}
            placeholder="Navn, telefon, e-post eller org.nr."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </Field>
        <label className="inline-flex min-h-11 items-center gap-2">
          <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
          Vis arkiverte
        </label>
      </div>

      <ErrorMessage message={error} />
      {!customers ? (
        !error && <p className="text-muted">Laster …</p>
      ) : customers.length === 0 ? (
        <p className="text-muted">{query.trim() ? "Ingen kunder passer søket." : archived ? "Ingen arkiverte kunder." : "Ingen kunder ennå."}</p>
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
          {customers.map((c) => (
            <li key={c.id}>
              <Link href={`/kunder/${c.id}`} className="flex flex-col gap-1 p-4 hover:bg-bg sm:flex-row sm:items-center sm:justify-between">
                <span>
                  <span className="font-semibold">{c.name}</span>
                  <span className="ml-2 text-sm text-muted">{CUSTOMER_KIND[c.kind]}</span>
                </span>
                <span className="text-sm text-muted">
                  {[c.kind === "business" ? formatOrgNumber(c.orgNumber) : null, c.phone ? formatPhone(c.phone) : null, c.city]
                    .filter((v) => v && v !== "–")
                    .join(" · ")}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {customers?.length === 200 && <p className="text-sm text-muted">Viser de 200 første. Søk for å finne flere.</p>}
    </section>
  );
}
